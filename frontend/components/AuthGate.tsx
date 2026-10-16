"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { errorMessage, getSessionUser, restoreSession, SESSION_EXPIRED_EVENT, signOut } from "@/lib/api";

type GateState = { status: "checking" } | { status: "ok" } | { status: "error"; message: string };

/**
 * Shows its children only to a signed-in manager. On a fresh page load the session is restored from the refresh cookie;
 * without one the visitor is sent to /login. A server that cannot be reached is shown as an error with Retry instead of
 * a sign-in prompt, so a backend outage never looks like being signed out.
 *
 * This only decides what the browser shows. The data itself is protected by the backend (DJANGO_API_REQUIRE_AUTH).
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GateState>(() => (getSessionUser() ? { status: "ok" } : { status: "checking" }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    restoreSession().then(
      (user) => {
        if (!live) return;
        if (user) setState({ status: "ok" });
        else router.replace("/login");
      },
      (e) => live && setState({ status: "error", message: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [router, attempt]);

  // The session ended while the dashboard was open: a full page load also drops every piece of loaded data.
  useEffect(() => {
    const expired = () => window.location.replace("/login?reason=expired");
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, []);

  if (state.status === "ok") return children;
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      {state.status === "checking" ? (
        <p role="status" className="text-muted">
          Checking your session...
        </p>
      ) : (
        <div role="alert" className="w-full max-w-md rounded-xl border border-line bg-surface p-6 text-center shadow-sm">
          <p className="font-semibold text-st-red-strong">Could not check your session.</p>
          <p className="mt-1 text-sm text-muted">{state.message}</p>
          <button
            onClick={() => {
              setState({ status: "checking" });
              setAttempt((n) => n + 1);
            }}
            className="mt-4 rounded-lg bg-header px-5 py-2 text-[15px] font-semibold text-white hover:opacity-90 dark:bg-accent dark:text-header"
          >
            Retry
          </button>
        </div>
      )}
    </main>
  );
}

/** Navbar control: who is signed in, and Sign out (revokes the session on the server, then reloads to /login). */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const user = getSessionUser();

  const onClick = async () => {
    setBusy(true);
    setFailed("");
    try {
      await signOut();
      window.location.replace("/login?reason=signed-out");
    } catch (e) {
      setFailed(`Could not sign out: ${errorMessage(e)}`);
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={failed || (user ? `Sign out ${user.username}` : "Sign out")}
      title={failed || (user ? `Signed in as ${user.username}. Sign out` : "Sign out")}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg border p-2 text-sm hover:bg-white/10 hover:text-white disabled:cursor-progress xl:px-3 xl:py-1.5 ${
        failed ? "border-red-300/70 text-red-200" : "border-white/25 text-white/85"
      }`}
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
        <path d="M8 3.5H4.5v13H8M12.5 6.5 16 10l-3.5 3.5M16 10H8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="hidden xl:inline">{busy ? "Signing out..." : "Sign out"}</span>
    </button>
  );
}
