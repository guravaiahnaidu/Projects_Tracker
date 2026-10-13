from rest_framework import serializers

from config.limits import PROJECT_DECISION_MAX, PROJECT_DESCRIPTION_MAX
from config.params import ID_MAX
from members.models import Member
from tasks import rules as task_rules

from . import rules
from .models import DEFAULT_DEPARTMENT, DEFAULT_ROLE, Phase, Project

DEADLINE_MESSAGE = "The deadline must be after the start date."


def _clean(value: str) -> str:
    return " ".join(value.split())


class ProjectCreateSerializer(serializers.Serializer):
    name = serializers.CharField(
        max_length=200, error_messages={"blank": "Enter a project name.", "required": "Enter a project name."}
    )
    department = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    lead_id = serializers.PrimaryKeyRelatedField(
        queryset=Member.objects.all(), source="lead", error_messages={"does_not_exist": "Choose a project lead from the team."}
    )
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    description = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=PROJECT_DESCRIPTION_MAX
    )

    def validate_name(self, value):
        value = _clean(value)
        if not value:
            raise serializers.ValidationError("Enter a project name.")
        return value

    def validate_department(self, value):
        return _clean(value) or DEFAULT_DEPARTMENT

    def validate_description(self, value):
        return value.strip()

    def validate(self, attrs):
        if attrs["end_date"] <= attrs["start_date"]:
            raise serializers.ValidationError({"end_date": DEADLINE_MESSAGE})
        return attrs


class ProjectUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    department = serializers.CharField(max_length=120, required=False)
    description = serializers.CharField(required=False, allow_blank=True, max_length=PROJECT_DESCRIPTION_MAX)
    phase = serializers.ChoiceField(choices=Phase.choices, required=False)
    lead_id = serializers.PrimaryKeyRelatedField(queryset=Member.objects.all(), source="lead", required=False)
    start_date = serializers.DateField(required=False)
    end_date = serializers.DateField(required=False)
    progress = serializers.IntegerField(
        required=False,
        min_value=0,
        max_value=100,
        error_messages={"min_value": "Progress must be between 0 and 100.", "max_value": "Progress must be between 0 and 100."},
    )
    decision = serializers.CharField(required=False, allow_blank=True, max_length=PROJECT_DECISION_MAX)

    def validate_name(self, value):
        value = _clean(value)
        if not value:
            raise serializers.ValidationError("Enter a project name.")
        return value

    def validate_department(self, value):
        return _clean(value) or DEFAULT_DEPARTMENT

    def validate_description(self, value):
        return value.strip()

    def validate_decision(self, value):
        return value.strip()

    def validate(self, attrs):
        start = attrs.get("start_date", self.instance.start_date)
        end = attrs.get("end_date", self.instance.end_date)
        if end <= start:
            raise serializers.ValidationError({"end_date": DEADLINE_MESSAGE})
        return attrs


class DecisionSerializer(serializers.Serializer):
    decision = serializers.CharField(allow_blank=True, max_length=PROJECT_DECISION_MAX)

    def validate_decision(self, value):
        return value.strip()


class DecisionUndoSerializer(serializers.Serializer):
    # Optional: a missing id keeps the old behaviour (404 "nothing to undo"); a malformed one is a 400.
    activity_id = serializers.IntegerField(required=False, min_value=1, max_value=ID_MAX)


class MembershipCreateSerializer(serializers.Serializer):
    member_id = serializers.PrimaryKeyRelatedField(
        queryset=Member.objects.all(), source="member", error_messages={"does_not_exist": "That person is not on the team."}
    )
    role = serializers.CharField(max_length=120, required=False, allow_blank=True, default=DEFAULT_ROLE)

    def validate_role(self, value):
        return _clean(value) or DEFAULT_ROLE


class ObjectiveSerializer(serializers.Serializer):
    description = serializers.CharField(
        max_length=500, error_messages={"blank": "Enter an objective.", "required": "Enter an objective."}
    )

    def validate_description(self, value):
        value = _clean(value)
        if not value:
            raise serializers.ValidationError("Enter an objective.")
        return value


def project_payload(project: Project, on=None, detail: bool = False) -> dict:
    """Output shape. Expects lead, memberships(member) prefetched; detail also objectives, tasks."""
    on = on or rules.today()
    data = {
        "id": project.id,
        "name": project.name,
        "department": project.department,
        "lead": project.lead_id,
        "lead_name": project.lead.name,
        "phase": project.phase,
        "description": project.description,
        "start_date": project.start_date.isoformat(),
        "end_date": project.end_date.isoformat(),
        "start_offset": rules.start_offset(project, on),
        "end_offset": rules.end_offset(project, on),
        "progress": project.progress,
        "decision": project.decision,
        "time_used": rules.time_used(project, on),
        "health": rules.health(project, on),
        "member_count": len(project.memberships.all()),
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }
    if detail:
        open_tasks = sorted(
            (t for t in project.tasks.all() if t.state != "done"), key=lambda t: (t.due_date, t.id)
        )
        data["objectives"] = [
            {"id": o.id, "description": o.description} for o in project.objectives.all()
        ]
        data["members"] = [
            {"id": m.id, "member_id": m.member_id, "name": m.member.name, "role": m.role}
            for m in project.memberships.all()
        ]
        data["open_tasks"] = [
            {
                "id": t.id,
                "title": t.title,
                "owner": t.owner_id,
                "owner_name": t.owner.name,
                "due_date": t.due_date.isoformat(),
                "due_offset": task_rules.due_offset(t, on),
                "state": t.state,
                "priority": t.priority,
            }
            for t in open_tasks
        ]
    return data


def with_related(queryset, detail: bool = False):
    queryset = queryset.select_related("lead").prefetch_related("memberships__member")
    if detail:
        queryset = queryset.prefetch_related("objectives", "tasks__owner")
    return queryset
