"use client";

import { useState, type FormEvent } from "react";
import { departments, projects, STRETCHED_THRESHOLD, tasks, team, type Member, type Task } from "@/lib/data";
import { api, errorMessage } from "@/lib/api";
import { mutate, numericId, SCOPES } from "@/lib/store";
import type { OpenRef } from "./Overview";
import { control, dueText, taskGroup } from "./TasksView";
import { MarkerIcon, Modal } from "./ui";

export type Show = "all" | "stretched" | "overdue" | "blocked";
type Sort = "stretched" | "tasks" | "name";

const SHOW: { value: Show; label: string }[] = [
  { value: "all", label: "All" },
  { value: "stretched", label: "Stretched" },
  { value: "overdue", label: "Has overdue work" },
  { value: "blocked", label: "Has blocked work" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "stretched", label: "Most stretched first" },
  { value: "tasks", label: "Most open tasks" },
  { value: "name", label: "Name A to Z" },
];

const sectionTitle = "text-[13px] font-semibold uppercase tracking-wide text-muted";

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/* Colour by how soon the task is due (a blocked task keeps its due-date colour and gets a pill). */
function dueTone(t: Task) {
  const d = t.dueOffset;
  if (d < 0) return { dot: "bg-st-red", text: "text-st-red-strong" };
  if (d === 0) return { dot: "bg-st-orange", text: "text-st-orange-strong" };
  if (d <= 2) return { dot: "bg-st-amber", text: "text-st-amber-strong" };
  if (d <= 7) return { dot: "bg-st-blue", text: "text-st-blue" };
  return { dot: "bg-st-slate", text: "text-st-slate" };
}

export function personInfo(m: Member) {
  const roles = projects.flatMap((p) =>
    p.members.filter((x) => x.name === m.name).map((x) => ({ project: p.name, projectId: p.id, role: x.role })),
  );
  const work = tasks.filter((t) => t.owner === m.name && t.state !== "done").sort((a, b) => a.dueOffset - b.dueOffset);
  const overdue = work.filter((t) => taskGroup(t) === "overdue").length;
  const blocked = work.filter((t) => t.state === "blocked").length;
  const leads = projects.filter((p) => p.lead === m.name).length;
  return { roles, work, overdue, blocked, leads, stretched: m.load > STRETCHED_THRESHOLD };
}

type Info = ReturnType<typeof personInfo>;

export function whyText(m: Member, i: Info) {
  const parts: string[] = [];
  if (i.leads > 1) parts.push(`leads ${i.leads} projects`);
  if (i.overdue) parts.push(i.overdue === 1 ? "has an overdue task" : `has ${i.overdue} overdue tasks`);
  if (i.blocked) parts.push(i.blocked === 1 ? "has a blocked task" : `has ${i.blocked} blocked tasks`);
  if (parts.length === 0) parts.push(`is at ${m.load}% of capacity`);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

function Stat({ value, label, alert }: { value: number; label: string; alert?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-track/50 px-3 py-2">
      <div className={`text-lg font-bold leading-tight ${alert ? "text-st-red-strong" : ""}`}>{value}</div>
      <div className="truncate text-sm text-muted">{label}</div>
    </div>
  );
}

function Capacity({ load }: { load: number }) {
  const color = load > STRETCHED_THRESHOLD ? "bg-st-orange" : load >= 90 ? "bg-st-amber" : "bg-st-green";
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-muted">Capacity</span>
        <span className={`font-semibold ${load > STRETCHED_THRESHOLD ? "text-st-orange-strong" : ""}`}>{load}%</span>
      </div>
      <div
        className="h-1.5 rounded-full bg-track"
        role="meter"
        aria-label="Capacity used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={load}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(load, 100)}%` }} />
      </div>
    </div>
  );
}

