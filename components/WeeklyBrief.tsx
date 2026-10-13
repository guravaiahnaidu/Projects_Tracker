"use client";

import { useEffect, useRef, useState } from "react";
import {
  keyDates,
  projectById,
  projects,
  projectStatus,
  STRETCHED_THRESHOLD,
  tasks,
  team,
  timeUsed,
  type ProjectStatus,
} from "@/lib/data";
import { useNow } from "./hooks";
import { summarySentence, type OpenRef } from "./Overview";
import { healthPoints } from "./ProjectsView";
import { dueText, taskGroup } from "./TasksView";
import { personInfo, whyText } from "./Views";

/* ---------- Brief model (one source for the on-screen view and the copied text) ---------- */

type Tone = "red" | "amber" | "orange" | "purple" | "green" | "blue" | "slate";

interface BriefItem {
  key: string;
  lead: string; // bold part
  rest: string;
  tone: Tone;
  ref?: OpenRef;
}

interface BriefSection {
  id: string;
  title: string;
  items: BriefItem[];
  empty: string;
}

const toneDot: Record<Tone, string> = {
  red: "bg-st-red",
  amber: "bg-st-amber",
  orange: "bg-st-orange",
  purple: "bg-st-purple",
  green: "bg-st-green",
  blue: "bg-st-blue",
  slate: "bg-st-slate",
};

const statusTone: Record<ProjectStatus, Tone> = {
  "off-track": "red",
  watch: "amber",
  "on-track": "green",
  "not-started": "slate",
};

const statusLabel: Record<ProjectStatus, string> = {
  "off-track": "Off track",
  watch: "Needs watching",
  "on-track": "On track",
  "not-started": "Not started",
};

const KEY_DATE_DAYS = 14;

const fmtLong = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtShort = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function dayFrom(now: Date, offset: number) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}

function inDays(d: number) {
  if (d === 0) return "today";
  return d === 1 ? "tomorrow" : `in ${d} days`;
}

function buildBrief(now: Date) {
  const attention = projects
    .filter((p) => ["off-track", "watch"].includes(projectStatus(p)))
    .sort((a, b) => (projectStatus(a) === "off-track" ? -1 : 0) - (projectStatus(b) === "off-track" ? -1 : 0));
  const decisions = projects.filter((p) => p.decision?.trim());
  const late = tasks
    .filter((t) => ["overdue", "blocked"].includes(taskGroup(t)))
    .sort((a, b) => (taskGroup(a) === "overdue" ? 0 : 1) - (taskGroup(b) === "overdue" ? 0 : 1) || a.dueOffset - b.dueOffset);
  const stretched = team.filter((m) => m.load > STRETCHED_THRESHOLD).sort((a, b) => b.load - a.load);
  const onTrack = projects.filter((p) => projectStatus(p) === "on-track");
  const doneTasks = tasks.filter((t) => t.state === "done");
  const dueThisWeek = tasks.filter((t) => t.state !== "done" && t.dueOffset >= 0 && t.dueOffset <= 7).length;

  const stats = [
    { label: "Projects at risk", value: attention.length, tone: "text-st-red-strong" },
    { label: "Overdue", value: late.filter((t) => taskGroup(t) === "overdue").length, tone: "text-st-red-strong" },
    { label: "Blocked", value: late.filter((t) => t.state === "blocked").length, tone: "text-st-purple" },
    { label: "Decisions", value: decisions.length, tone: "text-st-amber-strong" },
    { label: "Due in 7 days", value: dueThisWeek, tone: "text-st-blue" },
  ];

  const sections: BriefSection[] = [
    {
      id: "decisions",
      title: "Decisions waiting on you",
      empty: "No decisions are waiting on you.",
      items: decisions.map((p) => ({
        key: `d-${p.id}`,
        lead: `${p.name}:`,
        rest: `${p.decision}. Lead ${p.lead}, deadline ${fmtLong(dayFrom(now, p.endOffset))}.`,
        tone: "amber",
        ref: { kind: "project", id: p.id },
      })),
    },
    {
      id: "projects",
      title: "Projects needing attention",
      empty: "Every project is on track.",
      items: attention.map((p) => {
        const st = projectStatus(p);
        return {
          key: `p-${p.id}`,
          lead: `${p.name} (${statusLabel[st]}):`,
          rest: `${healthPoints(p).join("; ")}.`,
          tone: statusTone[st],
          ref: { kind: "project", id: p.id },
        };
      }),
    },
    {
      id: "tasks",
      title: "Overdue and blocked tasks",
      empty: "Nothing is overdue or blocked.",
      items: late.map((t) => {
        const blocked = t.state === "blocked";
        return {
          key: `t-${t.id}`,
          lead: t.title,
          rest: `(${projectById(t.projectId).name}, ${t.owner}): ${blocked ? `blocked${t.note ? ` - ${t.note}` : ""}` : dueText(t)}`,
          tone: blocked ? "purple" : "red",
          ref: { kind: "task", id: t.id },
        };
      }),
    },
    {
      id: "dates",
      title: `Key dates, next ${KEY_DATE_DAYS} days`,
      empty: `No deadlines or starts in the next ${KEY_DATE_DAYS} days.`,
      items: keyDates(KEY_DATE_DAYS).map((k) => ({
        key: `k-${k.key}`,
        lead: `${fmtShort(dayFrom(now, k.offset))}:`,
        rest: `${k.title} (${inDays(k.offset)})`,
        tone: k.offset <= 7 ? "orange" : "blue",
        ref: { kind: "project", id: k.projectId },
      })),
    },
    {
      id: "people",
      title: "People who are stretched",
      empty: "Nobody is over capacity.",
      items: stretched.map((m) => ({
        key: `m-${m.name}`,
        lead: `${m.name} (${m.load}% of capacity):`,
        rest: whyText(m, personInfo(m)).replace(/\.$/, ""),
        tone: "orange",
      })),
    },
    {
      id: "good",
      title: "Going well",
      empty: "No projects are on track yet.",
      items: [
        ...onTrack.map((p) => ({
          key: `g-${p.id}`,
          lead: `${p.name}:`,
          rest: `on track, ${p.done}% done with ${timeUsed(p)}% of the time used.`,
          tone: "green" as Tone,
          ref: { kind: "project", id: p.id } as OpenRef,
        })),
        ...(doneTasks.length
          ? [
              {
                key: "g-done",
                lead: `${plural(doneTasks.length, "task")} completed:`,
                rest: doneTasks.map((t) => t.title).join("; ") + ".",
                tone: "green" as Tone,
              },
            ]
          : []),
      ],
    },
  ];

  return { stats, sections, headline: summarySentence() };
}

