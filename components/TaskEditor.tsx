"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { activity, projectById, tasks, team, type Priority, type Task, type TaskState } from "@/lib/data";
import { useNow } from "./hooks";
import { addDays, control, DAY_MS, dueText, STATES } from "./TasksView";

const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const stateLabel = (s: TaskState) => STATES.find((x) => x.value === s)!.label;

function offsetFromIso(iso: string, now: Date) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - addDays(now, 0).getTime()) / DAY_MS);
}

function dueTone(offset: number, state: TaskState) {
  if (state === "done") return "text-st-green";
  if (offset < 0) return "text-st-red-strong";
  if (offset === 0) return "text-st-orange-strong";
  if (offset <= 2) return "text-st-amber-strong";
  return "text-muted";
}

// Handlers re-read the task from the shared data rather than mutating the value captured during render.
const findTask = (id: string) => tasks.find((t) => t.id === id)!;

function log(task: Task, text: string) {
  const id = `e${Date.now()}`;
  activity.unshift({ id, minutesAgo: 0, text });
  projectById(task.projectId).history.unshift({ id, minutesAgo: 0, text });
}

const label = "mb-1.5 block text-sm font-semibold text-muted";
const btn = "rounded-lg border border-line bg-surface px-4 py-2 text-[15px] font-medium hover:bg-track";

