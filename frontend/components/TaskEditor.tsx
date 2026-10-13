"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { projectById, tasks, team, type Priority, type TaskState } from "@/lib/data";
import { api, errorMessage, type TaskPatch } from "@/lib/api";
import { memberId, mutate, numericId, SCOPES } from "@/lib/store";
import { useNow } from "./hooks";
import { control, dueText, STATES } from "./TasksView";
import { diffDays, wallClockIso } from "@/lib/serverClock";
import { blockedNoteProblem } from "@/lib/blockedNote";

const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

function dueTone(offset: number, state: TaskState) {
  if (state === "done") return "text-st-green";
  if (offset < 0) return "text-st-red-strong";
  if (offset === 0) return "text-st-orange-strong";
  if (offset <= 2) return "text-st-amber-strong";
  return "text-muted";
}

const label = "mb-1.5 block text-sm font-semibold text-muted";
const btn = "rounded-lg border border-line bg-surface px-4 py-2 text-[15px] font-medium hover:bg-track";

export default function TaskEditor({
  id,
  onClose,
  onProject,
}: {
  id: string;
  onClose: () => void;
  onProject: (projectId: string) => void;
}) {
  const now = useNow();
  const task = tasks.find((t) => t.id === id);
  const project = task ? projectById(task.projectId) : null;

  const [title, setTitle] = useState(task?.title ?? "");
  const [owner, setOwner] = useState(task?.owner ?? "");
  const [due, setDue] = useState(task?.dueDate ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "Medium");
  const [state, setState] = useState<TaskState>(task?.state ?? "not-started");
  const [note, setNote] = useState(task?.note ?? "");
  const [attempted, setAttempted] = useState(false); // show validation only after the first save attempt
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
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

  // Dates are compared as ISO strings; the offset is only for the preview and is relative to the server's today.
  const dueOffset = due ? diffDays(due, wallClockIso(now)) : task.dueOffset;
  const dirty =
    title.trim() !== task.title ||
    owner !== task.owner ||
    due !== task.dueDate ||
    priority !== task.priority ||
    state !== task.state ||
    note.trim() !== (task.note ?? "");

  const problem = !title.trim()
    ? "Give the task a name."
    : !due
      ? "Pick a due date."
      : state === "blocked"
        ? blockedNoteProblem(note)
        : "";
  const error = (attempted ? problem : "") || serverError;

  // Project team first (with their role), then everyone else.
  const members = project.members.map((m) => ({ name: m.name, text: `${m.name} (${m.role})` }));
  const others = team
    .filter((m) => !project.members.some((x) => x.name === m.name))
    .map((m) => ({ name: m.name, text: m.name }));
  const owners = [...members, ...others];
  if (!owners.some((o) => o.name === task.owner)) owners.unshift({ name: task.owner, text: task.owner });

  // The server records every change in the activity log, so the editor only sends what changed.
  const run = async (write: () => Promise<unknown>) => {
    setBusy(true);
    setServerError("");
    try {
      await mutate(write, SCOPES.task);
      onClose();
    } catch (e) {
      setServerError(errorMessage(e));
      setBusy(false);
    }
  };

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setAttempted(true);
    if (problem) return;
    if (!dirty) return onClose();
    void run(() => {
      const patch: TaskPatch = {};
      if (title.trim() !== task.title) patch.title = title.trim();
      if (owner !== task.owner) patch.owner_id = memberId(owner);
      if (due !== task.dueDate) patch.due_date = due;
      if (priority !== task.priority) patch.priority = priority;
      if (state !== task.state) patch.state = state;
      if (note.trim() !== (task.note ?? "")) patch.note = note.trim();
      return api.updateTask(numericId(task.id), patch);
    });
  };

  const markDone = () => void run(() => api.completeTask(numericId(task.id)));
  const remove = () => void run(() => api.deleteTask(numericId(task.id)));

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
                disabled={busy}
                className="rounded-lg bg-st-red px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
                <button type="button" onClick={markDone} disabled={busy} className={`${btn} text-st-green disabled:cursor-not-allowed disabled:opacity-60`}>
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
            disabled={!dirty || busy}
            title={dirty ? "Save (Ctrl+Enter)" : "No changes yet"}
            className="rounded-lg bg-header px-4 py-2 text-[15px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-accent dark:text-header"
          >
            {busy ? "Saving..." : "Save changes"}
          </button>
        </footer>
      </form>
    </div>
  );
}
