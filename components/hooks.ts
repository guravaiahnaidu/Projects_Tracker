"use client";

import { useCallback, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/* Current time, client only (null during SSR to avoid hydration mismatches). */
let nowCache: Date | null = null;
export function useNow(): Date | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => (nowCache ??= new Date()),
    () => null,
  );
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
