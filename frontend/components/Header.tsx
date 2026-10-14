"use client";

import type { ReactNode } from "react";
import { useTheme, useToday, type ThemePref } from "./hooks";

export const TABS = ["Overview", "Tasks & Deadlines", "Projects", "Team"] as const;
export type Tab = (typeof TABS)[number];

const themeOptions: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
  {
    value: "auto",
    label: "Auto",
    icon: (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1.5a6.5 6.5 0 0 0 0 13Z" fill="currentColor" />
      </svg>
    ),
  },
  {
    value: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <path
          d="M8 1v14M1 8h14M3 3l10 10M13 3 3 13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <path d="M10 1.5A6.5 6.5 0 1 0 14.5 10 5 5 0 0 1 10 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
];

export default function Header({
  tab,
  onTab,
  actions,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  actions?: ReactNode; // search and refresh controls
}) {
  const today = useToday();
  const [theme, setTheme] = useTheme();
  const date = today ? new Date(`${today}T00:00:00`) : null;
  const part = (o: Intl.DateTimeFormatOptions) => date?.toLocaleDateString("en-GB", o) ?? "";
  const compactDate = date ? `${part({ weekday: "short" })}, ${part({ day: "numeric", month: "short", year: "numeric" })}` : "";
  const shortDate = part({ day: "numeric", month: "short" });
  const fullDate = part({ weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <header className="bg-header text-white">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 sm:px-8 lg:flex-nowrap lg:px-12">
        <div className="shrink-0 py-2.5">
          <h1 className="text-xl font-bold leading-tight">Executive Dashboard</h1>
          <p className="text-sm text-white/80">Company overview</p>
        </div>

        <nav className="-mx-4 order-last flex w-full overflow-x-auto px-4 lg:order-none lg:mx-0 lg:w-auto lg:shrink-0 lg:px-0" aria-label="Sections">
          {TABS.map((t) => {
            const active = t === tab;
            return (
              <button
                key={t}
                onClick={() => onTab(t)}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap border-b-4 px-4 pb-3 pt-3.5 text-base transition-colors ${
                  active ? "border-accent text-white" : "border-transparent text-white/75 hover:text-white"
                }`}
              >
                {t}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-3 py-2.5 xl:gap-4">
          {actions}
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/25" role="group" aria-label="Theme">
            {themeOptions.map((o) => {
              const active = o.value === theme;
              return (
                <button
                  key={o.value}
                  onClick={() => setTheme(o.value)}
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 border-l border-white/25 px-3 py-1.5 text-sm first:border-l-0 ${
                    active ? "bg-white/10 font-bold text-white" : "text-white/80 hover:bg-white/5"
                  }`}
                >
                  {o.icon}
                  {o.label}
                </button>
              );
            })}
          </div>
          {today && (
            <time
              dateTime={today}
              title={fullDate}
              className="hidden shrink-0 whitespace-nowrap text-[13px] tabular-nums text-white/80 lg:inline"
            >
              <span className="min-[1240px]:hidden">{shortDate}</span>
              <span className="hidden min-[1240px]:inline">{compactDate}</span>
            </time>
          )}
        </div>
      </div>
    </header>
  );
}
