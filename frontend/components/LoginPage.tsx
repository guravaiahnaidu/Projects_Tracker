"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, restoreSession, signIn } from "@/lib/api";

type Field = "username" | "password";

const NOTICES: Record<string, string> = {
  expired: "Your session has expired. Please sign in again.",
  "signed-out": "You have been signed out.",
};

const input =
  "h-11 w-full rounded-lg border bg-surface px-3.5 text-[15px] text-ink outline-none placeholder:text-muted/70 focus:border-st-blue focus:ring-2 focus:ring-st-blue/20 disabled:opacity-70";

/** A readable sign-in failure for every way the request can go wrong. */
function signInProblem(e: unknown): { message: string; fields?: Partial<Record<Field, string>> } {
  if (!(e instanceof ApiError)) return { message: "Something went wrong. Please try again." };
  if (e.status === 401) return { message: "Incorrect username or password." };
  if (e.status === 429) return { message: "Too many sign-in attempts. Wait a minute, then try again." };
  if (e.status === 400) {
    return {
      message: "Check the highlighted fields.",
      fields: { username: e.fields.username?.[0], password: e.fields.password?.[0] },
    };
  }
  if (e.status === 0) return { message: e.message };
  if (e.status >= 500) return { message: "The server could not complete the sign-in. Please try again in a moment." };
  return { message: e.message };
}

