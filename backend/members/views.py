from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from activity.services import log
from config.exceptions import Conflict
from config.params import parse_id
from projects.models import Project, ProjectMember
from projects.rules import today as today_fn

from .models import Member
from .serializers import MemberWriteSerializer, member_payload, with_stats


def get_member(pk) -> Member:
    try:
        return with_stats(Member.objects.all()).get(pk=pk)
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
        on = today_fn()
        rows = [member_payload(m, on) for m in with_stats(qs)]

        show = params.get("show", "all")
        if show == "stretched":
            rows = [r for r in rows if r["stretched"]]
        elif show == "overdue":
            rows = [r for r in rows if r["overdue_tasks"] > 0]
        elif show == "blocked":
            rows = [r for r in rows if r["blocked_tasks"] > 0]

        sort = params.get("sort", "stretched")
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
        member = get_member(pk)
        ser = MemberWriteSerializer(member, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        changes = []
        for field in ("name", "title", "department", "load"):
            if field in ser.validated_data and ser.validated_data[field] != getattr(member, field):
                changes.append(f"{field} {getattr(member, field)} -> {ser.validated_data[field]}")
                setattr(member, field, ser.validated_data[field])
        if changes:
            member.save()
            log("member.updated", "member", member.id, f"You updated {member.name}: {', '.join(changes)}")
        return Response(member_payload(get_member(pk)))

    @transaction.atomic
    def delete(self, request, pk):
        member = get_member(pk)
        led = Project.objects.filter(lead=member).count()
        owned = member.tasks.count()
        if led or owned:
            parts = []
            if led:
                parts.append(f"leads {led} project{'' if led == 1 else 's'}")
            if owned:
                parts.append(f"owns {owned} task{'' if owned == 1 else 's'}")
            raise Conflict(f"{member.name} {' and '.join(parts)}. Reassign them before removing this person.")
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
