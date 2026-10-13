"use client";

import { useCallback, useEffect, useState } from "react";
import { ensureLoaded, refresh, useStore } from "@/lib/store";
import Header, { type Tab } from "./Header";
import Overview, { type NavTarget, type OpenRef } from "./Overview";
import { TasksView, type Group } from "./TasksView";
import { ProjectsView } from "./ProjectsView";
import { TeamView, type Show } from "./Views";
import TaskEditor from "./TaskEditor";
import WeeklyBrief from "./WeeklyBrief";

function LoadError({ message, loading, compact = false }: { message: string; loading: boolean; compact?: boolean }) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg bg-st-red/8 px-4 py-3 text-st-red-strong ${compact ? "mb-5" : "py-6"}`}
    >
      <p className="text-sm font-medium">
        {compact ? "Could not refresh the latest data. " : "Could not load the dashboard. "}
        {message}
      </p>
      <button
        onClick={() => void refresh()}
        disabled={loading}
        className="rounded-lg border border-line bg-surface px-3.5 py-2 text-[15px] font-medium text-ink hover:bg-track disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Retrying..." : "Retry"}
      </button>
    </div>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [task, setTask] = useState<string | null>(null);
  const [focusProject, setFocusProject] = useState<string | null>(null);
  const [tasksFocus, setTasksFocus] = useState<Group | null>(null);
  const [teamShow, setTeamShow] = useState<Show>("all");
  const [brief, setBrief] = useState(false);
  // The shared arrays are filled from the API by the store; this re-renders the open tab after every load or refetch.
  const store = useStore();
  useEffect(() => {
    ensureLoaded();
  }, []);
  const close = useCallback(() => setTask(null), []);
  const closeBrief = useCallback(() => setBrief(false), []);

  // Projects open in the Projects tab with that project selected; tasks open in a popup.
  const goToProject = useCallback((id: string) => {
    setTask(null);
    setBrief(false);
    setFocusProject(id);
    setTab("Projects");
    window.scrollTo({ top: 0 });
  }, []);
  const open = useCallback(
    (ref: OpenRef) => (ref.kind === "project" ? goToProject(ref.id) : setTask(ref.id)),
    [goToProject],
  );
  const changeTab = (t: Tab) => {
    setTasksFocus(null);
    setTeamShow("all");
    setFocusProject(null);
    setTab(t);
  };

  // Summary cards on the Overview jump to a tab with the matching filter already applied.
  const navigate = (to: NavTarget) => {
    changeTab(to.tab);
    if (to.tab === "Tasks & Deadlines") setTasksFocus(to.focus);
    if (to.tab === "Team") setTeamShow(to.show);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <Header tab={tab} onTab={changeTab} />
      <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-6 sm:px-8 lg:px-12">
        {!store.loaded && !store.error && (
          <p role="status" className="rounded-xl border border-dashed border-line bg-surface py-12 text-center text-muted">
            Loading your dashboard...
          </p>
        )}
        {!store.loaded && store.error && <LoadError message={store.error} loading={store.loading} />}
        {store.loaded && store.error && <LoadError message={store.error} loading={store.loading} compact />}
        {store.loaded && tab === "Overview" && <Overview onOpen={open} onBrief={() => setBrief(true)} onNavigate={navigate} />}
        {store.loaded && tab === "Tasks & Deadlines" && <TasksView key={tasksFocus ?? "all"} onOpen={open} initialFocus={tasksFocus} />}
        {store.loaded && tab === "Projects" && <ProjectsView key={focusProject ?? "all"} onOpen={open} focusId={focusProject} />}
        {store.loaded && tab === "Team" && <TeamView key={teamShow} onOpen={open} initialShow={teamShow} />}
      </main>

      {store.loaded && task && <TaskEditor key={task} id={task} onClose={close} onProject={goToProject} />}
      {brief && <WeeklyBrief onClose={closeBrief} onOpen={open} />}
    </>
  );
}