export default function LoginPage() {
  const router = useRouter();
  const notice = NOTICES[useSearchParams().get("reason") ?? ""];
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Already signed in (another tab, or the back button): go straight to the dashboard.
  useEffect(() => {
    let live = true;
    restoreSession().then(
      (user) => {
        if (live && user) router.replace("/");
      },
      () => {}, // backend unreachable: the form reports it when the person signs in
    );
    return () => {
      live = false;
    };
  }, [router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || done) return;
    const missing: Partial<Record<Field, string>> = {};
    if (!username.trim()) missing.username = "Enter your username.";
    if (!password) missing.password = "Enter your password.";
    setFieldErrors(missing);
    setError("");
    if (missing.username || missing.password) {
      (missing.username ? usernameRef : passwordRef).current?.focus();
      return;
    }

    setBusy(true);
    try {
      await signIn(username.trim(), password);
      setDone(true);
      router.replace("/");
    } catch (err) {
      const problem = signInProblem(err);
      setError(problem.message);
      setFieldErrors(problem.fields ?? {});
      if (err instanceof ApiError && err.status === 401) {
        setPassword("");
        passwordRef.current?.focus();
      }
      setBusy(false);
    }
  };

  const onPasswordKey = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));

  return (
    <main className="grid flex-1 grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-rows-1">
      <BrandPanel />

      <section className="flex items-start justify-center px-4 py-8 sm:px-8 sm:py-12 lg:items-center">
        <div className="w-full max-w-[420px]">
          <div className="rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-bold">Sign in</h2>
            <p className="mt-1 text-[15px] text-muted">Use your manager account to open the dashboard.</p>

            {notice && !error && (
              <p role="status" className="mt-5 rounded-lg bg-st-blue/10 px-3.5 py-2.5 text-sm font-medium text-ink">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-5 flex items-start gap-2 rounded-lg bg-st-red/8 px-3.5 py-2.5 text-sm font-medium text-st-red-strong">
                <svg viewBox="0 0 20 20" className="mt-px h-4 w-4 shrink-0" aria-hidden>
                  <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M10 6v4.5M10 13.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {error}
              </p>
            )}

            <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
              <div>
                <label htmlFor="login-username" className="mb-1.5 block text-sm font-semibold">
                  Username
                </label>
                <input
                  ref={usernameRef}
                  id="login-username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy || done}
                  aria-invalid={!!fieldErrors.username}
                  aria-describedby={fieldErrors.username ? "login-username-error" : undefined}
                  className={`${input} ${fieldErrors.username ? "border-st-red" : "border-line"}`}
                />
                {fieldErrors.username && (
                  <p id="login-username-error" className="mt-1.5 text-sm text-st-red-strong">
                    {fieldErrors.username}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-sm font-semibold">
                  Password
                </label>
                <div className="relative">
                  <input
                    ref={passwordRef}
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={onPasswordKey}
                    onKeyDown={onPasswordKey}
                    onBlur={() => setCapsLock(false)}
                    disabled={busy || done}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={
                      [fieldErrors.password && "login-password-error", capsLock && "login-caps"].filter(Boolean).join(" ") || undefined
                    }
                    className={`${input} pr-12 ${fieldErrors.password ? "border-st-red" : "border-line"}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    aria-controls="login-password"
                    title={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-st-blue"
                  >
                    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" aria-hidden>
                      <path
                        d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                      {showPassword && <path d="M3 17 17 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
                    </svg>
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id="login-password-error" className="mt-1.5 text-sm text-st-red-strong">
                    {fieldErrors.password}
                  </p>
                )}
                {capsLock && (
                  <p id="login-caps" className="mt-1.5 text-sm font-medium text-st-amber-strong">
                    Caps Lock is on.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={busy || done}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-header px-5 text-[15px] font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-st-blue disabled:cursor-progress disabled:opacity-80 dark:bg-accent dark:text-header"
              >
                {(busy || done) && (
                  <svg viewBox="0 0 20 20" className="h-4 w-4 animate-spin" aria-hidden>
                    <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.2" />
                    <path d="M17 10a7 7 0 0 0-7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                )}
                {done ? "Opening dashboard..." : busy ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </div>

          <p className="mt-5 text-center text-sm text-muted">
            Need access? Ask your administrator to set up a manager account for you.
          </p>
        </div>
      </section>
    </main>
  );
}

function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="currentColor" fillOpacity="0.12" />
      <rect x="7" y="9" width="12" height="3" rx="1.5" fill="var(--accent)" />
      <rect x="11" y="14.5" width="14" height="3" rx="1.5" fill="currentColor" fillOpacity="0.9" />
      <rect x="7" y="20" width="9" height="3" rx="1.5" fill="currentColor" fillOpacity="0.55" />
    </svg>
  );
}

function BrandPanel() {
  return (
    <section className="relative flex flex-col overflow-hidden bg-header px-6 py-6 text-white sm:px-10 lg:px-14 lg:py-12">
      <div className="flex items-center gap-3">
        <LogoMark className="h-9 w-9" />
        <span className="text-lg font-bold tracking-tight sm:text-xl">Project Tracker</span>
      </div>

      <div className="mt-6 max-w-xl lg:my-auto lg:py-10">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl xl:text-[2.1rem]">Your work. Your projects. One clear view.</h1>
        <p className="mt-3 hidden text-base text-white/75 sm:block">
          Project health, deadlines, decisions and team workload, together in one place.
        </p>
        <ProgressIllustration />
      </div>

      <p className="mt-6 hidden text-sm text-white/55 lg:block">For internal use by authorised managers.</p>
    </section>
  );
}

/** Abstract project timeline: bars with progress, a "today" line and a deadline marker. Decorative only. */
function ProgressIllustration() {
  const rows = [
    { start: 2, width: 44, done: 100, color: "var(--green)" },
    { start: 14, width: 52, done: 68, color: "var(--green)" },
    { start: 30, width: 46, done: 35, color: "var(--amber)" },
    { start: 46, width: 40, done: 12, color: "var(--blue)" },
  ];
  return (
    <div aria-hidden className="mt-10 hidden rounded-xl border border-white/10 bg-white/[0.04] p-5 lg:block">
      <div className="flex items-center gap-2">
        {["var(--green)", "var(--amber)", "var(--red)"].map((c, i) => (
          <span key={c} className="flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: c }} />
            <span className="h-1.5 rounded-full bg-white/30" style={{ width: [34, 26, 20][i] }} />
          </span>
        ))}
      </div>

      <div className="relative mt-5 space-y-3.5">
        {/* week gridlines */}
        <div className="pointer-events-none absolute inset-0 flex justify-between">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="w-px bg-white/[0.07]" />
          ))}
        </div>
        {/* today */}
        <span className="absolute -bottom-1 -top-1 left-[58%] w-0.5 rounded-full bg-accent/80" />
        {rows.map((r, i) => (
          <div key={i} className="relative h-3">
            <div
              className="absolute inset-y-0 overflow-hidden rounded-full bg-white/[0.12]"
              style={{ left: `${r.start}%`, width: `${r.width}%` }}
            >
              <div className="h-full rounded-full" style={{ width: `${r.done}%`, background: r.color }} />
            </div>
          </div>
        ))}
        {/* deadline */}
        <span className="absolute -right-0.5 top-[calc(50%-5px)] h-2.5 w-2.5 rotate-45 rounded-[2px] border-2 border-accent" />
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
        <div className="flex -space-x-2">
          {["var(--blue)", "var(--purple)", "var(--green)", "var(--orange)"].map((c) => (
            <span key={c} className="h-7 w-7 rounded-full border-2 border-header" style={{ background: c, opacity: 0.85 }} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-16 rounded-full bg-white/20" />
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-st-green/90">
            <svg viewBox="0 0 12 12" className="h-3 w-3">
              <path d="m3 6.2 2 2 4-4.4" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}