export default function TaskEditor({
  id,
  onClose,
  onSaved,
  onProject,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
  onProject: (projectId: string) => void;
}) {
  const now = useNow();
  const task = tasks.find((t) => t.id === id);
  const project = task ? projectById(task.projectId) : null;

  const [title, setTitle] = useState(task?.title ?? "");
  const [owner, setOwner] = useState(task?.owner ?? "");
  const [due, setDue] = useState(() => (task && now ? isoDate(addDays(now, task.dueOffset)) : ""));
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "Medium");
  const [state, setState] = useState<TaskState>(task?.state ?? "not-started");
  const [note, setNote] = useState(task?.note ?? "");
  const [attempted, setAttempted] = useState(false); // show validation only after the first save attempt
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) formRef.current?.requestSubmit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!task || !project || !now) return null;

  const dueOffset = due ? offsetFromIso(due, now) : task.dueOffset;
  const changes: string[] = [];
  if (title.trim() !== task.title) changes.push(`renamed to “${title.trim()}”`);
  if (owner !== task.owner) changes.push(`owner ${task.owner} → ${owner}`);
  if (dueOffset !== task.dueOffset)
    changes.push(`due ${shortDate(addDays(now, task.dueOffset))} → ${shortDate(addDays(now, dueOffset))}`);
  if (priority !== task.priority) changes.push(`priority ${task.priority} → ${priority}`);
  if (state !== task.state) changes.push(`status ${stateLabel(task.state)} → ${stateLabel(state)}`);
  if (note.trim() !== (task.note ?? "")) changes.push(note.trim() ? "note updated" : "note removed");
  const dirty = changes.length > 0;

  const problem = !title.trim()
    ? "Give the task a name."
    : !due
      ? "Pick a due date."
      : state === "blocked" && !note.trim()
        ? "Say what the task is waiting on, so others can help unblock it."
        : "";
  const error = attempted ? problem : "";

  // Project team first (with their role), then everyone else.
  const members = project.members.map((m) => ({ name: m.name, text: `${m.name} (${m.role})` }));
  const others = team
    .filter((m) => !project.members.some((x) => x.name === m.name))
    .map((m) => ({ name: m.name, text: m.name }));
  const owners = [...members, ...others];
  if (!owners.some((o) => o.name === task.owner)) owners.unshift({ name: task.owner, text: task.owner });

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    setAttempted(true);
    if (problem) return;
    if (!dirty) return onClose();
    const t = findTask(id);
    const original = t.title;
    t.title = title.trim();
    t.owner = owner;
    t.dueOffset = dueOffset;
    t.priority = priority;
    t.state = state;
    t.note = note.trim() || undefined;
    log(t, `You updated “${original}”: ${changes.join(", ")}`);
    onSaved();
    onClose();
  };

  const markDone = () => {
    const t = findTask(id);
    t.state = "done";
    log(t, `You marked “${t.title}” as Done`);
    onSaved();
    onClose();
  };

  const remove = () => {
    const t = findTask(id);
    tasks.splice(tasks.indexOf(t), 1);
    log(t, `You deleted “${t.title}”`);
    onSaved();
    onClose();
  };

  const previewTask = { ...task, dueOffset, state };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        ref={formRef}
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 id="task-editor-title" className="text-xl font-bold">
              Edit task
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <button
                type="button"
                onClick={() => onProject(project.id)}
                className="font-medium text-st-blue underline-offset-2 hover:underline"
              >
                {project.name} →
              </button>
              <span aria-hidden>·</span>
              <span className={`font-semibold ${dueTone(task.dueOffset, task.state)}`}>
                {task.state === "done" ? "Done" : task.state === "blocked" ? "Blocked" : dueText(task)}
              </span>
            </p>
          </div>
          <button type="button" onClick={onClose} className={btn}>
            Close
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <label htmlFor="te-title" className={label}>
              Task
            </label>
            <input
              id="te-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`${control} h-12! w-full text-base!`}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="te-project" className={label}>
                Project
              </label>
              <select id="te-project" disabled value={project.id} className={`${control} w-full cursor-not-allowed opacity-70`}>
                <option value={project.id}>{project.name}</option>
              </select>
            </div>
            <div>
              <label htmlFor="te-owner" className={label}>
                Owner
              </label>
              <select id="te-owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={`${control} w-full`}>
                {members.length > 0 && (
                  <optgroup label={`${project.name} team`}>
                    {owners
                      .filter((o) => members.some((m) => m.name === o.name))
                      .map((o) => (
                        <option key={o.name} value={o.name}>
                          {o.text}
                        </option>
                      ))}
                  </optgroup>
                )}
                <optgroup label="Others">
                  {owners
                    .filter((o) => !members.some((m) => m.name === o.name))
                    .map((o) => (
                      <option key={o.name} value={o.name}>
                        {o.text}
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>

            <div>
              <label htmlFor="te-due" className={label}>
                Due date
              </label>
              <input
                id="te-due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className={`${control} w-full`}
              />
              <p className={`mt-1 text-sm font-medium ${dueTone(dueOffset, state)}`}>
                {state === "done" ? "Completed" : dueText(previewTask)}
              </p>
            </div>
            <div>
              <label htmlFor="te-priority" className={label}>
                Priority
              </label>
              <select
                id="te-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={`${control} w-full`}
              >
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="te-status" className={label}>
              Status
            </label>
            <select
              id="te-status"
              value={state}
              onChange={(e) => setState(e.target.value as TaskState)}
              className={`${control} w-full`}
            >
              {STATES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="te-note" className={label}>
              {state === "blocked" ? "What is it waiting on?" : "Notes"}
              {state === "blocked" && <span className="ml-1 text-st-red-strong">*</span>}
            </label>
            <textarea
              id="te-note"
              rows={state === "blocked" ? 3 : 2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={state === "blocked" ? "e.g. Waiting for the vendor to resend the export file" : "Optional context for the team"}
              className="w-full rounded-lg border border-line bg-surface px-3.5 py-2 text-[15px] outline-none placeholder:text-muted focus:border-st-blue focus:ring-2 focus:ring-st-blue/20"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-st-red/8 px-3 py-2 text-sm font-medium text-st-red-strong">
              {error}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3.5">
          {confirmDelete ? (
            <span className="mr-auto flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Delete this task?</span>
              <button
                type="button"
                onClick={remove}
                className="rounded-lg bg-st-red px-3 py-1.5 font-semibold text-white hover:opacity-90"
              >
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg px-2 py-1.5 font-medium hover:bg-track">
                Keep it
              </button>
            </span>
          ) : (
            <span className="mr-auto flex gap-2">
              {task.state !== "done" && (
                <button type="button" onClick={markDone} className={`${btn} text-st-green`}>
                  ✓ Mark as done
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg px-3 py-2 text-[15px] font-medium text-st-red-strong hover:bg-st-red/8"
              >
                Delete
              </button>
            </span>
          )}
          <button type="button" onClick={onClose} className={btn}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!dirty}
            title={dirty ? "Save (Ctrl+Enter)" : "No changes yet"}
            className="rounded-lg bg-header px-4 py-2 text-[15px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-accent dark:text-header"
          >
            Save changes
          </button>
        </footer>
      </form>
    </div>
  );
}
