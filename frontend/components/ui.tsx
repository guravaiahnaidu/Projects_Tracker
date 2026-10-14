"use client";

import { useEffect, type ReactNode } from "react";
import type { Marker, ProjectStatus } from "@/lib/data";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 shadow-sm transition-shadow duration-150 hover:shadow-md ${className}`}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
    </header>
  );
}

const markerClass: Record<Marker, string> = {
  "square-red": "h-3 w-3 bg-st-red",
  "dot-red": "h-2 w-2 rounded-full bg-st-red",
  "dot-purple": "h-2 w-2 rounded-full bg-st-purple",
  "dot-blue": "h-2 w-2 rounded-full bg-st-blue",
  "dot-orange": "h-2 w-2 rounded-full bg-st-orange",
  "triangle-amber": "",
};

export function MarkerIcon({ marker }: { marker: Marker }) {
  if (marker === "triangle-amber") {
    return (
      <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 fill-st-amber" aria-hidden>
        <path d="M6 1 11.5 11H.5Z" />
      </svg>
    );
  }
  return <span className={`inline-block shrink-0 ${markerClass[marker]}`} aria-hidden />;
}

const statusMeta: Record<ProjectStatus, { label: string; marker: ReactNode; bar: string }> = {
  "off-track": { label: "Off track", marker: <MarkerIcon marker="square-red" />, bar: "bg-st-red" },
  watch: { label: "Needs watching", marker: <MarkerIcon marker="triangle-amber" />, bar: "bg-st-amber" },
  "on-track": {
    label: "On track",
    marker: <span className="h-2 w-2 rounded-full bg-st-green" aria-hidden />,
    bar: "bg-st-green",
  },
  "not-started": {
    label: "Not started",
    marker: <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-muted" aria-hidden />,
    bar: "bg-muted",
  },
};

export const barColor = (s: ProjectStatus) => statusMeta[s].bar;

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const m = statusMeta[status];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line whitespace-nowrap px-2.5 py-0.5 text-sm font-medium">
      {m.marker}
      {m.label}
    </span>
  );
}

export function ProgressBar({ done, time, status }: { done: number; time: number; status: ProjectStatus }) {
  return (
    <div
      className="relative h-3 w-full rounded-full bg-track"
      role="img"
      aria-label={`${done}% done, ${time}% of time used`}
    >
      <div className={`h-full rounded-full ${barColor(status)}`} style={{ width: `${done}%` }} />
      {status !== "not-started" && (
        <div
          className="absolute -top-1.5 h-6 w-0.5 -translate-x-1/2 rounded bg-ink"
          style={{ left: `${time}%` }}
          title={`Expected today: ${time}%`}
        />
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean; // for longer forms
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[85vh] w-full ${wide ? "max-w-2xl" : "max-w-xl"} overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md px-2 text-2xl leading-none text-muted hover:bg-track hover:text-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
