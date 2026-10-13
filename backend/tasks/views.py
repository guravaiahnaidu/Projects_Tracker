from django.db import transaction
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from activity.services import log
from projects.rules import today as today_fn

from .models import State, Task
from .queries import filter_tasks, group_counts
from .serializers import TaskCreateSerializer, TaskUpdateSerializer, task_payload


def fmt_date(d) -> str:
    return f"{d.day} {d.strftime('%b %Y')}"


def get_task(pk) -> Task:
    try:
        return Task.objects.select_related("project", "owner").get(pk=pk)
    except Task.DoesNotExist:
        raise NotFound("Task not found.")


def list_tasks_response(queryset, params):
    on = today_fn()
    filtered, error = filter_tasks(queryset.select_related("project", "owner"), params, on)
    if error:
        raise ValidationError({"detail": error})
    rows = [task_payload(t, on) for t in filtered]
    return Response({"results": rows, "count": len(rows), "counts": group_counts(on)})


class TaskListView(APIView):
    def get(self, request):
        return list_tasks_response(Task.objects.all(), request.query_params)

    @transaction.atomic
    def post(self, request):
        ser = TaskCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        task = Task.objects.create(**ser.validated_data)
        log("task.created", "task", task.id, f"You added “{task.title}”", project=task.project)
        return Response(task_payload(get_task(task.pk)), status=201)


class TaskDetailView(APIView):
    def get(self, request, pk):
        return Response(task_payload(get_task(pk)))

    @transaction.atomic
    def patch(self, request, pk):
        task = get_task(pk)
        ser = TaskUpdateSerializer(task, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        original_title = task.title
        changes = []

        if "title" in data and data["title"] != task.title:
            changes.append(f"renamed to “{data['title']}”")
        if "owner" in data and data["owner"] != task.owner:
            changes.append(f"owner {task.owner.name} -> {data['owner'].name}")
        if "due_date" in data and data["due_date"] != task.due_date:
            changes.append(f"due {fmt_date(task.due_date)} -> {fmt_date(data['due_date'])}")
        if "priority" in data and data["priority"] != task.priority:
            changes.append(f"priority {task.priority} -> {data['priority']}")
        if "state" in data and data["state"] != task.state:
            changes.append(f"status {State(task.state).label} -> {State(data['state']).label}")
        if "note" in data and data["note"] != task.note:
            changes.append("note updated" if data["note"] else "note removed")

        for field, value in data.items():
            setattr(task, field, value)
        if changes:
            task.save()
            log(
                "task.updated",
                "task",
                task.id,
                f"You updated “{original_title}”: {', '.join(changes)}",
                project=task.project,
            )
        return Response(task_payload(get_task(pk)))

    @transaction.atomic
    def delete(self, request, pk):
        task = get_task(pk)
        title, task_id, project = task.title, task.id, task.project
        task.delete()
        log("task.deleted", "task", task_id, f"You deleted “{title}”", project=project)
        return Response(status=204)


class TaskCompleteView(APIView):
    @transaction.atomic
    def post(self, request, pk):
        task = get_task(pk)
        if task.state != State.DONE:
            task.state = State.DONE
            task.save()
            log("task.completed", "task", task.id, f"You marked “{task.title}” as Done", project=task.project)
        return Response(task_payload(get_task(pk)))
