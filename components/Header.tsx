"use client";

import { useNow, useTheme, type ThemePref } from "./hooks";

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

export default function Header({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const now = useNow();
  const [theme, setTheme] = useTheme();
  const dateLabel = now?.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <header className="bg-header text-white">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 sm:px-8 lg:px-12">
        <div className="py-2.5">
          <h1 className="text-xl font-bold leading-tight">Executive Dashboard</h1>
          <p className="text-sm text-white/80">Company overview</p>
        </div>

        <nav className="-mx-4 order-last flex w-full overflow-x-auto px-4 lg:order-none lg:mx-0 lg:w-auto lg:px-0" aria-label="Sections">
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

        <div className="ml-auto flex items-center gap-5 py-2.5">
          <span className="hidden text-sm text-white/85 desk:inline" suppressHydrationWarning>
            {dateLabel}
          </span>
          <div className="flex overflow-hidden rounded-lg border border-white/25" role="group" aria-label="Theme">
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
        </div>
      </div>
    </header>
  );
}