function PersonCard({
  m,
  info,
  onOpen,
  highlight = false,
}: {
  m: Member;
  info: Info;
  onOpen: (ref: OpenRef) => void;
  highlight?: boolean;
}) {
  return (
    <article
      id={personId(m.name)}
      className={`flex h-full scroll-mt-6 flex-col rounded-xl border bg-surface p-5 shadow-sm transition-shadow duration-150 hover:shadow-md ${
        highlight ? "border-st-green ring-2 ring-st-green/30" : "border-line"
      }`}
    >
      <header className="flex items-start gap-3.5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-header text-sm font-semibold text-white dark:bg-accent dark:text-header">
          {initials(m.name)}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="font-bold leading-snug">{m.name}</h3>
          <p className="text-sm text-muted">
            {m.title} · {m.role}
          </p>
        </div>
        {info.stretched && (
          <span className="mt-1.5 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-sm font-medium">
            <MarkerIcon marker="triangle-amber" />
            Stretched
          </span>
        )}
      </header>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <Stat value={info.work.length} label="Open tasks" />
        <Stat value={info.overdue} label="Overdue" alert={info.overdue > 0} />
        <Stat value={info.roles.length} label="Projects" />
      </div>

      <Capacity load={m.load} />

      {info.stretched && (
        <p className="mt-3 rounded-lg bg-track/50 px-3.5 py-2.5 text-sm">
          <b>Why:</b> {whyText(m, info)}
        </p>
      )}

      <h4 className={`${sectionTitle} mt-5`}>Projects and role</h4>
      {info.roles.length ? (
        <ul className="mt-1 divide-y divide-line border-b border-line">
          {info.roles.map((r) => (
            <li key={r.projectId}>
              <button
                onClick={() => onOpen({ kind: "project", id: r.projectId })}
                className="flex w-full justify-between gap-4 py-2.5 text-left text-[15px] hover:text-st-blue"
              >
                <span>{r.project}</span>
                <span className="text-right text-muted">{r.role}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">Not on any project yet.</p>
      )}

      <h4 className={`${sectionTitle} mt-5`}>Current work ({info.work.length})</h4>
      {info.work.length ? (
        <ul className="mt-1 divide-y divide-line">
          {info.work.map((t) => {
            const tone = dueTone(t);
            return (
              <li key={t.id}>
                <button
                  onClick={() => onOpen({ kind: "task", id: t.id })}
                  className="group flex w-full items-center gap-2.5 py-2.5 text-left"
                >
                  <span className={`mt-[7px] h-2 w-2 shrink-0 self-start rounded-full ${tone.dot}`} aria-hidden />
                  <span className="min-w-0 flex-1 text-[15px] group-hover:text-st-blue">
                    {t.title}
                    {t.state === "blocked" && (
                      <span className="mt-1 block w-fit rounded-full border border-st-purple px-2 text-[13px] font-medium leading-5 text-st-purple">
                        Blocked
                      </span>
                    )}
                  </span>
                  <span className={`whitespace-nowrap text-[15px] font-semibold ${tone.text}`}>{dueText(t)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">No open tasks.</p>
      )}
    </article>
  );
}

const MAX_LOAD = 200;
const personId = (name: string) => `person-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

function AddEmployeeForm({ onCreated, onCancel }: { onCreated: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [load, setLoad] = useState(60);
  const [roles, setRoles] = useState<Record<string, string>>({}); // projectId -> role
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");

  const clean = name.trim().replace(/\s+/g, " ");
  const problem = !clean
    ? "Enter the employee's full name."
    : team.some((m) => m.name.toLowerCase() === clean.toLowerCase())
      ? `${clean} is already on the team.`
      : !title.trim()
        ? "Enter a job title."
        : !department.trim()
          ? "Choose or type a department."
          : !Number.isFinite(load) || load < 0 || load > MAX_LOAD
            ? `Capacity must be between 0 and ${MAX_LOAD}%.`
            : "";

  const toggleProject = (id: string, on: boolean) =>
    setRoles((r) => {
      const next = { ...r };
      if (on) next[id] = "Team Member";
      else delete next[id];
      return next;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (problem || saving) return;
    setSaving(true);
    setServerError("");
    try {
      // The server creates the person, their project memberships and the activity entries in one step.
      await mutate(() =>
        api.createMember({
          name: clean,
          title: title.trim(),
          department: department.trim(),
          load: Math.round(load),
          memberships: Object.entries(roles).map(([projectId, role]) => ({ project_id: numericId(projectId), role: role.trim() })),
        }),
        SCOPES.newEmployee,
      );
      onCreated(clean);
    } catch (err) {
      setServerError(errorMessage(err));
      setSaving(false);
    }
  };

  const field = "flex flex-col gap-1.5 text-sm font-semibold";
  const color = load > STRETCHED_THRESHOLD ? "bg-st-orange" : load >= 90 ? "bg-st-amber" : "bg-st-green";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={`${field} sm:col-span-2`}>
          Full name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={`${control} font-normal`} placeholder="e.g. Kavya Menon" />
        </label>
        <label className={field}>
          Job title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${control} font-normal`} placeholder="e.g. Business Analyst" />
        </label>
        <label className={field}>
          Department
          <input
            list="departments"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={`${control} font-normal`}
            placeholder="Pick or type a new one"
          />
          <datalist id="departments">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-sm font-semibold">
          <label htmlFor="new-load">Capacity allocated</label>
          <span className={load > STRETCHED_THRESHOLD ? "text-st-orange-strong" : ""}>
            {load}%{load > STRETCHED_THRESHOLD && " · Stretched"}
          </span>
        </div>
        <input
          id="new-load"
          type="range"
          min={0}
          max={MAX_LOAD}
          step={5}
          value={load}
          onChange={(e) => setLoad(Number(e.target.value))}
          className="w-full accent-st-blue"
        />
        <div className="mt-1.5 h-1.5 rounded-full bg-track">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(load, 100)}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">How much of their working time is already committed. Above 100% shows as Stretched.</p>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">Projects (optional)</legend>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {projects.map((p) => {
            const on = p.id in roles;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                <label className="flex min-w-0 flex-1 items-center gap-2.5 text-[15px]">
                  <input type="checkbox" checked={on} onChange={(e) => toggleProject(p.id, e.target.checked)} className="h-4 w-4 accent-st-blue" />
                  <span className="truncate">{p.name}</span>
                </label>
                {on && (
                  <input
                    aria-label={`Role on ${p.name}`}
                    value={roles[p.id]}
                    onChange={(e) => setRoles((r) => ({ ...r, [p.id]: e.target.value }))}
                    className={`${control} h-9! w-48 text-sm!`}
                    placeholder="Role on this project"
                  />
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      {((attempted && !saving && problem) || serverError) && (
        <p role="alert" className="rounded-lg bg-st-red/8 px-3 py-2 text-sm font-medium text-st-red-strong">
          {(attempted && !saving && problem) || serverError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-lg border border-line bg-surface px-4 py-2 font-medium hover:bg-track">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-header px-4 py-2 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-accent dark:text-header"
        >
          {saving ? "Adding..." : "Add employee"}
        </button>
      </div>
    </form>
  );
}

export function TeamView({
  onOpen,
  initialShow = "all",
  initialQuery = "",
}: {
  onOpen: (ref: OpenRef) => void;
  initialShow?: Show; // pre-set the filter when arriving from the Overview
  initialQuery?: string; // pre-fill the search when arriving from the navbar search
}) {
  const [query, setQuery] = useState(initialQuery);
  const [project, setProject] = useState("all");
  const [show, setShow] = useState<Show>(initialShow);
  const [sort, setSort] = useState<Sort>("stretched");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null); // highlights the card of the person just added

  const onCreated = (name: string) => {
    setAdding(false);
    setQuery("");
    setProject("all");
    setShow("all");
    setAdded(name);
    setTimeout(() => document.getElementById(personId(name))?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    setTimeout(() => setAdded((a) => (a === name ? null : a)), 4000);
  };

  const everyone = team.map((m) => ({ m, info: personInfo(m) }));
  const stretched = everyone.filter((p) => p.info.stretched).length;
  const withOverdue = everyone.filter((p) => p.info.overdue > 0).length;
  const blocked = everyone.reduce((n, p) => n + p.info.blocked, 0);

  const q = query.trim().toLowerCase();
  const people = everyone
    .filter(
      ({ m, info }) =>
        !q || [m.name, m.title, m.role, ...info.roles.map((r) => r.project)].some((s) => s.toLowerCase().includes(q)),
    )
    .filter(({ info }) => project === "all" || info.roles.some((r) => r.projectId === project))
    .filter(
      ({ info }) =>
        show === "all" ||
        (show === "stretched" && info.stretched) ||
        (show === "overdue" && info.overdue > 0) ||
        (show === "blocked" && info.blocked > 0),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.m.name.localeCompare(b.m.name)
        : sort === "tasks"
          ? b.info.work.length - a.info.work.length || b.m.load - a.m.load
          : b.m.load - a.m.load,
    );

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[1.625rem] font-bold leading-tight tracking-tight">Team</h2>
          <p className="mt-1 text-muted">Who is working on which project, in what role, and how much is on their plate.</p>
          <p className="mt-2 text-sm text-muted">
            {plural(team.length, "person", "people")} · {plural(stretched, "stretched", "stretched")} ·{" "}
            {plural(withOverdue, "person", "people")} with overdue work · {plural(blocked, "blocked task", "blocked tasks")}
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="rounded-lg bg-header px-5 py-2 text-[15px] font-semibold text-white hover:opacity-90 dark:bg-accent dark:text-header"
        >
          + Add employee
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people or projects"
          aria-label="Search people"
          className={`${control} h-11! w-full placeholder:text-muted desk:w-auto desk:min-w-[14rem] desk:flex-1`}
        />
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className={`${control} w-56`}>
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={show} onChange={(e) => setShow(e.target.value as Show)} aria-label="Show" className={`${control} w-44`}>
          {SHOW.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className={`${control} w-52`}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {people.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 desk:grid-cols-3 xl:gap-5">
          {people.map(({ m, info }) => (
            <PersonCard key={m.name} m={m} info={info} onOpen={onOpen} highlight={m.name === added} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line bg-surface py-12 text-center text-muted">
          {team.length === 0 ? "No team members yet. Use + Add employee to add the first one." : "No one matches these filters."}
        </p>
      )}

      {adding && (
        <Modal title="Add employee" onClose={() => setAdding(false)}>
          <AddEmployeeForm onCreated={onCreated} onCancel={() => setAdding(false)} />
        </Modal>
      )}
    </div>
  );
}
