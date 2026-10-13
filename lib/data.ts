// Sample data for the dashboard. Replace with your own data source (API, DB, etc.).
// Dates are stored as day offsets from today so the demo always looks "current".

export type ProjectStatus = "off-track" | "watch" | "on-track" | "not-started";
export type TaskState = "not-started" | "in-progress" | "blocked" | "done";
export type Priority = "High" | "Medium" | "Low";

export type ProjectPhase = "Not Started" | "In Progress" | "At Risk" | "On Hold" | "Completed";

export interface ProjectMember {
  name: string;
  role: string;
}

export interface Project {
  id: string;
  name: string;
  department: string;
  lead: string;
  phase: ProjectPhase; // status set by the project lead
  description: string;
  startOffset: number; // days from today (negative = already started)
  endOffset: number; // days from today
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
  dueOffset: number; // days from today (negative = overdue)
  state: TaskState;
  priority: Priority;
  note?: string;
}

export interface Member {
  name: string;
  title: string; // job title
  role: string; // department
  load: number; // % of capacity allocated
}

export const projects: Project[] = [
  {
    id: "erp",
    name: "ERP Migration",
    department: "Technology Infrastructure",
    lead: "Vikram Singh",
    phase: "At Risk",
    description:
      "Move finance, inventory and procurement from the legacy system to the new ERP. Data cleanup took longer than planned and the cut-over date is now tight, so this needs leadership attention.",
    startOffset: -90,
    endOffset: 8,
    done: 71,
    decision: "Approve a revised cut-over date",
    objectives: [
      "Migrate all open purchase orders without loss",
      "Train 120 staff before go-live",
      "Retire the legacy server by year end",
    ],
    members: [
      { name: "Priya Nair", role: "Technical Advisor" },
      { name: "Sneha Reddy", role: "Budget Owner" },
      { name: "Vikram Singh", role: "Project Lead" },
      { name: "Karthik Rao", role: "Integration Developer" },
      { name: "Meera Joshi", role: "Quality Assurance" },
    ],
    history: [
      { id: "erp-h1", minutesAgo: 46, text: "Karthik Rao marked “Legacy inventory data validation” as Blocked" },
      { id: "erp-h2", minutesAgo: 4320, text: "Vikram Singh changed ERP Migration from In Progress to At Risk" },
      { id: "erp-h3", minutesAgo: 10080, text: "Vikram Singh updated progress from 64% to 71%" },
      { id: "erp-h4", minutesAgo: 11520, text: "Karthik Rao marked “Payroll module configuration” as Done" },
    ],
  },
  {
    id: "budget",
    name: "Annual Budget FY27",
    department: "Finance & Planning",
    lead: "Sneha Reddy",
    phase: "In Progress",
    description: "Consolidate department budgets and present the FY27 plan to the board.",
    startOffset: -31,
    endOffset: 5,
    done: 80,
    decision: "Confirm revenue targets before the board pack goes out",
    objectives: [
      "Collect budget summaries from every department",
      "Agree the capex envelope with the CFO",
      "Present the FY27 plan to the board",
    ],
    members: [
      { name: "Sneha Reddy", role: "Project Lead" },
      { name: "Rahul Verma", role: "Product Input" },
    ],
    history: [
      { id: "budget-h1", minutesAgo: 240, text: "Sneha Reddy updated progress from 72% to 80%" },
      { id: "budget-h2", minutesAgo: 2880, text: "Sneha Reddy added “Prepare board approval pack”" },
    ],
  },
  {
    id: "brand",
    name: "Brand Campaign Q4",
    department: "Marketing",
    lead: "Ananya Iyer",
    phase: "In Progress",
    description: "Integrated Q4 brand campaign across digital, print and events.",
    startOffset: -20,
    endOffset: 25,
    done: 45,
    objectives: [
      "Launch across digital, print and events",
      "Grow branded search volume by 20%",
      "Stay within the approved media budget",
    ],
    members: [
      { name: "Ananya Iyer", role: "Project Lead" },
      { name: "Rahul Verma", role: "Product Marketing" },
    ],
    history: [{ id: "brand-h1", minutesAgo: 2900, text: "Ananya Iyer updated progress from 38% to 45%" }],
  },
  {
    id: "portal",
    name: "Customer Portal Revamp",
    department: "Software Development",
    lead: "Priya Nair",
    phase: "In Progress",
    description: "Redesign the customer self-service portal with new billing views.",
    startOffset: -45,
    endOffset: 40,
    done: 62,
    objectives: [
      "Ship the new billing views",
      "Cut billing support tickets by 30%",
      "Meet WCAG 2.1 AA accessibility",
    ],
    members: [
      { name: "Priya Nair", role: "Project Lead" },
      { name: "Rahul Verma", role: "Product Owner" },
      { name: "Meera Joshi", role: "Quality Assurance" },
      { name: "Karthik Rao", role: "Frontend Developer" },
    ],
    history: [
      { id: "portal-h1", minutesAgo: 1500, text: "Priya Nair updated progress from 55% to 62%" },
      { id: "portal-h2", minutesAgo: 10100, text: "Rahul Verma updated progress from 48% to 55%" },
    ],
  },
  {
    id: "warehouse",
    name: "Warehouse Automation",
    department: "Operations",
    lead: "Vikram Singh",
    phase: "Not Started",
    description: "Automate picking and stock tracking at the main warehouse.",
    startOffset: 10,
    endOffset: 120,
    done: 0,
    objectives: ["Select an automation vendor", "Automate picking in zone A", "Track stock in real time"],
    members: [{ name: "Vikram Singh", role: "Project Lead" }],
    history: [{ id: "warehouse-h1", minutesAgo: 4400, text: "Vikram Singh marked “Draft warehouse automation business case” as Done" }],
  },
];

