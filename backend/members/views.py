from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from activity.services import log
from common.exceptions import Conflict
from common.params import parse_id
from projects.models import Project, ProjectMember
from projects.rules import today as today_fn

from .models import Member
from .serializers import MemberWriteSerializer, member_payload, with_stats


SHOW_VALUES = ("all", "stretched", "overdue", "blocked")
SORT_VALUES = ("stretched", "name", "tasks")


def get_member(pk, lock=False) -> Member:
    qs = with_stats(Member.objects.all())
    if lock:
        qs = qs.select_for_update()  # no-op on SQLite
    try:
        return qs.get(pk=pk)
    except Member.DoesNotExist:
        raise NotFound("Member not found.")


class MemberListView(APIView):
    def get(self, request):
        params = request.query_params
        qs = Member.objects.all()
        if q := params.get("q", "").strip():
            qs = qs.filter(
                Q(name__icontains=q)
                | Q(title__icontains=q)
                | Q(department__icontains=q)
                | Q(memberships__project__name__icontains=q)
            ).distinct()
        if project := params.get("project"):
            qs = qs.filter(memberships__project_id=parse_id(project, "project"))
        show = params.get("show", "all")
        if show not in SHOW_VALUES:
            raise ValidationError({"show": "show must be all, stretched, overdue or blocked."})
        sort = params.get("sort", "stretched")
        if sort not in SORT_VALUES:
            raise ValidationError({"sort": "sort must be stretched, name or tasks."})
        on = today_fn()
        rows = [member_payload(m, on) for m in with_stats(qs)]

        if show == "stretched":
            rows = [r for r in rows if r["stretched"]]
        elif show == "overdue":
            rows = [r for r in rows if r["overdue_tasks"] > 0]
        elif show == "blocked":
            rows = [r for r in rows if r["blocked_tasks"] > 0]

        if sort == "name":
            rows.sort(key=lambda r: r["name"].lower())
        elif sort == "tasks":
            rows.sort(key=lambda r: (-r["open_tasks"], -r["load"]))
        else:
            rows.sort(key=lambda r: -r["load"])
        return Response({"results": rows, "count": len(rows)})

    @transaction.atomic
    def post(self, request):
        ser = MemberWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        member = Member.objects.create(
            name=data["name"],
            title=data["title"],
            department=data["department"],
            **({"load": data["load"]} if "load" in data else {}),
        )
        log(
            "member.created",
            "member",
            member.id,
            f"You added {member.name} ({member.title}, {member.department}) to the team",
        )
        for item in data.get("memberships", []):
            ProjectMember.objects.create(project=item["project"], member=member, role=item["role"])
            log(
                "membership.added",
                "project",
                item["project"].id,
                f"You added {member.name} to the team as {item['role']}",
                project=item["project"],
            )
        return Response(member_payload(get_member(member.pk)), status=201)


class MemberDetailView(APIView):
    def get(self, request, pk):
        return Response(member_payload(get_member(pk)))

    @transaction.atomic
    def patch(self, request, pk):
        member = get_member(pk, lock=True)
        ser = MemberWriteSerializer(member, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        changes = []
        changed_fields = []
        for field in ("name", "title", "department", "load"):
            if field in ser.validated_data and ser.validated_data[field] != getattr(member, field):
                changes.append(f"{field} {getattr(member, field)} -> {ser.validated_data[field]}")
                setattr(member, field, ser.validated_data[field])
                changed_fields.append(field)
        if changes:
            member.save(update_fields=[*changed_fields, "updated_at"])
            log("member.updated", "member", member.id, f"You updated {member.name}: {', '.join(changes)}")
        return Response(member_payload(get_member(pk)))

    @transaction.atomic
    def delete(self, request, pk):
        member = get_member(pk)
        led = Project.objects.filter(lead=member).count()
        owned = member.tasks.count()
        updates = member.daily_updates.count()
        if led or owned or updates:
            parts = []
            if led:
                parts.append(f"leads {led} project{'' if led == 1 else 's'}")
            if owned:
                parts.append(f"owns {owned} task{'' if owned == 1 else 's'}")
            if updates:
                parts.append(f"has shared {updates} daily update{'' if updates == 1 else 's'}")
            raise Conflict(f"{member.name} {' and '.join(parts)}. Reassign their work before removing this person.")
        name, member_id = member.name, member.id
        member.delete()
        log("member.deleted", "member", member_id, f"You removed {name} from the team")
        return Response(status=204)


class DepartmentListView(APIView):
    def get(self, request):
        names = set(Member.objects.values_list("department", flat=True))
        names |= set(Project.objects.values_list("department", flat=True))
        names.discard("")
        ordered = sorted(names, key=str.lower)
        return Response({"results": ordered, "count": len(ordered)})
