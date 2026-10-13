"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  projectStatus,
  projects,
  startsInLabel,
  tasks,
  team,
  timeUsed,
  type Project,
  type ProjectPhase,
  type ProjectStatus,
  agoLabel,
} from "@/lib/data";
import { api, errorMessage } from "@/lib/api";
import { loadMoreProjectHistory, loadProjectHistory, memberId, mutate, nowMs, numericId, SCOPES, useStore, type Scope } from "@/lib/store";
import { addDaysIso, isoToLocalDate, minutesBetween } from "@/lib/serverClock";
import { useNow } from "./hooks";
import type { OpenRef } from "./Overview";
import { addDays, control, dueText, NewTaskForm, taskGroup } from "./TasksView";
import { barColor, Modal, ProgressBar, StatusBadge } from "./ui";

/* ---------- Helpers ---------- */

const PHASES: ProjectPhase[] = ["Not Started", "In Progress", "At Risk", "On Hold", "Completed"];

const STATUS_FILTERS: { value: ProjectStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "off-track", label: "Off track" },
  { value: "watch", label: "Needs watching" },
  { value: "on-track", label: "On track" },
  { value: "not-started", label: "Not started" },
];

type Sort = "attention" | "deadline" | "progress" | "name";

const SORTS: { value: Sort; label: string }[] = [
  { value: "attention", label: "Needs attention first" },
  { value: "deadline", label: "Deadline soonest" },
  { value: "progress", label: "Most progress" },
  { value: "name", label: "Name A to Z" },
];

const attentionRank: ProjectStatus[] = ["off-track", "watch", "on-track", "not-started"];