export const tasks: Task[] = [
  { id: "t1", title: "Approve final data migration sign-off", owner: "Vikram Singh", projectId: "erp", dueOffset: -2, state: "in-progress", priority: "High" },
  { id: "t2", title: "Submit department budget summaries", owner: "Sneha Reddy", projectId: "budget", dueOffset: -1, state: "in-progress", priority: "High" },
  {
    id: "t3",
    title: "Legacy inventory data validation",
    owner: "Karthik Rao",
    projectId: "erp",
    dueOffset: 4,
    state: "blocked",
    priority: "High",
    note: "The legacy export file is incomplete. Waiting for the vendor to resend it.",
  },
  { id: "t4", title: "User training session for procurement team", owner: "Vikram Singh", projectId: "erp", dueOffset: 0, state: "in-progress", priority: "Medium" },
  { id: "t14", title: "Finalise campaign creative brief", owner: "Ananya Iyer", projectId: "brand", dueOffset: 0, state: "not-started", priority: "High" },
  { id: "t5", title: "Finalise portal release notes", owner: "Rahul Verma", projectId: "portal", dueOffset: 1, state: "not-started", priority: "Medium" },
  { id: "t6", title: "Media plan approval", owner: "Ananya Iyer", projectId: "brand", dueOffset: 2, state: "in-progress", priority: "Medium" },
  { id: "t15", title: "Deliver order tracking page", owner: "Karthik Rao", projectId: "portal", dueOffset: 2, state: "in-progress", priority: "High" },
  { id: "t7", title: "User acceptance testing – round 2", owner: "Meera Joshi", projectId: "portal", dueOffset: 4, state: "in-progress", priority: "Medium" },
  { id: "t8", title: "Shortlist automation vendors", owner: "Vikram Singh", projectId: "warehouse", dueOffset: 18, state: "not-started", priority: "Medium" },
  { id: "t9", title: "Portal accessibility audit", owner: "Meera Joshi", projectId: "portal", dueOffset: 15, state: "not-started", priority: "Low" },
  { id: "t12", title: "Prepare board approval pack", owner: "Sneha Reddy", projectId: "budget", dueOffset: 5, state: "not-started", priority: "High" },
  { id: "t13", title: "Sign off portal billing screens", owner: "Rahul Verma", projectId: "portal", dueOffset: 6, state: "not-started", priority: "Low" },
  { id: "t10", title: "Draft warehouse automation business case", owner: "Vikram Singh", projectId: "warehouse", dueOffset: -5, state: "done", priority: "Medium" },
  { id: "t11", title: "Payroll module configuration", owner: "Karthik Rao", projectId: "erp", dueOffset: -8, state: "done", priority: "High" },
];

export const team: Member[] = [
  { name: "Vikram Singh", title: "Operations Manager", role: "Operations", load: 118 },
  { name: "Sneha Reddy", title: "Finance Controller", role: "Finance", load: 92 },
  { name: "Karthik Rao", title: "Senior Developer", role: "Engineering", load: 88 },
  { name: "Meera Joshi", title: "QA Lead", role: "Engineering", load: 76 },
  { name: "Rahul Verma", title: "Product Manager", role: "Product", load: 65 },
  { name: "Priya Nair", title: "Engineering Manager", role: "Engineering", load: 80 },
  { name: "Ananya Iyer", title: "Marketing Head", role: "Marketing", load: 84 },
];

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

const workloadOrder: WorkloadKind[] = ["overdue", "blocked", "soon", "later"];

export function teamWorkload() {
  return team
    .map((m) => {
      const open = tasks
        .filter((t) => t.owner === m.name && t.state !== "done")
        .map(workloadKind)
        .sort((a, b) => workloadOrder.indexOf(a) - workloadOrder.indexOf(b));
      return { ...m, open, stretched: m.load > STRETCHED_THRESHOLD };
    })
    .filter((m) => m.open.length > 0)
    .sort((a, b) => b.open.length - a.open.length);
}

/* ---------- Key dates ---------- */

