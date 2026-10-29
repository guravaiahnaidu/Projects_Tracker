"use client";

import { useRef, useState, type FormEvent } from "react";
import { projects } from "@/lib/data";
import { ApiError, errorMessage } from "@/lib/api";
import { addFeedback, FEEDBACK_TYPES, shareUpdate, type FeedbackType } from "@/lib/dailyUpdates";
import { numericId, serverToday } from "@/lib/store";
import { Combobox, DateField } from "./FormControls";
import { useProjectTeam } from "./hooks";
import { control, FieldNote, teamOptions, TeamStatus, workDateProblem } from "./TasksView";
import { Modal } from "./ui";

const ITEM_MAX = 500; // matches the backend's DAILY_UPDATE_ITEM_MAX (one line)
const ITEMS_MAX = 50; // matches DAILY_UPDATE_ITEMS_MAX (lines per update)
const FEEDBACK_MAX = 2000; // matches the backend's FEEDBACK_MAX

type Field = "project" | "employee" | "date" | "summary" | "feedback";
// Server field names -> form fields, so API validation messages land next to the right input.
const SERVER_FIELDS: Record<string, Field> = { project_id: "project", employee_id: "employee", date: "date", completed: "summary" };

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** Employee Work Update: shares one person's work summary for a project and day. Each line of the summary
 *  becomes one "Completed" item; optional manager feedback is saved on the new update straight after. */
