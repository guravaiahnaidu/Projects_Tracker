// Centralised client for the Django REST backend. Every network call in the UI goes through here.
// API_BASE_URL includes the backend's /api prefix; paths below are relative to it (e.g. "/members/" -> /api/members/).

import type { EmploymentType, MemberStatus } from "./data";

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api").replace(/\/+$/, "");

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

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}${qs(query)}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
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
  lead: number;
  lead_name: string;
  phase: string;
  description: string;
  start_date: string;
  end_date: string;
  start_offset?: number; // not used by the UI: offsets are derived from the dates and the server's today
  end_offset?: number;
  progress: number;
  decision: string;
  objectives?: { id: number; description: string }[];
  members?: { id: number; member_id: number; name: string; role: string }[];
}

export interface ApiTask {
  id: number;
  title: string;
  project: number;
  project_name: string;
  owner: number;
  owner_name: string;
  due_date: string;
  due_offset?: number; // not used by the UI
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
  end_offset: number;
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
  deadline: string;
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
  lead_id: number;
  start_date: string;
  end_date: string;
  description?: string;
}

export interface ProjectPatch {
  name?: string;
  department?: string;
  description?: string;
  phase?: string;
  lead_id?: number;
  start_date?: string;
  end_date?: string;
  progress?: number;
  decision?: string;
}

export interface TaskInput {
  title: string;
  project_id: number;
  owner_id: number;
  due_date: string;
  priority?: string;
}

export interface TaskPatch {
  title?: string;
  owner_id?: number;
  due_date?: string;
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
  updateMember: (id: number, body: Partial<Omit<MemberInput, "memberships">>) => patch<ApiMember>(`/members/${id}/`, body),
  deleteMember: (id: number) => del(`/members/${id}/`),

  // Projects
  /** Every project with objectives, members and open tasks in ONE request. */
  listProjects: () => get<Paged<ApiProject>>("/projects/", { detail: 1 }),
  getProject: (id: number) => get<ApiProject>(`/projects/${id}/`),
  projectHistory: (id: number, limit = 50, offset = 0) =>
    get<PagedWindow<ApiActivity>>(`/projects/${id}/history/`, { limit, offset }),
  createProject: (body: ProjectInput) => post<ApiProject>("/projects/", body),
  updateProject: (id: number, body: ProjectPatch) => patch<ApiProject>(`/projects/${id}/`, body),
  deleteProject: (id: number) => del(`/projects/${id}/`),
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
  markUpdateReviewed: (id: number) => patch<ApiDailyUpdate>(`/daily-updates/${id}/`, { review_status: "reviewed" }),
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
