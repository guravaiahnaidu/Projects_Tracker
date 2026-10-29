// Centralised client for the Django REST backend. Every network call in the UI goes through here.
// The base URL includes the backend's /api prefix; paths below are relative to it (e.g. "/members/" -> /api/members/).

import type { EmploymentType, MemberStatus, ProjectPhase, ProjectPriority } from "./data";

const CONFIGURED_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "");

/** Without NEXT_PUBLIC_API_BASE_URL, the backend on port 8000 of the SAME host name as the page: the sign-in cookie is
 *  SameSite=Strict, and localhost / 127.0.0.1 count as different sites, so a mismatch would break staying signed in. */
function apiBase(): string {
  if (CONFIGURED_BASE_URL) return CONFIGURED_BASE_URL;
  if (typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:8000/api`;
  return "http://127.0.0.1:8000/api";
}

export class ApiError extends Error {
  status: number; // 0 = the server could not be reached
  code: string;
  fields: Record<string, string[]>;
  constructor(status: number, message: string, code = "error", fields: Record<string, string[]> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** A readable message for any thrown value. */
export function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
}

type Query = Record<string, string | number | undefined>;

function qs(query?: Query) {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** One HTTP round trip. `withCookie` is used only by the /auth/ endpoints, which read and set the refresh cookie;
 *  data requests carry the access token in the Authorization header instead. */
async function send<T>(method: string, path: string, body?: unknown, query?: Query, withCookie = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken && !withCookie) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}${qs(query)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: withCookie ? "include" : "same-origin",
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check that the backend is running and try again.", "network_error");
  }
  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body: handled below.
  }

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string[]> } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.message || `The server returned an unexpected error (${res.status}).`,
      err?.code ?? "error",
      err?.fields ?? {},
    );
  }
  if (data === null) throw new ApiError(res.status, "The server sent a response that could not be read.", "bad_response");
  return data as T;
}

/** Codes the backend uses when the access token is missing, expired or no longer valid. */
const SIGN_IN_CODES = new Set(["token_not_valid", "not_authenticated", "authentication_failed"]);

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  try {
    return await send<T>(method, path, body, query);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || !SIGN_IN_CODES.has(e.code)) throw e;
    // The access token expired (or was never sent): renew it once from the refresh cookie and repeat the request.
    // A 401 is returned before the backend runs the view, so repeating a POST cannot apply it twice.
    if (!(await refreshSession())) {
      if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      throw e;
    }
    return send<T>(method, path, body, query);
  }
}

/* ---------- Session (JWT, managers only) ----------
   The access token is kept in this module's memory only (never localStorage), so a page reload starts without one and
   restores it from the refresh token. The refresh token is an HttpOnly cookie that only the backend can read; it is
   sent to /api/auth/ and nowhere else. */

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  role: "admin" | "manager";
  is_staff: boolean;
  is_superuser: boolean;
  groups: string[];
}

interface SessionResponse {
  access: string;
  token_type: "Bearer";
  access_expires_in: number;
  user: SessionUser;
}

/** Fired on window when the session can no longer be renewed (signed out elsewhere, expired, or revoked). */
export const SESSION_EXPIRED_EVENT = "session-expired";

let accessToken: string | null = null;
let sessionUser: SessionUser | null = null;
let renewing: Promise<SessionUser | null> | null = null;

function startSession(s: SessionResponse): SessionUser {
  accessToken = s.access;
  sessionUser = s.user;
  return s.user;
}

function endSession() {
  accessToken = null;
  sessionUser = null;
}

export const getSessionUser = () => sessionUser;

/** A new access token from the refresh cookie, or null when there is no valid session. Concurrent callers share one
 *  request: the backend rotates the refresh token on every use, so two parallel refreshes would revoke each other. */
export function refreshSession(): Promise<SessionUser | null> {
  renewing ??= (async () => {
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          return startSession(await send<SessionResponse>("POST", "/auth/refresh/", undefined, undefined, true));
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 401) throw e; // network or server trouble: not a sign-out
          // Another open tab may have rotated the shared cookie a moment ago; one short retry picks up the new one.
          if (attempt === 1) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          endSession();
          return null;
        }
      }
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

/** The signed-in user, restoring the session from the refresh cookie after a page load. */
export function restoreSession(): Promise<SessionUser | null> {
  return sessionUser ? Promise.resolve(sessionUser) : refreshSession();
}

export async function signIn(username: string, password: string): Promise<SessionUser> {
  return startSession(await send<SessionResponse>("POST", "/auth/login/", { username, password }, undefined, true));
}

/** Revokes the refresh token on the server and clears the cookie. Throws if the server could not be reached, so the
 *  caller can say so instead of pretending the session ended. */
export async function signOut(): Promise<void> {
  await send<void>("POST", "/auth/logout/", undefined, undefined, true);
  endSession();
}

const get = <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = (path: string) => request<void>("DELETE", path);

/* ---------- Response shapes (as served by the backend) ---------- */

export interface Paged<T> {
  results: T[];
  count: number;
}

/** Paged list with the window that was served (activity and project history). */
export interface PagedWindow<T> extends Paged<T> {
  limit: number;
  offset: number;
}

export interface ApiToday {
  date: string; // YYYY-MM-DD in the server's time zone
  time_zone: string; // IANA name, e.g. Asia/Kolkata
  server_time: string;
}

export interface ApiMember {
  id: number;
  name: string;
  title: string;
  department: string;
  // Contact and employment details: only the /members/ endpoints send these.
  email?: string;
  phone?: string;
  status?: MemberStatus;
  employment_type?: EmploymentType;
  start_date?: string | null;
  load: number;
  stretched: boolean;
}

export interface ApiProject {
  id: number;
  name: string;
  department: string;
  client?: string;
  lead: number | null;
  lead_name: string;
  phase: string;
  priority?: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  start_offset?: number | null; // not used by the UI: offsets are derived from the dates and the server's today
  end_offset?: number | null;
  progress: number;
  effective_progress?: number; // progress, or task completion while progress is 0
  task_stats?: { total: number; done: number; started: number };
  decision: string;
  access_url?: string;
  has_access_login?: boolean;
  objectives?: { id: number; description: string }[];
  members?: { id: number; member_id: number; name: string; role: string }[];
}

/** One person on a project's team, from /projects/<id>/members/. */
export interface ApiProjectMember {
  id: number;
  member_id: number;
  name: string;
  role: string;
  status: string; // "active" | "on_leave" | "inactive"
  title: string;
}

export interface ApiTask {
  id: number;
  title: string;
  project: number;
  project_name: string;
  owner: number;
  owner_name: string;
  work_date: string;
  due_date: string | null;
  due_offset?: number | null; // not used by the UI
  state: string;
  priority: string;
  note: string;
}

export interface ApiActivity {
  id: number;
  description: string;
  created_at: string;
}

export interface ApiSummary {
  total: number;
  in_flight: number;
  not_started: number;
  off_track: number;
  watch: number;
  on_track: number;
  no_schedule?: number;
  overdue: number;
  due_today: number;
  blocked: number;
  stretched: number;
}

export interface ApiAttention {
  key: string;
  marker: string;
  title: string;
  subtitle: string;
  label: string;
  ref: { kind: "project" | "task"; id: number };
}

export interface ApiKeyDate {
  key: string;
  offset: number;
  title: string;
  lead: string;
  project_id: number;
}

export interface ApiWorkload {
  id: number;
  name: string;
  title: string;
  department: string;
  load: number;
  stretched: boolean;
  open: string[];
}

export interface ApiDecision {
  project_id: number;
  name: string;
  decision: string;
  health: string;
  lead: string;
  end_offset: number | null; // null = the project has no deadline
}

export interface ApiBrief {
  summary: ApiSummary;
  stats: { projects_at_risk: number; overdue: number; blocked: number; decisions: number; due_in_7_days: number };
  decisions: ApiDecision[];
  attention_projects: ApiProject[];
  late_tasks: ApiTask[];
  key_dates: ApiKeyDate[];
  stretched_people: ApiMember[];
  on_track_projects: ApiProject[];
  completed_tasks: { id: number; title: string }[];
}

export interface ApiFeedback {
  id: number;
  type: string;
  content: string;
  manager_name: string;
  created_at: string;
}

export interface ApiDailyUpdate {
  id: number;
  employee: number;
  employee_name: string;
  project: number;
  project_name: string;
  date: string;
  completed: string[];
  in_progress: string[];
  next_steps: string[];
  blockers: string[];
  notes: string;
  status: string;
  review_status: string;
  shared_at: string;
  feedback: ApiFeedback[];
  from_tasks?: boolean; // created automatically from the employee's tasks for that project and day
  tasks?: { id: number; title: string; state: string; priority: string }[];
}

export interface ApiDecisionRecord {
  id: number;
  project: number | null;
  title: string;
  outcome: string;
  notes: string;
  decision_date: string;
  recorded_at: string;
  project_name: string;
  lead: string;
  health: string;
  deadline: string | null;
  context: string;
  activity_id: number | null;
}

/* ---------- Request bodies ---------- */

export interface DecisionOutcomeInput {
  outcome: string;
  notes?: string;
  decision_date: string;
}

export interface FeedbackInput {
  type: string;
  content: string;
}

export interface DailyUpdateInput {
  employee_id: number;
  project_id: number;
  date: string; // YYYY-MM-DD, not in the future
  completed: string[];
}


export interface MemberInput {
  name: string;
  title: string;
  department: string;
  load?: number;
  email?: string;
  phone?: string;
  status?: MemberStatus;
  employment_type?: EmploymentType;
  start_date?: string | null;
  memberships?: { project_id: number; role: string }[];
}

export interface ProjectInput {
  name: string;
  department?: string;
  client?: string;
  lead_id?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  phase?: ProjectPhase; // omitted: the server derives it from the start date
  priority?: ProjectPriority;
  description?: string;
  access_url?: string;
  access_username?: string;
  access_password?: string;
}

export interface ProjectPatch {
  name?: string;
  client?: string;
  priority?: ProjectPriority;
  department?: string;
  description?: string;
  phase?: string;
  lead_id?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  progress?: number;
  decision?: string;
  access_url?: string;
  access_username?: string;
  access_password?: string;
}

export interface TaskInput {
  title: string;
  project_id: number;
  owner_id: number;
  work_date: string;
  due_date: string | null;
  priority?: string;
  state?: string;
  note?: string;
}

export interface TaskPatch {
  title?: string;
  project_id?: number; // moving a task needs an owner from the new project's team
  owner_id?: number;
  work_date?: string;
  due_date?: string | null;
  priority?: string;
  state?: string;
  note?: string;
}

/* ---------- Endpoints ---------- */

export const api = {
  today: () => get<ApiToday>("/today/"),

  // Members
  listMembers: () => get<Paged<ApiMember>>("/members/"),
  listDepartments: () => get<Paged<string>>("/members/departments/"),
  createMember: (body: MemberInput) => post<ApiMember>("/members/", body),
  /** `memberships`, when sent, is the person's complete project list: missing projects are removed. */
  updateMember: (id: number, body: Partial<MemberInput>) => patch<ApiMember>(`/members/${id}/`, body),
  deleteMember: (id: number) => del(`/members/${id}/`),

  // Projects
  /** Every project with objectives, members and open tasks in ONE request. */
  listProjects: () => get<Paged<ApiProject>>("/projects/", { detail: 1 }),
  getProject: (id: number) => get<ApiProject>(`/projects/${id}/`),
  /** The saved project login (decrypted). Only the edit form asks for it. */
  getProjectAccess: (id: number) => get<{ username: string; password: string }>(`/projects/${id}/access/`),
  projectHistory: (id: number, limit = 50, offset = 0) =>
    get<PagedWindow<ApiActivity>>(`/projects/${id}/history/`, { limit, offset }),
  createProject: (body: ProjectInput) => post<ApiProject>("/projects/", body),
  updateProject: (id: number, body: ProjectPatch) => patch<ApiProject>(`/projects/${id}/`, body),
  deleteProject: (id: number) => del(`/projects/${id}/`),
  listProjectMembers: (id: number) => get<Paged<ApiProjectMember>>(`/projects/${id}/members/`),
  addProjectMember: (id: number, body: { member_id: number; role?: string }) => post<ApiProject>(`/projects/${id}/members/`, body),
  removeProjectMember: (id: number, memberId: number) => del(`/projects/${id}/members/${memberId}/`),
  addObjective: (id: number, description: string) => post<ApiProject>(`/projects/${id}/objectives/`, { description }),
  updateObjective: (id: number, objectiveId: number, description: string) =>
    patch<ApiProject>(`/projects/${id}/objectives/${objectiveId}/`, { description }),
  deleteObjective: (id: number, objectiveId: number) => del(`/projects/${id}/objectives/${objectiveId}/`),
  setDecision: (id: number, decision: string) => patch<ApiProject>(`/projects/${id}/decision/`, { decision }),
  resolveDecision: (id: number, body: DecisionOutcomeInput) =>
    post<{ project: ApiProject; activity_id: number; record: ApiDecisionRecord }>(`/projects/${id}/decision/resolve/`, body),
  decisionHistory: (limit = 100, offset = 0) => get<PagedWindow<ApiDecisionRecord>>("/decision-history/", { limit, offset }),
  undoDecision: (id: number, activityId: number) =>
    post<{ project: ApiProject }>(`/projects/${id}/decision/undo/`, { activity_id: activityId }),

  // Tasks
  listTasks: () => get<Paged<ApiTask>>("/tasks/", { status: "all" }),
  createTask: (body: TaskInput) => post<ApiTask>("/tasks/", body),
  updateTask: (id: number, body: TaskPatch) => patch<ApiTask>(`/tasks/${id}/`, body),
  completeTask: (id: number) => post<ApiTask>(`/tasks/${id}/complete/`),
  deleteTask: (id: number) => del(`/tasks/${id}/`),

  // Daily updates (the manager reviews them; employees' updates arrive through POST /daily-updates/)
  listDailyUpdates: (limit = 100, offset = 0) =>
    get<PagedWindow<ApiDailyUpdate> & { new_count: number }>("/daily-updates/", { limit, offset }),
  createDailyUpdate: (body: DailyUpdateInput) => post<ApiDailyUpdate>("/daily-updates/", body),
  markUpdateReviewed:(id: number) => patch<ApiDailyUpdate>(`/daily-updates/${id}/`, { review_status: "reviewed" }),
  addFeedback: (id: number, body: FeedbackInput) => post<ApiDailyUpdate>(`/daily-updates/${id}/feedback/`, body),

  // Activity
  listActivity: (limit = 50, offset = 0) => get<PagedWindow<ApiActivity>>("/activity/", { limit, offset }),

  // Dashboard
  summary: () => get<ApiSummary>("/dashboard/summary/"),
  attention: () => get<Paged<ApiAttention>>("/dashboard/attention/"),
  keyDates: (days = 30) => get<Paged<ApiKeyDate>>("/dashboard/key-dates/", { days }),
  teamWorkload: () => get<Paged<ApiWorkload>>("/dashboard/team-workload/"),
  decisions: () => get<Paged<ApiDecision>>("/dashboard/decisions/"),
  weeklyBrief: () => get<ApiBrief>("/weekly-brief/"),
};