export default function WorkUpdateForm({ onClose, onShared }: { onClose: () => void; onShared: () => void }) {
  const [projectId, setProjectId] = useState("");
  const [employee, setEmployee] = useState(""); // member id
  const [date, setDate] = useState(serverToday);
  const [dateTyped, setDateTyped] = useState(false);
  const [summary, setSummary] = useState("");
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("Suggestion");
  const [feedback, setFeedback] = useState("");
  // Set once the summary is saved. If the feedback then fails, a retry sends only the feedback.
  const [sharedId, setSharedId] = useState<number | null>(null);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false); // set synchronously, so a fast double click cannot share the update twice
  const [serverError, setServerError] = useState("");
  const [serverFields, setServerFields] = useState<Partial<Record<Field, string>>>({});

  const today = serverToday();
  const projectOptions = [...projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name, hint: p.client }));
  // Only the selected project's team (with their roles) can be chosen.
  const projectTeam = useProjectTeam(projectId);
  const employees = teamOptions(projectTeam.members);
  const items = lines(summary);

  const problems: Record<Field, string> = {
    project: !projectId ? "Choose a project." : "",
    employee: !employee
      ? "Choose the employee this update is for."
      : projectTeam.status !== "ready"
        ? "Wait for the project's employees to load."
        : !employees.some((o) => o.value === employee)
          ? "Choose an employee assigned to this project."
          : "",
    date: workDateProblem(date, dateTyped) || (date > today ? "An update can't be dated in the future." : ""),
    summary: !items.length
      ? "Describe the work done."
      : items.length > ITEMS_MAX
        ? `Keep the summary to ${ITEMS_MAX} lines or fewer.`
        : items.some((l) => l.length > ITEM_MAX)
          ? `Keep each line under ${ITEM_MAX} characters.`
          : "",
    feedback: feedback.trim().length > FEEDBACK_MAX ? `Keep the feedback under ${FEEDBACK_MAX} characters.` : "",
  };
  const order: Field[] = ["project", "employee", "date", "summary", "feedback"];
  const firstProblem = order.find((f) => problems[f]);
  const errorFor = (f: Field) => serverFields[f] || ((attempted || touched[f]) && problems[f]) || "";
  const touch = (f: Field) => setTouched((t) => ({ ...t, [f]: true }));
  const edited = (f: Field) => setServerFields((s) => (s[f] ? { ...s, [f]: "" } : s));
  const a11y = (f: Field) => ({
    invalid: !!errorFor(f),
    describedBy: errorFor(f) ? `wu-${f}-error` : undefined,
    onBlur: () => touch(f),
  });
  const shared = sharedId !== null;
  const dirty = shared ? !!feedback.trim() : !!(projectId || employee || summary.trim() || date !== today || feedback.trim());

  const clear = () => {
    if (!shared) {
      setProjectId("");
      setEmployee("");
      setDate(today);
      setDateTyped(false);
      setSummary("");
    }
    setFeedbackType("Suggestion");
    setFeedback("");
    setTouched({});
    setAttempted(false);
    setServerError("");
    setServerFields({});
  };

  const close = () => {
    if (saving) return;
    if (dirty && !window.confirm(shared ? "The summary is saved. Discard the unsaved feedback?" : "Discard this work update?")) return;
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (saving || submitting.current) return;
    if (firstProblem) {
      document.getElementById(`wu-${firstProblem}`)?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    setServerError("");
    setServerFields({});
    let id = sharedId;
    try {
      if (id === null) {
        id = (await shareUpdate({ project_id: numericId(projectId), employee_id: Number(employee), date, completed: items })).id;
        setSharedId(id);
      }
      if (feedback.trim()) await addFeedback(id, feedbackType, feedback.trim());
      onShared();
    } catch (err) {
      if (id !== null) {
        // The summary is saved; only the feedback failed. The summary fields are now locked and a retry sends the feedback alone.
        setServerError(`The summary was submitted, but the feedback could not be saved: ${errorMessage(err)} Submit again to retry, or close the form.`);
        submitting.current = false;
        setSaving(false);
        return;
      }
      const fields = err instanceof ApiError ? err.fields : {};
      const mapped: Partial<Record<Field, string>> = {};
      for (const [k, msgs] of Object.entries(fields)) if (SERVER_FIELDS[k]) mapped[SERVER_FIELDS[k]] = msgs[0];
      setServerFields(mapped);
      // A 409 (an update for this person, project and day already exists) arrives as a message without fields.
      setServerError(Object.keys(mapped).length ? "Please fix the highlighted fields." : errorMessage(err));
      submitting.current = false;
      setSaving(false);
    }
  };

  const label = "mb-1.5 block text-sm font-semibold";
  const req = (
    <span className="text-st-red-strong" aria-hidden>
      {" "}
      *
    </span>
  );
  const err = (f: Field) => <FieldNote id={`wu-${f}-error`} message={errorFor(f)} />;

  return (
    <Modal
      title="Employee Work Update"
      onClose={close}
      footer={
        <>
          <button
            type="button"
            onClick={clear}
            disabled={saving || !dirty}
            className="mr-auto h-10 rounded-lg px-3 text-[15px] font-medium text-muted hover:bg-track hover:text-ink disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="h-10 rounded-lg border border-line bg-surface px-4 text-[15px] font-medium hover:bg-track/60 disabled:opacity-60"
          >
            Close form
          </button>
          <button
            type="submit"
            form="work-update-form"
            disabled={saving}
            className="h-10 rounded-lg bg-header px-5 text-[15px] font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-st-blue/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-accent dark:text-header"
          >
            {saving ? "Submitting..." : "Submit Summary"}
          </button>
        </>
      }
    >
      <form id="work-update-form" onSubmit={submit} noValidate className="space-y-4">
        {/* Locked once the summary is saved (only the feedback can still be sent). */}
        <fieldset disabled={shared} className="min-w-0 space-y-4 disabled:opacity-70">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="wu-project" className={label}>
                Project{req}
              </label>
              <Combobox
                id="wu-project"
                value={projectId}
                onChange={(v) => {
                  setProjectId(v);
                  edited("project");
                  // The employee list belongs to the project: a new project starts with no employee chosen.
                  if (v !== projectId) {
                    setEmployee("");
                    edited("employee");
                  }
                }}
                options={projectOptions}
                placeholder="Select project"
                emptyText={projects.length ? "No matching project" : "Create a project first"}
                {...a11y("project")}
              />
              {err("project")}
            </div>
            <div>
              <label htmlFor="wu-employee" className={label}>
                Employee{req}
              </label>
              <Combobox
                id="wu-employee"
                value={employee}
                onChange={(v) => {
                  setEmployee(v);
                  edited("employee");
                }}
                options={employees}
                disabled={projectTeam.status !== "ready" || !employees.length}
                placeholder={projectTeam.status === "loading" ? "Loading employees..." : "Select employee"}
                emptyText="No matching employee"
                {...a11y("employee")}
              />
              {err("employee") || <TeamStatus projectTeam={projectTeam} options={employees} />}
            </div>
          </div>

          <div className="sm:w-1/2 sm:pr-2">
            <label htmlFor="wu-date" className={label}>
              Work Date{req}
            </label>
            <DateField
              id="wu-date"
              value={date}
              max={today}
              onChange={(iso, typed) => {
                setDate(iso);
                setDateTyped(typed);
                edited("date");
              }}
              {...a11y("date")}
            />
            {err("date")}
          </div>

          <div>
            <label htmlFor="wu-summary" className={label}>
              Work Summary{req}
            </label>
            <textarea
              id="wu-summary"
              rows={5}
              value={summary}
              onChange={(e) => {
                setSummary(e.target.value);
                edited("summary");
              }}
              onBlur={() => touch("summary")}
              aria-required
              aria-invalid={!!errorFor("summary")}
              aria-describedby={errorFor("summary") ? "wu-summary-error" : "wu-summary-hint"}
              placeholder={"What was done today? One item per line, e.g.\nFinished the login page\nFixed the payroll export"}
              className={`w-full resize-y rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink outline-none placeholder:text-muted focus:border-st-blue focus:ring-2 focus:ring-st-blue/20 ${
                errorFor("summary") ? "border-st-red! focus:ring-st-red/20!" : ""
              }`}
            />
            {err("summary") || (
              <p id="wu-summary-hint" className="mt-1 text-[13px] text-muted">
                Each line is listed under Completed.
              </p>
            )}
          </div>
        </fieldset>

        <fieldset className="min-w-0 rounded-xl border border-line bg-track/30 p-4">
          <legend className="px-1 text-sm font-semibold">
            Manager Feedback / Suggestions <span className="font-normal text-muted">(optional)</span>
          </legend>
          <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <div>
              <label htmlFor="wu-feedback-type" className="sr-only">
                Feedback type
              </label>
              <select
                id="wu-feedback-type"
                value={feedbackType}
                onChange={(e) => setFeedbackType(e.target.value as FeedbackType)}
                className={`${control} w-full`}
              >
                {FEEDBACK_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="wu-feedback" className="sr-only">
                Feedback
              </label>
              <textarea
                id="wu-feedback"
                rows={3}
                value={feedback}
                onChange={(e) => {
                  setFeedback(e.target.value);
                  edited("feedback");
                }}
                onBlur={() => touch("feedback")}
                aria-invalid={!!errorFor("feedback")}
                aria-describedby={errorFor("feedback") ? "wu-feedback-error" : undefined}
                placeholder="Suggestions, appreciation or next steps for this work..."
                className={`w-full resize-y rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink outline-none placeholder:text-muted focus:border-st-blue focus:ring-2 focus:ring-st-blue/20 ${
                  errorFor("feedback") ? "border-st-red! focus:ring-st-red/20!" : ""
                }`}
              />
              {err("feedback")}
            </div>
          </div>
        </fieldset>

        {serverError && (
          <p role="alert" className="rounded-lg bg-st-red/8 px-3 py-2 text-sm font-medium text-st-red-strong">
            {serverError}
          </p>
        )}
      </form>
    </Modal>
  );
}
