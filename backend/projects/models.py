from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from members.models import Member


class Phase(models.TextChoices):
    NOT_STARTED = "Not Started", "Not Started"
    IN_PROGRESS = "In Progress", "In Progress"
    AT_RISK = "At Risk", "At Risk"
    ON_HOLD = "On Hold", "On Hold"
    COMPLETED = "Completed", "Completed"


LEAD_ROLE = "Project Lead"
DEFAULT_ROLE = "Team Member"
DEFAULT_DEPARTMENT = "General"


class Project(models.Model):
    name = models.CharField(max_length=200)
    department = models.CharField(max_length=120, default=DEFAULT_DEPARTMENT)
    lead = models.ForeignKey(Member, on_delete=models.PROTECT, related_name="led_projects")
    phase = models.CharField(max_length=20, choices=Phase.choices, default=Phase.IN_PROGRESS)
    description = models.TextField(blank=True, default="")
    start_date = models.DateField()
    end_date = models.DateField()
    progress = models.PositiveSmallIntegerField(
        default=0, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    decision = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gt=models.F("start_date")), name="project_end_after_start"
            ),
            models.CheckConstraint(
                condition=models.Q(progress__gte=0, progress__lte=100), name="project_progress_0_100"
            ),
        ]

    def __str__(self):
        return self.name


class ProjectMember(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    member = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=120, default=DEFAULT_ROLE)

    class Meta:
        ordering = ["role", "member__name"]
        constraints = [
            models.UniqueConstraint(fields=["project", "member"], name="project_member_unique")
        ]

    def __str__(self):
        return f"{self.member} on {self.project} ({self.role})"


class ProjectObjective(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="objectives")
    description = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.description
