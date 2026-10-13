"""Database-side task filtering, shared by /tasks/ and /projects/{id}/tasks/."""

from datetime import date, timedelta

from django.db.models import Q

from config.params import parse_id, parse_month

from .models import State, Task
from .rules import ALL_GROUPS


def group_q(group: str, on: date) -> Q:
    """The ORM equivalent of tasks.rules.group()."""
    open_ = ~Q(state__in=[State.DONE, State.BLOCKED])
    if group == "done":
        return Q(state=State.DONE)
    if group == "blocked":
        return Q(state=State.BLOCKED)
    if group == "overdue":
        return open_ & Q(due_date__lt=on)
    if group == "today":
        return open_ & Q(due_date=on)
    if group == "next2":
        return open_ & Q(due_date__gt=on, due_date__lte=on + timedelta(days=2))
    if group == "week":
        return open_ & Q(due_date__gt=on + timedelta(days=2), due_date__lte=on + timedelta(days=7))
    if group == "later":
        return open_ & Q(due_date__gt=on + timedelta(days=7))
    raise ValueError(group)


def group_counts(on: date, base=None) -> dict:
    base = Task.objects.all() if base is None else base
    return {g: base.filter(group_q(g, on)).count() for g in ALL_GROUPS}


def filter_tasks(queryset, params, on: date):
    """Apply query-string filters. Returns (queryset, error_message_or_None)."""
    if q := params.get("q", "").strip():
        queryset = queryset.filter(
            Q(title__icontains=q) | Q(owner__name__icontains=q) | Q(project__name__icontains=q)
        )

    status = params.get("status", "open")
    if status == "open":
        queryset = queryset.exclude(state=State.DONE)
    elif status in State.values:
        queryset = queryset.filter(state=status)
    elif status != "all":
        return queryset, "status must be open, all, not-started, in-progress, blocked or done."

    for param, field in (("project", "project_id"), ("owner", "owner_id")):
        if value := params.get(param):
            queryset = queryset.filter(**{field: parse_id(value, param)})

    if priority := params.get("priority"):
        queryset = queryset.filter(priority=priority)

    if group := params.get("group"):
        if group not in ALL_GROUPS:
            return queryset, f"group must be one of {', '.join(ALL_GROUPS)}."
        queryset = queryset.filter(group_q(group, on))

    for param, lookup in (("due_from", "due_date__gte"), ("due_to", "due_date__lte")):
        if value := params.get(param):
            try:
                queryset = queryset.filter(**{lookup: date.fromisoformat(value)})
            except ValueError:
                return queryset, f"{param} must be YYYY-MM-DD."

    if month := params.get("month"):
        year, mon = parse_month(month)
        queryset = queryset.filter(due_date__year=year, due_date__month=mon)

    return queryset, None
