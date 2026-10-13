"use client";

import { useCallback, useReducer, useState } from "react";
import Header, { type Tab } from "./Header";
import Overview, { type NavTarget, type OpenRef } from "./Overview";
import { TasksView, type Group } from "./TasksView";
import { ProjectsView } from "./ProjectsView";
import { TeamView, type Show } from "./Views";
import TaskEditor from "./TaskEditor";
import WeeklyBrief from "./WeeklyBrief";

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [task, setTask] = useState<string | null>(null);
  const [focusProject, setFocusProject] = useState<string | null>(null);
  const [tasksFocus, setTasksFocus] = useState<Group | null>(null);
  const [teamShow, setTeamShow] = useState<Show>("all");
  const [brief, setBrief] = useState(false);
  // The editor changes the shared sample data; bump re-renders the open tab so it shows the edit.
  const [, bump] = useReducer((x: number) => x + 1, 0);
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
        {tab === "Overview" && <Overview onOpen={open} onBrief={() => setBrief(true)} onNavigate={navigate} />}
        {tab === "Tasks & Deadlines" && <TasksView key={tasksFocus ?? "all"} onOpen={open} initialFocus={tasksFocus} />}
        {tab === "Projects" && <ProjectsView key={focusProject ?? "all"} onOpen={open} focusId={focusProject} />}
        {tab === "Team" && <TeamView key={teamShow} onOpen={open} initialShow={teamShow} />}
      </main>

      {task && <TaskEditor key={task} id={task} onClose={close} onSaved={bump} onProject={goToProject} />}
      {brief && <WeeklyBrief onClose={closeBrief} onOpen={open} />}
    </>
  );
}
