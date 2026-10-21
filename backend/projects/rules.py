"""Derived project values. Nothing here is stored; it is computed from current records."""

import math
from datetime import date

from django.db.models import Count, Q
from django.utils import timezone

OFF_TRACK_GAP = 15
WATCH_GAP = 3
# A task in any of these states means work on the project has begun.
STARTED_TASK_STATES = ("in-progress", "blocked", "done")


def today() -> date:
    return timezone.localdate()


def start_offset(project, on: date) -> int | None:
    """Days until the start; None when the project has no start date."""
    return None if project.start_date is None else (project.start_date - on).days


def end_offset(project, on: date) -> int | None:
    """Days until the deadline; None when the project has no deadline."""
    return None if project.end_date is None else (project.end_date - on).days


def time_used(project, on: date) -> int:
    """% of the schedule elapsed, clamped to 0-100 (JS Math.round semantics: .5 rounds up).

    Without both dates there is no schedule, so 0: health then follows progress alone.
    """
    if project.start_date is None or project.end_date is None:
        return 0
    total = (project.end_date - project.start_date).days
    pct = math.floor(-start_offset(project, on) / total * 100 + 0.5)
    return min(100, max(0, pct))


def with_task_stats(queryset):
    """Annotate task counts so task_stats() needs no extra query per project."""
    return queryset.annotate(
        task_total=Count("tasks", distinct=True),
        task_done=Count("tasks", filter=Q(tasks__state="done"), distinct=True),
        task_started=Count("tasks", filter=Q(tasks__state__in=STARTED_TASK_STATES), distinct=True),
    )


def task_stats(project) -> dict:
    """{total, done, started} task counts; read from with_task_stats() annotations, else queried once and cached."""
    if not hasattr(project, "task_total"):
        if project.pk is None:
            project.task_total = project.task_done = project.task_started = 0
        else:
            agg = project.tasks.aggregate(
                total=Count("id"),
                done=Count("id", filter=Q(state="done")),
                started=Count("id", filter=Q(state__in=STARTED_TASK_STATES)),
            )
            project.task_total, project.task_done, project.task_started = agg["total"], agg["done"], agg["started"]
    return {"total": project.task_total, "done": project.task_done, "started": project.task_started}


def progress(project) -> int:
    """% of work done: the progress set on the project, or (while that is 0) the share of its tasks that are done."""
    if project.progress:
        return project.progress
    stats = task_stats(project)
    return math.floor(stats["done"] / stats["total"] * 100 + 0.5) if stats["total"] else 0


def health(project, on: date) -> str:
    used = time_used(project, on)
    done = progress(project)
    # Not started only while no time has passed, nothing is done and no task has been picked up.
    if used == 0 and done == 0 and task_stats(project)["started"] == 0:
        return "not-started"
    gap = used - done
    if gap > OFF_TRACK_GAP:
        return "off-track"
    if gap > WATCH_GAP:
        return "watch"
    return "on-track"


HEALTH_RANK = {"off-track": 0, "watch": 1, "on-track": 2, "not-started": 3}
