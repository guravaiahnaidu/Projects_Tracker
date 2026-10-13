"""Derived task values (urgency groups, labels). Computed from real dates, never stored."""

from datetime import date

OPEN_GROUPS = ("overdue", "today", "next2", "week", "later", "blocked")
ALL_GROUPS = OPEN_GROUPS + ("done",)


def due_offset(task, on: date) -> int:
    return (task.due_date - on).days


def group(task, on: date) -> str:
    """done/blocked override the date-based groups."""
    if task.state == "done":
        return "done"
    if task.state == "blocked":
        return "blocked"
    d = due_offset(task, on)
    if d < 0:
        return "overdue"
    if d == 0:
        return "today"
    if d <= 2:
        return "next2"
    if d <= 7:
        return "week"
    return "later"


def bucket(task, on: date) -> str:
    """Coarser grouping used by summary/attention: overdue, today, blocked, upcoming, done."""
    if task.state == "done":
        return "done"
    if task.state == "blocked":
        return "blocked"
    d = due_offset(task, on)
    if d < 0:
        return "overdue"
    return "today" if d == 0 else "upcoming"


def workload_kind(task, on: date) -> str:
    b = bucket(task, on)
    if b in ("overdue", "blocked"):
        return b
    return "soon" if due_offset(task, on) <= 7 else "later"


def due_label(task, on: date) -> str:
    if task.state == "done":
        return "Done"
    if task.state == "blocked":
        return "Blocked"
    d = due_offset(task, on)
    if d < 0:
        return f"{-d} day{'' if d == -1 else 's'} overdue"
    if d == 0:
        return "Due today"
    if d == 1:
        return "Due tomorrow"
    return f"Due in {d} days"
