"use client";

import { useReducer, useState, type CSSProperties, type FormEvent } from "react";
import {
  projectById,
  projects,
  tasks,
  team,
  type Priority,
  type Task,
  type TaskState,
} from "@/lib/data";
import { useNow } from "./hooks";
import type { OpenRef } from "./Overview";
import { Modal } from "./ui";

/* ---------- Groups ---------- */

export type Group = "overdue" | "today" | "next2" | "week" | "later" | "blocked" | "done";

const groupOrder: Group[] = ["overdue", "today", "next2", "week", "later", "blocked", "done"];

export const groupMeta: Record<
  Group,
  { label: string; sub: string; bar: string; text: string; dot: string; tint: string; edge: string }
> = {
  overdue: {
    label: "Overdue",
    sub: "Past the due date",
    bar: "bg-(--g-overdue)",
    text: "text-(--g-overdue-strong)",
    dot: "bg-(--g-overdue)",
    tint: "bg-(--g-overdue)/6 border-(--g-overdue)/20",
    edge: "bg-(--g-overdue)",
  },
  today: {
    label: "Due today",
    sub: "Needs action now",
    bar: "bg-(--g-today)",
    text: "text-(--g-today-strong)",
    dot: "bg-(--g-today)",
    tint: "bg-(--g-today)/6 border-(--g-today)/20",
    edge: "bg-(--g-today)",
  },
  next2: {
    label: "Next 2 days",
    sub: "Tomorrow or the day after",
    bar: "bg-(--g-next2)",
    text: "text-(--g-next2-strong)",
    dot: "bg-(--g-next2)",
    tint: "bg-(--g-next2)/6 border-(--g-next2)/25",
    edge: "bg-(--g-next2)",
  },
  week: {
    label: "This week",
    sub: "Due in 3 to 7 days",
    bar: "bg-(--g-week)",
    text: "text-(--g-week-strong)",
    dot: "bg-(--g-week)",
    tint: "bg-surface border-line",
    edge: "bg-(--g-week)",
  },
  later: {
    label: "Later",
    sub: "More than a week away",
    bar: "bg-(--g-later)",
    text: "text-(--g-later-strong)",
    dot: "bg-(--g-later)",
    tint: "bg-surface border-line",
    edge: "bg-(--g-later)",
  },
  blocked: {
    label: "Blocked",
    sub: "Waiting on something",
    bar: "bg-st-purple",
    text: "text-st-purple",
    dot: "bg-st-purple",
    tint: "bg-st-purple/6 border-st-purple/20",
    edge: "bg-st-purple",
  },
  done: {
    label: "Done",
    sub: "Completed",
    bar: "bg-st-green",
    text: "text-st-green",
    dot: "bg-st-green",
    tint: "bg-surface border-line",
    edge: "bg-st-green",
  },
};

export function taskGroup(t: Task): Group {
  if (t.state === "done") return "done";
  if (t.state === "blocked") return "blocked";
  const d = t.dueOffset;
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 2) return "next2";
  if (d <= 7) return "week";
  return "later";
}

/* ---------- Alert colours (user adjustable) ---------- */

type AlertGroup = "overdue" | "today" | "next2" | "week" | "later";
type AlertColors = Partial<Record<AlertGroup, string>>;

const ALERT_GROUPS: { group: AlertGroup; base: string; strong: string; hex: string }[] = [
  { group: "overdue", base: "--red", strong: "--red-strong", hex: "#d63a40" },
  { group: "today", base: "--orange", strong: "--orange-strong", hex: "#e8730c" },
  { group: "next2", base: "--amber", strong: "--amber-strong", hex: "#f5b01a" },
  { group: "week", base: "--blue", strong: "--blue", hex: "#2f6fd6" },
  { group: "later", base: "--slate", strong: "--slate", hex: "#5a6f80" },
];

const COLORS_KEY = "taskAlertColors";

