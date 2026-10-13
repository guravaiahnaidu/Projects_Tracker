from django.db import models

from members.models import Member
from projects.models import Project


class State(models.TextChoices):
    NOT_STARTED = "not-started", "Not Started"
    IN_PROGRESS = "in-progress", "In Progress"
    BLOCKED = "blocked", "Blocked"
    DONE = "done", "Done"


class Priority(models.TextChoices):
    HIGH = "High", "High"
    MEDIUM = "Medium", "Medium"
    LOW = "Low", "Low"


class Task(models.Model):
    title = models.CharField(max_length=300)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="tasks")
    owner = models.ForeignKey(Member, on_delete=models.PROTECT, related_name="tasks")
    due_date = models.DateField()
    state = models.CharField(max_length=12, choices=State.choices, default=State.NOT_STARTED)
    priority = models.CharField(max_length=6, choices=Priority.choices, default=Priority.MEDIUM)
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_date", "id"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(state="blocked") | ~models.Q(note=""),
                name="task_blocked_requires_note",
            )
        ]

    def __str__(self):
        return self.title
