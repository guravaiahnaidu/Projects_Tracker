// Types and pure helpers for the dashboard. The arrays below start empty and are filled in place
// from the REST API by lib/store.ts, so components can keep reading them directly.
// Dates are kept as absolute ISO dates (startDate / endDate / dueDate). The *Offset fields are days from the
// SERVER's today, derived by lib/store.ts from those dates and recomputed whenever the server's date changes.

export type ProjectStatus = "off-track" | "watch" | "on-track" | "not-started";
export type TaskState = "not-started" | "in-progress" | "blocked" | "done";
export type Priority = "High" | "Medium" | "Low";

export type ProjectPhase = "Not Started" | "In Progress" | "At Risk" | "On Hold" | "Completed";

export interface ProjectMember {
  name: string;
  role: string;
  memberId?: number; // server id of the member
}

export interface Project {
  id: string;
  name: string;
  department: string;
  lead: string;
  phase: ProjectPhase; // status set by the project lead
  description: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startOffset: number; // days from the server's today (negative = already started)
  endOffset: number; // days from the server's today
  done: number; // % of work completed
  decision?: string; // what leadership needs to decide, if anything
  objectives: string[];
  members: ProjectMember[];
  history: Activity[];
}

export interface Task {
  id: string;
  title: string;
  owner: string;
  projectId: string;
  dueDate: string; // YYYY-MM-DD
  dueOffset: number; // days from the server's today (negative = overdue)
  state: TaskState;
  priority: Priority;
  note?: string;
}

export interface Member {
  id?: number; // server id
  name: string;
  title: string; // job title
  role: string; // department
  load: number; // % of capacity allocated
}

export const projects: Project[] = [];
export const tasks: Task[] = [];
export const team: Member[] = [];
export const departments: string[] = [];


/* ---------- Derived values ---------- */

export function timeUsed(p: Project): number {
  const total = p.endOffset - p.startOffset;
  const pct = Math.round((-p.startOffset / total) * 100);
  return Math.min(100, Math.max(0, pct));
}

export function projectStatus(p: Project): ProjectStatus {
  const used = timeUsed(p);
  if (used === 0 && p.done === 0) return "not-started";
  const gap = used - p.done;
  if (gap > 15) return "off-track";
  if (gap > 3) return "watch";
  return "on-track";
}

export function startsInLabel(p: Project): string {
  const d = p.startOffset;
  if (d <= 0) return "Not started yet";
  return d === 1 ? "Starts tomorrow" : `Starts in ${d} days`;
}

/* ---------- Team workload ---------- */

export type WorkloadKind = "overdue" | "blocked" | "soon" | "later";

export function workloadKind(t: Task): WorkloadKind {
  const b = taskBucket(t);
  if (b === "overdue" || b === "blocked") return b;
  return t.dueOffset <= 7 ? "soon" : "later";
}

export interface WorkloadPerson extends Member {
  open: WorkloadKind[];
  stretched: boolean;
}

/* ---------- Dashboard figures served by the backend (cached by lib/store.ts after each refresh) ---------- */

export interface Summary {
  total: number;
  inFlight: number;
  notStarted: number;
  offTrack: number;
  watch: number;
  onTrack: number;
  overdue: number;
  dueToday: number;
  blocked: number;
  stretched: number;
}

export interface DecisionItem {
  projectId: string;
  name: string;
  decision: string;
  status: ProjectStatus;
  lead: string;
  endOffset: number;
}

export const emptySummary: Summary = {
  total: 0,
  inFlight: 0,
  notStarted: 0,
  offTrack: 0,
  watch: 0,
  onTrack: 0,
  overdue: 0,
  dueToday: 0,
  blocked: 0,
  stretched: 0,
};

export const dashboardCache: {
  summary: Summary;
  attention: AttentionItem[];
  keyDates: KeyDate[];
  teamWorkload: WorkloadPerson[];
  decisions: DecisionItem[];
} = { summary: emptySummary, attention: [], keyDates: [], teamWorkload: [], decisions: [] };

export const teamWorkload = (): WorkloadPerson[] => dashboardCache.teamWorkload;
export const decisions = (): DecisionItem[] => dashboardCache.decisions;

/* ---------- Key dates ---------- */

export interface KeyDate {
  key: string;
  offset: number;
  title: string;
  lead: string;
  projectId: string;
}

export const keyDates = (withinDays = 30): KeyDate[] => dashboardCache.keyDates.filter((k) => k.offset <= withinDays);

export const projectById = (id: string) => projects.find((p) => p.id === id)!;

export type TaskBucket = "overdue" | "today" | "blocked" | "upcoming" | "done";

export function taskBucket(t: Task): TaskBucket {
  if (t.state === "done") return "done";
  if (t.state === "blocked") return "blocked";
  if (t.dueOffset < 0) return "overdue";
  if (t.dueOffset === 0) return "today";
  return "upcoming";
}

export function dueLabel(t: Task): string {
  if (t.state === "done") return "Done";
  if (t.state === "blocked") return "Blocked";
  const d = t.dueOffset;
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

export const STRETCHED_THRESHOLD = 100;

export const summary = (): Summary => dashboardCache.summary;

/* ---------- "Needs your attention" feed ---------- */

export type Marker = "square-red" | "dot-red" | "dot-purple" | "triangle-amber" | "dot-blue" | "dot-orange";

export interface AttentionItem {
  key: string;
  marker: Marker;
  title: string;
  subtitle: string;
  label: string;
  ref: { kind: "project"; id: string } | { kind: "task"; id: string };
}

export const attentionItems = (): AttentionItem[] => dashboardCache.attention;

/* ---------- Recent activity ---------- */

export interface Activity {
  id: string;
  createdAt: string; // ISO timestamp; the "5 min ago" label is computed at render time
  text: string;
}

export const activity: Activity[] = [];

export function agoLabel(minutes: number): string {
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}