const sorters: Record<Sort, (a: Project, b: Project) => number> = {
  attention: (a, b) =>
    attentionRank.indexOf(projectStatus(a)) - attentionRank.indexOf(projectStatus(b)) || a.endOffset - b.endOffset,
  deadline: (a, b) => a.endOffset - b.endOffset,
  progress: (a, b) => b.done - a.done,
  name: (a, b) => a.name.localeCompare(b.name),
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function healthPoints(p: Project): string[] {
  const status = projectStatus(p);
  const used = timeUsed(p);
  const open = tasks.filter((t) => t.projectId === p.id);
  const overdue = open.filter((t) => taskGroup(t) === "overdue").length;
  const blocked = open.filter((t) => t.state === "blocked").length;
  const points = [
    {
      "off-track": `Behind schedule: ${p.done}% done with ${used}% of the time used`,
      watch: `Slightly behind: ${p.done}% done with ${used}% of the time used`,
      "on-track": `On schedule: ${p.done}% done with ${used}% of the time used`,
      "not-started": startsInLabel(p),
    }[status],
  ];
  if (overdue) points.push(`${plural(overdue, "task")} overdue`);
  if (blocked) points.push(`${plural(blocked, "task")} blocked`);
  if (p.phase === "At Risk") points.push("Marked at risk by the project lead");
  if (p.phase === "On Hold") points.push("Put on hold by the project lead");
  return points;
}

function timeLeft(p: Project) {
  if (p.phase === "Completed") return "Completed";
  const d = p.endOffset;
  if (d < 0) return `${plural(-d, "day")} past deadline`;
  if (d === 0) return "Due today";
  return plural(d, "day");
}

/* ---------- Pieces ---------- */

const sectionTitle = "text-sm font-semibold uppercase tracking-wider text-muted";
const tile = "rounded-lg bg-track/50 px-3.5 py-2.5";
const outlineBtn = "rounded-lg border border-line bg-surface px-4 text-[15px] hover:bg-track/50";

function Tile({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={tile}>
      <div className="mb-1 text-sm text-muted">{label}</div>
      {children}
    </div>
  );
}

function ProjectCard({
  p,
  now,
  active,
  onSelect,
}: {
  p: Project;
  now: Date | null;
  active: boolean;
  onSelect: () => void;
}) {
  const status = projectStatus(p);
  const used = timeUsed(p);
  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={`w-full rounded-xl border px-4 py-3 text-left shadow-sm card-hover ${
        active ? "border-ink bg-accent/10" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="pt-0.5 text-base font-bold">{p.name}</h3>
        <StatusBadge status={status} />
      </div>
      <p className="mt-0.5 text-sm text-muted">
        {p.department} · Lead {p.lead}
      </p>
      <div className="mt-2.5">
        <ProgressBar done={p.done} time={used} status={status} />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 text-[13px] text-muted">
        <span>
          {p.done}% done{status !== "not-started" && ` · ${used}% of time used`}
        </span>
        <span suppressHydrationWarning>{now && `Due ${longDate(isoToLocalDate(p.endDate))}`}</span>
      </div>
    </button>
  );
}

function Timeline({ list, now, onSelect }: { list: Project[]; now: Date | null; onSelect: (id: string) => void }) {
  if (!now) return null;
  const from = Math.min(0, ...list.map((p) => p.startOffset));
  const to = Math.max(0, ...list.map((p) => p.endOffset));
  const first = addDays(now, from);
  const start = new Date(first.getFullYear(), first.getMonth(), 1);
  const lastDay = addDays(now, to);
  const end = new Date(lastDay.getFullYear(), lastDay.getMonth() + 1, 1);
  const span = end.getTime() - start.getTime();
  const pos = (d: Date) => ((d.getTime() - start.getTime()) / span) * 100;

  const months: Date[] = [];
  for (let m = new Date(start); m < end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months.push(m);
  const todayPos = pos(addDays(now, 0));

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[15rem_minmax(0,1fr)] border-b border-line pb-2 text-sm text-muted">
            <span>Project</span>
            <div className="relative h-5">
              {months.map((m) => (
                <span key={m.getTime()} className="absolute top-0 border-l border-line pl-1.5" style={{ left: `${pos(m)}%` }}>
                  {m.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}
                </span>
              ))}
            </div>
          </div>
          <ul>
            {list.map((p) => {
              const status = projectStatus(p);
              const left = pos(addDays(now, p.startOffset));
              const width = pos(addDays(now, p.endOffset)) - left;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => onSelect(p.id)}
                    className="grid w-full grid-cols-[15rem_minmax(0,1fr)] items-center border-b border-line py-4 text-left hover:bg-track/30"
                  >
                    <span className="pr-4">
                      <span className="block font-semibold">{p.name}</span>
                      <span className="text-sm text-muted">{p.lead}</span>
                    </span>
                    <span className="relative block h-8">
                      {months.map((m) => (
                        <span key={m.getTime()} className="absolute inset-y-0 border-l border-line/60" style={{ left: `${pos(m)}%` }} />
                      ))}
                      <span
                        className="absolute top-1 h-6 overflow-hidden rounded-md bg-track"
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${p.done}% done`}
                      >
                        <span className={`block h-full ${barColor(status)}`} style={{ width: `${p.done}%` }} />
                      </span>
                      <span className="absolute -top-1 bottom-[-0.25rem] w-0.5 bg-ink" style={{ left: `${todayPos}%` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm text-muted">Filled part: work completed. Dark line: today.</p>
        </div>
      </div>
    </section>
  );
}

function NewProjectForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [lead, setLead] = useState(team[0]?.name ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (end <= start) return setError("The deadline must be after the start date.");
    setSaving(true);
    setError("");
    try {
      // The server sets phase, progress, the lead's team entry and the first history entry.
      const created = await mutate(() =>
        api.createProject({
          name: name.trim(),
          department: department.trim(),
          lead_id: memberId(lead),
          start_date: start,
          end_date: end,
          description: description.trim(),
        }),
        SCOPES.newProject,
      );
      onCreated(String(created.id));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const field = "flex flex-col gap-1.5 text-sm font-semibold";
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className={field}>
        Name
        <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} className={`${control} font-normal`} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={field}>
          Department
          <input value={department} onChange={(e) => setDepartment(e.target.value)} className={`${control} font-normal`} />
        </label>
        <label className={field}>
          Project lead
          <select value={lead} onChange={(e) => setLead(e.target.value)} className={`${control} font-normal`}>
            {team.map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </select>
        </label>
        <label className={field}>
          Start date
          <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={`${control} font-normal`} />
        </label>
        <label className={field}>
          Deadline
          <input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} className={`${control} font-normal`} />
        </label>
      </div>
      <label className={field}>
        Description
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-lg border border-line bg-surface px-4 py-2 font-normal outline-none focus:border-st-blue focus:ring-2 focus:ring-st-blue/20"
        />
      </label>
      {error && <p role="alert" className="text-st-red-strong">{error}</p>}
      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-header px-5 py-2.5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-accent dark:text-header"
        >
          {saving ? "Creating..." : "Create project"}
        </button>
      </div>
    </form>
  );
}

function ProjectDetail({
  p,
  now,
  onOpenTask,
  onAddTask,
}: {
  p: Project;
  now: Date | null;
  onOpenTask: (id: string) => void;
  onAddTask: () => void;
}) {
  const [objective, setObjective] = useState("");
  const candidates = team.filter((m) => !p.members.some((x) => x.name === m.name));
  const [newMember, setNewMember] = useState("");
  const [newRole, setNewRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // While dragging the slider or typing a decision, the new value lives here; the server gets it once, on release / blur.
  const [dragProgress, setDragProgress] = useState<number | null>(null);
  const [decisionDraft, setDecisionDraft] = useState<string | null>(null);
  const committing = useRef(false);
  const pid = numericId(p.id);
  const feed = useStore().histories[p.id];
  // The history is loaded lazily: only when this project's detail panel is open (first page, then "Load more").
  useEffect(() => {
    void loadProjectHistory(p.id);
  }, [p.id]);

  const progress = dragProgress ?? p.done;
  const live = progress === p.done ? p : { ...p, done: progress };
  const status = projectStatus(live);
  const used = timeUsed(live);
  const openWork = tasks.filter((t) => t.projectId === p.id && t.state !== "done").sort((a, b) => a.dueOffset - b.dueOffset);
  const memberToAdd = newMember || candidates[0]?.name || "";

  /** Send one change to the server, refetch, and show the server's message if it was refused. */
  const run = async (write: () => Promise<unknown>, scope: readonly Scope[] = SCOPES.projectEdit) => {
    setBusy(true);
    setError("");
    try {
      await mutate(write, scope);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const commitProgress = async () => {
    if (dragProgress === null || committing.current) return;
    committing.current = true;
    if (dragProgress !== p.done) await run(() => api.updateProject(pid, { progress: dragProgress }));
    setDragProgress(null);
    committing.current = false;
  };

  const commitDecision = async () => {
    if (decisionDraft === null || committing.current) return;
    if (decisionDraft.trim() === (p.decision ?? "")) return setDecisionDraft(null);
    committing.current = true;
    if (await run(() => api.setDecision(pid, decisionDraft.trim()), SCOPES.decision)) setDecisionDraft(null);
    committing.current = false;
  };

  return (
    <article className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-st-red/8 px-3 py-2 text-sm font-medium text-st-red-strong">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold leading-tight tracking-tight">{p.name}</h2>
          <span className="mt-1.5 inline-block rounded-full bg-track/70 px-2.5 py-0.5 text-sm text-muted">{p.department}</span>
        </div>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Status
          <select
            value={p.phase}
            disabled={busy}
            onChange={(e) => void run(() => api.updateProject(pid, { phase: e.target.value }))}
            className={`${control} w-40`}
          >
            {PHASES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 rounded-lg bg-track/50 px-4 py-3.5">
        <StatusBadge status={status} />
        <ul className="mt-2 list-disc space-y-0.5 pl-6 text-[15px]">
          {healthPoints(live).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Project lead">
          <select
            value={p.lead}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value;
              void run(() => api.updateProject(pid, { lead_id: memberId(next) }));
            }}
            className={`${control} w-full`}
          >
            {team.map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </select>
        </Tile>
        <Tile label="Start date">
          <input
            type="date"
            value={p.startDate}
            max={addDaysIso(p.endDate, -1)}
            onChange={(e) => e.target.value && void run(() => api.updateProject(pid, { start_date: e.target.value }))}
            className={`${control} w-full`}
          />
        </Tile>
        <Tile label="Deadline">
          <input
            type="date"
            value={p.endDate}
            min={addDaysIso(p.startDate, 1)}
            onChange={(e) => e.target.value && void run(() => api.updateProject(pid, { end_date: e.target.value }))}
            className={`${control} w-full`}
          />
        </Tile>
        <Tile label="Time left">
          <div className="text-[15px]">{timeLeft(p)}</div>
        </Tile>
        <Tile label="Team size">
          <div className="text-[15px]">{p.members.length} {p.members.length === 1 ? "person" : "people"}</div>
        </Tile>
        <Tile
          label={
            <>
              Progress: <b className="text-st-blue">{progress}%</b>
            </>
          }
        >
          <input
            type="range"
            min={0}
            max={100}
            value={progress}
            aria-label="Progress"
            onChange={(e) => setDragProgress(Number(e.target.value))}
            onPointerUp={() => void commitProgress()}
            onKeyUp={() => void commitProgress()}
            className="mt-1 w-full accent-st-blue"
          />
        </Tile>
      </div>

      <div className="mt-5">
        <ProgressBar done={progress} time={used} status={status} />
        <p className="mt-2 text-muted">Bar: work completed. Tick: where the project should be today.</p>
      </div>

      <label className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="whitespace-nowrap text-[15px] text-muted">Needs your decision</span>
        <input
          value={decisionDraft ?? p.decision ?? ""}
          placeholder="Nothing needed right now"
          onChange={(e) => setDecisionDraft(e.target.value)}
          onBlur={() => void commitDecision()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className={`${control} min-w-[12rem] flex-1 placeholder:text-muted`}
        />
      </label>

      <h3 className={`${sectionTitle} mt-6`}>Description</h3>
      <p className="mt-2 text-[15px] leading-relaxed">{p.description || <span className="text-muted">No description yet.</span>}</p>

      <h3 className={`${sectionTitle} mt-6`}>Key objectives</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-6 text-[15px]">
        {p.objectives.map((o, i) => (
          <li key={i}>{o}</li>
        ))}
        {p.objectives.length === 0 && <li className="list-none text-muted">No objectives yet.</li>}
      </ul>
      <form
        className="mt-3 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!objective.trim() || busy) return;
          void run(() => api.addObjective(pid, objective.trim()), SCOPES.objective).then((ok) => ok && setObjective(""));
        }}
      >
        <input
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="Add an objective"
          aria-label="New objective"
          className={`${control} min-w-0 flex-1 placeholder:text-muted`}
        />
        <button type="submit" disabled={busy} className={`${outlineBtn} disabled:cursor-not-allowed disabled:opacity-60`}>
          Add
        </button>
      </form>

      <h3 className={`${sectionTitle} mt-6`}>Team and roles</h3>
      <ul className="mt-1 divide-y divide-line border-b border-line">
        {p.members.map((m) => (
          <li key={m.name} className="flex items-center justify-between gap-4 py-2.5 text-[15px]">
            <span>{m.name}</span>
            <span className="flex items-center gap-3 text-muted">
              {m.role}
              {m.name !== p.lead && (
                <button
                  onClick={() => void run(() => api.removeProjectMember(pid, m.memberId ?? memberId(m.name)), SCOPES.projectMember)}
                  disabled={busy}
                  aria-label={`Remove ${m.name}`}
                  className="rounded px-1 text-lg leading-none hover:bg-track hover:text-ink"
                >
                  ×
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {candidates.length > 0 && (
        <form
          className="mt-4 flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !memberToAdd) return;
            void run(() => api.addProjectMember(pid, { member_id: memberId(memberToAdd), role: newRole.trim() }), SCOPES.projectMember).then((ok) => {
              if (ok) {
                setNewMember("");
                setNewRole("");
              }
            });
          }}
        >
          <select value={memberToAdd} onChange={(e) => setNewMember(e.target.value)} aria-label="Person" className={`${control} min-w-[10rem] flex-1`}>
            {candidates.map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </select>
          <input
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="Role on this project"
            aria-label="Role"
            className={`${control} min-w-[10rem] flex-1 placeholder:text-muted`}
          />
          <button type="submit" disabled={busy} className={`${outlineBtn} h-10 disabled:cursor-not-allowed disabled:opacity-60`}>
            Add to team
          </button>
        </form>
      )}

      <div className="mt-6 flex items-center justify-between">
        <h3 className={sectionTitle}>Open work ({openWork.length})</h3>
        <button onClick={onAddTask} className={`${outlineBtn} py-1.5`}>
          Add task
        </button>
      </div>
      <ul className="mt-2 divide-y divide-line border-b border-line">
        {openWork.map((t) => {
          const g = taskGroup(t);
          const tone =
            g === "overdue"
              ? { dot: "bg-st-red", text: "text-st-red-strong" }
              : g === "today"
                ? { dot: "bg-st-orange", text: "text-st-orange-strong" }
                : { dot: "bg-st-blue", text: "text-st-blue" };
          return (
            <li key={t.id}>
              <button onClick={() => onOpenTask(t.id)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-track/30">
                <span className={`mt-2 h-2.5 w-2.5 shrink-0 self-start rounded-full ${tone.dot}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px]">{t.title}</span>
                  <span className="text-muted">
                    {t.owner}
                    {t.state === "blocked" && (
                      <>
                        {" · "}
                        <b className="text-ink">Blocked</b>
                        {t.note && `: ${t.note}`}
                      </>
                    )}
                  </span>
                </span>
                <span className={`whitespace-nowrap text-[15px] font-semibold ${tone.text}`}>{dueText(t)}</span>
              </button>
            </li>
          );
        })}
        {openWork.length === 0 && <li className="py-4 text-muted">No open tasks.</li>}
      </ul>

      <h3 className={`${sectionTitle} mt-6`}>History</h3>
      <ul className="mt-1 divide-y divide-line">
        {(!feed || feed.status === "loading") && <li className="py-3 text-muted">Loading history...</li>}
        {feed?.status === "ready" && p.history.length === 0 && <li className="py-3 text-muted">No history yet.</li>}
        {feed?.status === "error" && (
          <li role="alert" className="flex flex-wrap items-center justify-between gap-3 py-3 text-st-red-strong">
            <span>Could not load the history. {feed.error}</span>
            <button
              onClick={() => void loadProjectHistory(p.id)}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-track"
            >
              Retry
            </button>
          </li>
        )}
        {p.history.map((h) => (
          <li key={h.id} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
            <span className="text-muted" suppressHydrationWarning>
              {now ? agoLabel(minutesBetween(h.createdAt, nowMs())) : ""}
            </span>
            <span className="text-[15px]">{h.text}</span>
          </li>
        ))}
      </ul>
      {feed?.status === "ready" && p.history.length < feed.count && (
        <div className="mt-3">
          {feed.moreError && (
            <p role="alert" className="mb-2 rounded-lg bg-st-red/8 px-3 py-2 text-sm font-medium text-st-red-strong">
              {feed.moreError}
            </p>
          )}
          <button
            onClick={() => void loadMoreProjectHistory(p.id)}
            disabled={feed.moreLoading}
            className="rounded-lg border border-line bg-surface px-3.5 py-1.5 text-sm font-medium shadow-sm hover:bg-track disabled:cursor-wait disabled:opacity-60"
          >
            {feed.moreLoading ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </article>
  );
}

/* ---------- View ---------- */

export function ProjectsView({
  onOpen,
  focusId = null,
}: {
  onOpen: (ref: OpenRef) => void;
  focusId?: string | null; // project to select when arriving from another tab
}) {
  const now = useNow();
  const [mode, setMode] = useState<"cards" | "timeline">("cards");
  const [sort, setSort] = useState<Sort>("attention");
  const [filter, setFilter] = useState<ProjectStatus | "all">("all");
  const [selected, setSelected] = useState<string | null>(focusId);
  const [creating, setCreating] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  // Arriving with a project chosen: on narrow screens the detail sits below the list, so scroll to it.
  useEffect(() => {
    if (focusId && window.innerWidth < 1180) detailRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [focusId]);

  const list = projects.filter((p) => filter === "all" || projectStatus(p) === filter).sort(sorters[sort]);
  const current = list.find((p) => p.id === selected) ?? list[0];

  const select = (id: string) => {
    setSelected(id);
    setMode("cards");
    // On narrow screens the detail sits below the list, so bring it into view.
    if (window.innerWidth < 1180) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
  };

  const toggleBtn = (m: "cards" | "timeline", label: string) => (
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[1.625rem] font-bold leading-tight tracking-tight">Projects</h2>
          <p className="mt-1 text-muted">
            {plural(projects.length, "project")} across the company. Select one for the full picture.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="View">
            {toggleBtn("cards", "Cards")}
            {toggleBtn("timeline", "Timeline")}
          </div>
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-header px-5 py-2 text-[15px] font-semibold text-white hover:opacity-90 dark:bg-accent dark:text-header"
          >
            New project
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className={`${control} w-52`}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ProjectStatus | "all")}
          aria-label="Health"
          className={`${control} w-32`}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {mode === "timeline" ? (
        <Timeline list={list} now={now} onSelect={select} />
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface py-12 text-center text-muted">
          {projects.length === 0 ? "No projects yet. Use New project to create the first one." : "No projects match this filter."}
        </p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 desk:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
          <div className="space-y-3">
            {list.map((p) => (
              <ProjectCard key={p.id} p={p} now={now} active={p.id === current.id} onSelect={() => select(p.id)} />
            ))}
          </div>
          <div ref={detailRef} className="scroll-mt-4">
            <ProjectDetail
              key={current.id}
              p={current}
              now={now}
              onOpenTask={(id) => onOpen({ kind: "task", id })}
              onAddTask={() => setAddingTask(true)}
            />
          </div>
        </div>
      )}

      {creating && (
        <Modal title="New project" onClose={() => setCreating(false)}>
          <NewProjectForm
            onCreated={(id) => {
              setCreating(false);
              setFilter("all");
              setSelected(id);
              setMode("cards");
            }}
          />
        </Modal>
      )}
      {addingTask && current && (
        <Modal title={`New task for ${current.name}`} onClose={() => setAddingTask(false)}>
          <NewTaskForm defaultProjectId={current.id} onCreated={() => setAddingTask(false)} />
        </Modal>
      )}
    </div>
  );
}