function briefAsText(now: Date, brief: ReturnType<typeof buildBrief>) {
  const lines = [`Weekly brief - ${fmtLong(now)}`, "", "Headline", brief.headline, ""];
  lines.push(brief.stats.map((s) => `${s.label}: ${s.value}`).join(" | "), "");
  for (const s of brief.sections) {
    lines.push(`${s.title}${s.items.length ? ` (${s.items.length})` : ""}`);
    if (s.items.length) for (const i of s.items) lines.push(`• ${i.lead} ${i.rest}`);
    else lines.push(`• ${s.empty}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/* ---------- View ---------- */

const btn = "rounded-lg border border-line bg-surface px-3.5 py-2 text-[15px] font-medium hover:bg-track";

export default function WeeklyBrief({ onClose, onOpen }: { onClose: () => void; onOpen: (ref: OpenRef) => void }) {
  const now = useNow();
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!now) return null;
  const brief = buildBrief(now);
  const text = briefAsText(now, brief);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Older browsers or blocked clipboard permission: fall back to a hidden textarea.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {}
    }
    setCopied(ok ? "ok" : "failed");
    setTimeout(() => setCopied(null), 2500);
  };

  const email = `mailto:?subject=${encodeURIComponent(`Weekly brief - ${fmtLong(now)}`)}&body=${encodeURIComponent(text)}`;

  const open = (ref?: OpenRef) => {
    if (!ref) return;
    onClose();
    onOpen(ref);
  };

  return (
    <div className="brief-print-root fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="brief-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl print:max-h-none print:max-w-none print:overflow-visible print:border-0 print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 id="brief-title" className="text-xl font-bold">
              Weekly brief
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Prepared {fmtLong(now)}. Built from the live data on this dashboard.
            </p>
          </div>
          <button onClick={onClose} className={`${btn} print:hidden`}>
            Close
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5 print:overflow-visible">
          <section>
            <h3 className="font-bold">Headline</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed">{brief.headline}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {brief.stats.map((s) => (
                <div key={s.label} className="flex flex-col-reverse rounded-lg bg-track/50 px-3 py-2">
                  <dt className="truncate text-xs text-muted">{s.label}</dt>
                  <dd className={`text-xl font-bold leading-tight ${s.value ? s.tone : "text-muted"}`}>{s.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {brief.sections.map((s) => (
            <section key={s.id} className="mt-6 break-inside-avoid">
              <h3 className="flex items-center gap-2 font-bold">
                {s.title}
                {s.items.length > 0 && (
                  <span className="rounded-full bg-track px-2 text-xs font-semibold text-muted">{s.items.length}</span>
                )}
              </h3>
              {s.items.length ? (
                <ul className="mt-1.5 space-y-0.5">
                  {s.items.map((i) => (
                    <li key={i.key}>
                      <button
                        onClick={() => open(i.ref)}
                        disabled={!i.ref}
                        className="flex w-full gap-2.5 rounded-md px-2 py-1.5 text-left text-[15px] leading-snug enabled:hover:bg-track/60 disabled:cursor-default"
                      >
                        <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${toneDot[i.tone]}`} aria-hidden />
                        <span>
                          <span className="font-semibold">{i.lead}</span> {i.rest}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 px-2 text-[15px] text-muted">{s.empty}</p>
              )}
            </section>
          ))}

          <p className="mt-6 text-xs text-muted print:hidden">Select any item to open its details.</p>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-3.5 print:hidden">
          <span role="status" className={`mr-auto text-sm ${copied === "failed" ? "text-st-red-strong" : "text-st-green"}`}>
            {copied === "ok" ? "✓ Copied to clipboard" : copied === "failed" ? "Could not copy. Use Email or Print instead." : ""}
          </span>
          <button onClick={() => window.print()} className={btn}>
            Print or save PDF
          </button>
          <a href={email} className={btn}>
            Email
          </a>
          <button onClick={copy} className={btn}>
            Copy as text
          </button>
          <button
            ref={closeRef}
            onClick={onClose}
            className="rounded-lg bg-header px-4 py-2 text-[15px] font-semibold text-white hover:opacity-90 dark:bg-accent dark:text-header"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
