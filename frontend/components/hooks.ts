"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, errorMessage, type ApiProjectMember } from "@/lib/api";
import { getNow, serverToday, subscribeStore, syncClock } from "@/lib/store";

/* Wall clock in the SERVER's time zone (see lib/serverClock.ts), client only: null during SSR to avoid
   hydration mismatches. A module-level timer refreshes it every minute while any component uses it, and
   lets the store notice when the server's calendar date changes. */
const TICK_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;

function subscribeNow(cb: () => void) {
  const unsubscribe = subscribeStore(cb);
  users++;
  if (timer === null && typeof window !== "undefined") timer = setInterval(syncClock, TICK_MS);
  return () => {
    unsubscribe();
    users--;
    if (users === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): Date | null {
  return useSyncExternalStore(subscribeNow, getNow, () => null);
}

/* Theme preference: "auto" | "light" | "dark", persisted in localStorage. */
export type ThemePref = "auto" | "light" | "dark";
const THEME_EVENT = "themechange";

function readTheme(): ThemePref {
  try {
    const t = localStorage.getItem("theme");
    if (t === "auto" || t === "dark" || t === "light") return t;
  } catch {}
  return "light";
}

function applyTheme(pref: ThemePref) {
  const dark =
    pref === "dark" || (pref === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function subscribeTheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    applyTheme(readTheme());
    cb();
  };
  window.addEventListener(THEME_EVENT, cb);
  window.addEventListener("storage", onSystem);
  mq.addEventListener("change", onSystem);
  return () => {
    window.removeEventListener(THEME_EVENT, cb);
    window.removeEventListener("storage", onSystem);
    mq.removeEventListener("change", onSystem);
  };
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "light" as ThemePref);
  const setTheme = useCallback((t: ThemePref) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
    applyTheme(t);
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);
  return [theme, setTheme];
}

/* The SERVER's calendar date (YYYY-MM-DD), client only (null during SSR). Follows the server's time zone and
   re-renders when that date changes (the same minute timer as useNow). */
export function useToday(): string | null {
  return useSyncExternalStore(subscribeNow, serverToday, () => null);
}

/* The people assigned to one project, fetched from /projects/<id>/members/ for the task forms' employee picker.
   "idle" until a project is chosen. A response for a project that is no longer selected is ignored, so switching
   quickly never shows the previous project's team. */
export type ProjectTeam =
  | { status: "idle" | "loading"; members: []; error: ""; retry: () => void }
  | { status: "ready"; members: ApiProjectMember[]; error: ""; retry: () => void }
  | { status: "error"; members: []; error: string; retry: () => void };

export function useProjectTeam(projectId: string): ProjectTeam {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; members?: ApiProjectMember[]; error?: string } | null>(null);
  const key = `${projectId}#${attempt}`;
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    api.listProjectMembers(Number(projectId)).then(
      (res) => live && setResult({ key, members: res.results }),
      (e) => live && setResult({ key, error: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [projectId, key]);

  if (!projectId) return { status: "idle", members: [], error: "", retry };
  if (result?.key !== key) return { status: "loading", members: [], error: "", retry };
  if (result.error !== undefined) return { status: "error", members: [], error: result.error, retry };
  return { status: "ready", members: result.members ?? [], error: "", retry };
}