export interface KeyDate {
  key: string;
  offset: number;
  title: string;
  lead: string;
  projectId: string;
}

export function keyDates(withinDays = 30): KeyDate[] {
  const inRange = (d: number) => d >= 0 && d <= withinDays;
  return projects
    .flatMap((p) => [
      ...(inRange(p.endOffset) ? [{ key: `${p.id}-end`, offset: p.endOffset, title: `${p.name} deadline`, lead: p.lead, projectId: p.id }] : []),
      ...(inRange(p.startOffset) && p.startOffset > 0
        ? [{ key: `${p.id}-start`, offset: p.startOffset, title: `${p.name} starts`, lead: p.lead, projectId: p.id }]
        : []),
    ])
    .sort((a, b) => a.offset - b.offset);
}

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

export function summary() {
  const statuses = projects.map(projectStatus);
  const count = (s: ProjectStatus) => statuses.filter((x) => x === s).length;
  const buckets = tasks.map(taskBucket);
  const countB = (b: TaskBucket) => buckets.filter((x) => x === b).length;
  return {
    total: projects.length,
    inFlight: projects.length - count("not-started"),
    notStarted: count("not-started"),
    offTrack: count("off-track"),
    watch: count("watch"),
    onTrack: count("on-track"),
    overdue: countB("overdue"),
    dueToday: countB("today"),
    blocked: countB("blocked"),
    stretched: team.filter((m) => m.load > STRETCHED_THRESHOLD).length,
  };
}

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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function projectItem(p: Project, status: "off-track" | "watch"): AttentionItem {
  const overdue = tasks.filter((t) => t.projectId === p.id && taskBucket(t) === "overdue").length;
  const overdueText = overdue ? `${plural(overdue, "task")} overdue` : "";
  return {
    key: `p-${p.id}`,
    marker: status === "off-track" ? "square-red" : "triangle-amber",
    title: p.name,
    subtitle:
      status === "off-track"
        ? `Behind schedule: ${p.done}% done with ${timeUsed(p)}% of the time used.${overdueText ? ` ${overdueText}` : ""}`
        : overdueText || `${p.done}% done with ${timeUsed(p)}% of the time used`,
    label: status === "off-track" ? "Off track" : "Needs watching",
    ref: { kind: "project", id: p.id },
  };
}

function taskItem(t: Task, marker: Marker): AttentionItem {
  const p = projectById(t.projectId);
  return {
    key: `t-${t.id}`,
    marker,
    title: t.title,
    subtitle: [t.owner, p.name, t.note].filter(Boolean).join(" · "),
    label: dueLabel(t),
    ref: { kind: "task", id: t.id },
  };
}

export function attentionItems(): AttentionItem[] {
  const byStatus = (s: ProjectStatus) => projects.filter((p) => projectStatus(p) === s);
  const byBucket = (b: TaskBucket) => tasks.filter((t) => taskBucket(t) === b);
  return [
    ...byStatus("off-track").map((p) => projectItem(p, "off-track")),
    ...byBucket("overdue")
      .sort((a, b) => a.dueOffset - b.dueOffset)
      .map((t) => taskItem(t, "dot-red")),
    ...byBucket("blocked").map((t) => taskItem(t, "dot-purple")),
    ...byStatus("watch").map((p) => projectItem(p, "watch")),
    ...byBucket("today").map((t) => taskItem(t, "dot-orange")),
  ];
}

/* ---------- Recent activity ---------- */

export interface Activity {
  id: string;
  minutesAgo: number;
  text: string;
}

export const activity: Activity[] = [
  { id: "a1", minutesAgo: 39, text: "You updated ERP Migration progress from 64% to 71%" },
  {
    id: "a2",
    minutesAgo: 55,
    text: "Sneha Reddy asked for a decision on Annual Budget FY27: Confirm revenue targets before the board pack goes out",
  },
  { id: "a3", minutesAgo: 55, text: "You asked for a decision on ERP Migration: Approve a revised cut-over date" },
  { id: "a4", minutesAgo: 120, text: "Karthik Rao marked “Legacy inventory data validation” as Blocked" },
  { id: "a5", minutesAgo: 240, text: "Sneha Reddy updated Annual Budget FY27 progress from 72% to 80%" },
  { id: "a6", minutesAgo: 1500, text: "Priya Nair updated Customer Portal Revamp progress from 55% to 62%" },
  { id: "a7", minutesAgo: 2900, text: "Ananya Iyer updated Brand Campaign Q4 progress from 38% to 45%" },
  { id: "a8", minutesAgo: 4400, text: "Vikram Singh marked “Draft warehouse automation business case” as Done" },
  { id: "a9", minutesAgo: 7300, text: "Karthik Rao marked “Payroll module configuration” as Done" },
  { id: "a10", minutesAgo: 10100, text: "Rahul Verma updated Customer Portal Revamp progress from 48% to 55%" },
];

export function agoLabel(minutes: number): string {
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}