function loadColors(): AlertColors {
  try {
    if (typeof window === "undefined") return {};
    return JSON.parse(localStorage.getItem(COLORS_KEY) ?? "{}") as AlertColors;
  } catch {
    return {};
  }
}

function saveColors(c: AlertColors) {
  try {
    localStorage.setItem(COLORS_KEY, JSON.stringify(c));
  } catch {}
}

/* CSS variables the group classes read; custom picks get a darker/lighter text shade mixed with the ink colour. */
function colorVars(custom: AlertColors) {
  const vars: Record<string, string> = {};
  for (const { group, base, strong } of ALERT_GROUPS) {
    const c = custom[group];
    vars[`--g-${group}`] = c ?? `var(${base})`;
    vars[`--g-${group}-strong`] = c ? `color-mix(in srgb, ${c} 78%, var(--text))` : `var(${strong})`;
  }
  return vars as CSSProperties;
}

function AlertColorsPanel({
  colors,
  alerts,
  onChange,
  onReset,
  onAlerts,
}: {
  colors: AlertColors;
  alerts: boolean;
  onChange: (g: AlertGroup, hex: string) => void;
  onReset: () => void;
  onAlerts: (on: boolean) => void;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-6 shadow-sm" aria-label="Alert colors">
      <h3 className="text-lg font-bold">Alert colors</h3>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {ALERT_GROUPS.map(({ group, hex }) => (
          <label key={group} className="flex cursor-pointer items-center gap-3">
            <span className="flex rounded-lg border border-line bg-surface p-1.5 shadow-sm">
              <input
                type="color"
                value={colors[group] ?? hex}
                onChange={(e) => onChange(group, e.target.value)}
                className="color-swatch h-7 w-12 cursor-pointer"
              />
            </span>
            <span>{groupMeta[group].label}</span>
          </label>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <button onClick={onReset} className={`${control} hover:bg-track/50`}>
          Reset to default colors
        </button>
        <label className="flex cursor-pointer items-center gap-2 text-[15px]">
          <input
            type="checkbox"
            checked={alerts}
            onChange={(e) => onAlerts(e.target.checked)}
            className="h-4 w-4 accent-st-blue"
          />
          Tint overdue and urgent rows
        </label>
      </div>
    </section>
  );
}

export const STATES: { value: TaskState; label: string }[] = [
  { value: "not-started", label: "Not Started" },
  { value: "in-progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

type StatusFilter = "open" | "all" | TaskState;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "all", label: "All statuses" },
  ...STATES,
];

const priorityClass: Record<Priority, string> = {
  High: "text-st-red-strong",
  Medium: "text-st-orange-strong",
  Low: "text-muted",
};

/* ---------- Dates ---------- */

export const DAY_MS = 86_400_000;

export function addDays(base: Date, days: number) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function shortDate(d: Date) {
  const wd = d.toLocaleDateString("en-GB", { weekday: "short" });
  const m = d.toLocaleDateString("en-GB", { month: "short" });
  return `${wd}, ${d.getDate()} ${m}`;
}

export function dueText(t: Task) {
  const d = t.dueOffset;
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return `In ${d} days`;
}

// Read on each render so newly added employees appear in owner pickers straight away.
const getOwners = () => Array.from(new Set([...team.map((m) => m.name), ...tasks.map((t) => t.owner)]));

/* ---------- Pieces ---------- */

export const control =
  "h-10 rounded-lg border border-line bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-st-blue focus:ring-2 focus:ring-st-blue/20";

function GroupCard({
  group,
  count,
  active,
  onClick,
}: {
  group: Group;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const m = groupMeta[group];
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col overflow-hidden rounded-xl border bg-surface text-left shadow-sm card-hover ${
        active ? "border-ink ring-2 ring-ink/15" : "border-line"
      }`}
    >
      <div className={`h-1 ${m.bar}`} />
      <div className="w-full px-3.5 pb-3.5 pt-3.5 xl:px-4">
        <div className={`text-[1.75rem] font-bold leading-none ${m.text}`}>{count}</div>
        <div className="mt-1.5 truncate text-[15px] font-semibold">{m.label}</div>
        <div className="truncate text-[13px] text-muted" title={m.sub}>
          {m.sub}
        </div>
      </div>
    </button>
  );
}

function TaskRow({
  task,
  now,
  alerts,
  onOpen,
  onState,
}: {
  task: Task;
  now: Date | null;
  alerts: boolean;
  onOpen: () => void;
  onState: (s: TaskState) => void;
}) {
  const g = taskGroup(task);
  const m = groupMeta[g];
  const urgent = g === "overdue" || g === "today";
  const dueColor = g === "done" ? "text-muted" : alerts && g !== "week" && g !== "later" ? m.text : "text-ink";

  return (
    <li
      onClick={onOpen}
      className={`relative card-hover grid grid-cols-1 items-center gap-x-4 gap-y-1.5 rounded-lg border py-2.5 pl-6 pr-4 lg:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_4.5rem_9.5rem] desk:grid-cols-[minmax(0,4.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(9rem,0.95fr)] ${
        alerts ? m.tint : "border-line bg-surface"
      }`}
    >
      <span className={`absolute bottom-2.5 left-0 top-2.5 w-1 rounded-r ${m.edge}`} aria-hidden />
      <div className="min-w-0">
        <div className="text-[15px] font-bold leading-snug">{projectById(task.projectId).name}</div>
        <div className={`text-[14px] leading-snug ${g === "done" ? "text-muted line-through" : "text-ink/85"}`}>{task.title}</div>
      </div>
      <div className="truncate text-[15px]">{task.owner}</div>
      <div>
        <div className={`text-[15px] leading-snug ${urgent ? "font-bold" : "font-semibold"} ${dueColor}`}>
          {g === "done" ? "Done" : dueText(task)}
        </div>
        <div className="text-[13px] text-muted" suppressHydrationWarning>
          {now ? shortDate(addDays(now, task.dueOffset)) : " "}
        </div>
      </div>
      <div className={`text-sm font-semibold ${priorityClass[task.priority]}`}>{task.priority}</div>
      <select
        aria-label={`Status of ${task.title}`}
        value={task.state}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onState(e.target.value as TaskState)}
        className={`${control} h-9! w-full rounded-md! px-3! text-sm!`}
      >
        {STATES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </li>
  );
}

function CalendarView({
  rows,
  now,
  onOpen,
}: {
  rows: Task[];
  now: Date | null;
  onOpen: (id: string) => void;
}) {
  const [monthShift, setMonthShift] = useState(0);
  if (!now) return null;

  const first = new Date(now.getFullYear(), now.getMonth() + monthShift, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const today = addDays(now, 0).getTime();

  const byDay = new Map<number, Task[]>();
  for (const t of rows) {
    const key = addDays(now, t.dueOffset).getTime();
    byDay.set(key, [...(byDay.get(key) ?? []), t]);
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold">
          {first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </h3>
        <div className="flex gap-2">
          <button onClick={() => setMonthShift((s) => s - 1)} className="rounded-lg border border-line px-3 py-1.5 hover:bg-track" aria-label="Previous month">
            ‹
          </button>
          <button onClick={() => setMonthShift(0)} className="rounded-lg border border-line px-3 py-1.5 hover:bg-track">
            Today
          </button>
          <button onClick={() => setMonthShift((s) => s + 1)} className="rounded-lg border border-line px-3 py-1.5 hover:bg-track" aria-label="Next month">
            ›
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-lg border border-line">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="border-b border-line bg-track/40 px-2 py-2 text-sm font-semibold text-muted">
              {d}
            </div>
          ))}
          {Array.from({ length: cells }, (_, i) => {
            const date = new Date(first.getFullYear(), first.getMonth(), i - lead + 1);
            const inMonth = date.getMonth() === first.getMonth();
            const isToday = date.getTime() === today;
            const items = byDay.get(date.getTime()) ?? [];
            return (
              <div
                key={i}
                className={`min-h-28 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0 ${inMonth ? "" : "bg-track/25 text-muted"}`}
              >
                <div
                  className={`mb-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                    isToday ? "bg-header font-bold text-white dark:bg-accent dark:text-header" : ""
                  }`}
                >
                  {date.getDate()}
                </div>
                <div className="space-y-1">
                  {items.map((t) => {
                    const m = groupMeta[taskGroup(t)];
                    return (
                      <button
                        key={t.id}
                        onClick={() => onOpen(t.id)}
                        title={`${t.title} · ${t.owner}`}
                        className={`flex w-full items-center gap-1.5 truncate rounded border px-1.5 py-0.5 text-left text-xs ${m.tint}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} />
                        <span className="truncate">{t.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function NewTaskForm({
  now,
  onCreate,
  defaultProjectId = projects[0].id,
}: {
  now: Date | null;
  onCreate: (t: Task) => void;
  defaultProjectId?: string;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId);
  const owners = getOwners();
  const [owner, setOwner] = useState(owners[0]);
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !due || !now) return;
    const [y, mo, d] = due.split("-").map(Number);
    const dueOffset = Math.round((new Date(y, mo - 1, d).getTime() - addDays(now, 0).getTime()) / DAY_MS);
    onCreate({
      id: `t${Date.now()}`,
      title: title.trim(),
      owner,
      projectId,
      dueOffset,
      priority,
      state: "not-started",
    });
  };

  const field = "flex flex-col gap-1.5 text-sm font-semibold";
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className={field}>
        Title
        <input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} className={`${control} font-normal`} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={field}>
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${control} font-normal`}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Owner
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className={`${control} font-normal`}>
            {owners.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className={field}>
          Due date
          <input type="date" required value={due} onChange={(e) => setDue(e.target.value)} className={`${control} font-normal`} />
        </label>
        <label className={field}>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={`${control} font-normal`}>
            {(["High", "Medium", "Low"] as const).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-end pt-2">
        <button type="submit" className="rounded-lg bg-header px-5 py-2.5 font-semibold text-white hover:opacity-90 dark:bg-accent dark:text-header">
          Create task
        </button>
      </div>
    </form>
  );
}

/* ---------- View ---------- */

export function TasksView({
  onOpen,
  initialFocus = null,
}: {
  onOpen: (ref: OpenRef) => void;
  initialFocus?: Group | null; // pre-select a summary card when arriving from the Overview
}) {
  const now = useNow();
  // Tasks live in the shared sample-data array so edits show up on every tab; bump to re-render.
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [mode, setMode] = useState<"list" | "calendar">("list");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [project, setProject] = useState("all");
  const [owner, setOwner] = useState("all");
  const [alerts, setAlerts] = useState(true);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [colors, setColors] = useState<AlertColors>(loadColors);
  const updateColors = (next: AlertColors) => {
    setColors(next);
    saveColors(next);
  };
  const [focus, setFocus] = useState<Group | null>(initialFocus);
  const [creating, setCreating] = useState(false);

  const owners = getOwners();
  const counts = Object.fromEntries(groupOrder.map((g) => [g, 0])) as Record<Group, number>;
  for (const t of tasks) counts[taskGroup(t)]++;

  const q = query.trim().toLowerCase();
  const rows = tasks
    .filter((t) => (status === "open" ? t.state !== "done" : status === "all" || t.state === status))
    .filter((t) => project === "all" || t.projectId === project)
    .filter((t) => owner === "all" || t.owner === owner)
    .filter((t) => !focus || taskGroup(t) === focus)
    .filter(
      (t) =>
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.owner.toLowerCase().includes(q) ||
        projectById(t.projectId).name.toLowerCase().includes(q),
    )
    .sort((a, b) => a.dueOffset - b.dueOffset);

  const grouped = groupOrder
    .map((g) => ({ group: g, items: rows.filter((t) => taskGroup(t) === g) }))
    .filter((x) => x.items.length > 0);

  const action = counts.overdue + counts.today;

  const setState = (t: Task, s: TaskState) => {
    t.state = s;
    bump();
  };

  const toggleBtn = (m: "list" | "calendar", label: string) => (
    <button
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`px-4 py-2 text-[15px] ${
        mode === m ? "bg-header font-medium text-white dark:bg-accent dark:text-header" : "bg-surface text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6" style={colorVars(colors)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[1.625rem] font-bold leading-tight tracking-tight">Tasks &amp; Deadlines</h2>
          <p className="mt-1 text-muted">
            {action} item{action === 1 ? "" : "s"} need{action === 1 ? "s" : ""} action today: {counts.overdue} overdue, {counts.today} due
            today.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="View">
            {toggleBtn("list", "List")}
            {toggleBtn("calendar", "Calendar")}
          </div>
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-header px-5 py-2 text-[15px] font-semibold text-white hover:opacity-90 dark:bg-accent dark:text-header"
          >
            New task
          </button>
        </div>
      </div>

      {colorsOpen && (
        <AlertColorsPanel
          colors={colors}
          alerts={alerts}
          onChange={(g, hex) => updateColors({ ...colors, [g]: hex })}
          onReset={() => updateColors({})}
          onAlerts={setAlerts}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 desk:grid-cols-6 xl:gap-4">
        {groupOrder
          .filter((g) => g !== "done")
          .map((g) => (
            <GroupCard key={g} group={g} count={counts[g]} active={focus === g} onClick={() => setFocus(focus === g ? null : g)} />
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks, projects or people"
          aria-label="Search tasks"
          className={`${control} h-11! w-full placeholder:text-muted desk:w-auto desk:min-w-[14rem] desk:flex-1`}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status" className={`${control} w-36`}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className={`${control} w-56`}>
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" className={`${control} w-40`}>
          <option value="all">Everyone</option>
          {owners.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <button
          onClick={() => setColorsOpen((o) => !o)}
          aria-expanded={colorsOpen}
          className={`${control} hover:bg-track/50`}
        >
          {colorsOpen ? "Close colors" : "Alert colors"}
        </button>
      </div>

      {focus && (
        <div className="-mt-3 flex items-center gap-2 text-muted">
          Showing only <b className="text-ink">{groupMeta[focus].label}</b>
          <button onClick={() => setFocus(null)} className="rounded px-1.5 underline hover:text-ink">
            Clear
          </button>
        </div>
      )}

      {mode === "calendar" ? (
        <CalendarView rows={rows} now={now} onOpen={(id) => onOpen({ kind: "task", id })} />
      ) : grouped.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface py-12 text-center text-muted">
          No tasks match these filters.
        </p>
      ) : (
        grouped.map(({ group, items }) => {
          const m = groupMeta[group];
          return (
            <section key={group}>
              <h3 className="mb-2.5 flex items-center gap-2.5 text-base">
                <span className={`h-3 w-3 rounded-full ${m.dot}`} aria-hidden />
                <span className="font-semibold">
                  {m.label} ({items.length})
                </span>
                <span className="text-muted">{m.sub}</span>
              </h3>
              <ul className="space-y-2">
                {items.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    now={now}
                    alerts={alerts}
                    onOpen={() => onOpen({ kind: "task", id: t.id })}
                    onState={(s) => setState(t, s)}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {creating && (
        <Modal title="New task" onClose={() => setCreating(false)}>
          <NewTaskForm
            now={now}
            onCreate={(t) => {
              tasks.push(t);
              setCreating(false);
              bump();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
