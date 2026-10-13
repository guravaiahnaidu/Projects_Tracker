from datetime import date, timedelta

from activity.models import ActivityLog
from config.testing import ApiTestCase, day
from projects import rules
from projects.models import Project, ProjectMember


class ProjectRulesTests(ApiTestCase):
    """Pure derived-value rules, pinned to a fixed date."""

    ON = date(2026, 1, 1)

    def p(self, start, end, progress):
        return Project(
            start_date=self.ON + timedelta(days=start),
            end_date=self.ON + timedelta(days=end),
            progress=progress,
        )

    def test_time_used_clamps_and_rounds(self):
        self.assertEqual(rules.time_used(self.p(-30, 70, 0), self.ON), 30)
        self.assertEqual(rules.time_used(self.p(10, 50, 0), self.ON), 0)  # not started: clamped up
        self.assertEqual(rules.time_used(self.p(-100, -10, 0), self.ON), 100)  # finished: clamped down
        self.assertEqual(rules.time_used(self.p(-1, 7, 0), self.ON), 13)  # 12.5 rounds up, like JS

    def test_health_thresholds(self):
        # half of the schedule used, so gap = 50 - progress
        cases = {50: "on-track", 47: "on-track", 46: "watch", 35: "watch", 34: "off-track"}
        for progress, expected in cases.items():
            self.assertEqual(rules.health(self.p(-50, 50, progress), self.ON), expected, progress)

    def test_health_not_started_only_when_no_time_and_no_progress(self):
        self.assertEqual(rules.health(self.p(10, 50, 0), self.ON), "not-started")
        self.assertEqual(rules.health(self.p(10, 50, 5), self.ON), "on-track")
        self.assertEqual(rules.health(self.p(-10, 50, 0), self.ON), "off-track")  # 17% used, 0% done


class ProjectApiTests(ApiTestCase):
    def valid(self, lead, **extra):
        return {
            "name": "New Thing",
            "lead_id": lead.id,
            "start_date": day(-5).isoformat(),
            "end_date": day(30).isoformat(),
            **extra,
        }

    def test_create_applies_defaults_membership_and_log(self):
        lead = self.member()
        res = self.post("/projects/", self.valid(lead))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["phase"], "In Progress")
        self.assertEqual(res.data["department"], "General")
        self.assertEqual(res.data["progress"], 0)
        self.assertEqual(res.data["members"][0]["role"], "Project Lead")
        self.assertEqual(res.data["objectives"], [])
        self.assertEqual(res.data["start_offset"], -5)
        self.assertTrue(ActivityLog.objects.filter(description="You created New Thing").exists())

    def test_future_start_means_not_started(self):
        lead = self.member()
        res = self.post("/projects/", self.valid(lead, start_date=day(3).isoformat()))
        self.assertEqual(res.data["phase"], "Not Started")

    def test_create_validation(self):
        lead = self.member()
        res = self.post("/projects/", self.valid(lead, end_date=day(-5).isoformat()))
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["message"], "The deadline must be after the start date.")
        self.assertEqual(self.post("/projects/", {}).status_code, 400)
        self.assertEqual(self.post("/projects/", self.valid(lead, lead_id=9999)).status_code, 400)
        self.assertEqual(self.post("/projects/", self.valid(lead, name="  ")).status_code, 400)
        self.assertEqual(Project.objects.count(), 0)

    def test_list_filters_and_sorts(self):
        off = self.project(name="Off", start=-50, end=10, progress=10)
        ok = self.project(name="Ok", start=-50, end=40, progress=50)
        idle = self.project(name="Idle", start=5, end=60, progress=0)
        names = lambda **p: [r["name"] for r in self.get("/projects/", **p).data["results"]]
        self.assertEqual(names(), ["Off", "Ok", "Idle"])
        self.assertEqual(names(health="off-track"), ["Off"])
        self.assertEqual(names(health="not-started"), ["Idle"])
        self.assertEqual(names(sort="deadline"), ["Off", "Ok", "Idle"])
        self.assertEqual(names(sort="progress"), ["Ok", "Off", "Idle"])
        self.assertEqual(names(sort="name"), ["Idle", "Off", "Ok"])
        self.assertEqual(self.get("/projects/", health="bogus").status_code, 400)
        self.assertEqual(self.get("/projects/", sort="bogus").status_code, 400)
        self.assertEqual(self.get("/projects/").data["results"][0]["health"], "off-track")

    def test_detail_and_404(self):
        project = self.project()
        self.task(project=project, due=2)
        self.task(project=project, due=3, state="done")
        res = self.get(f"/projects/{project.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["open_tasks"]), 1)
        self.assertEqual(self.get("/projects/9999/").status_code, 404)

    def test_patch_fields_logs_and_validation(self):
        project = self.project(name="P", start=-10, end=10)
        path = f"/projects/{project.id}/"
        res = self.patch(path, {"phase": "At Risk", "progress": 40, "end_date": day(20).isoformat()})
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data["phase"], res.data["progress"]), ("At Risk", 40))
        texts = set(project.activity.values_list("description", flat=True))
        self.assertIn("You changed P from In Progress to At Risk", texts)
        self.assertIn("You updated progress from 0% to 40%", texts)
        self.assertTrue(any(t.startswith("You moved the deadline to") for t in texts))
        self.assertEqual(self.patch(path, {"progress": 101}).status_code, 400)
        self.assertEqual(self.patch(path, {"progress": -1}).status_code, 400)
        self.assertEqual(self.patch(path, {"phase": "Nope"}).status_code, 400)
        self.assertEqual(self.patch(path, {"end_date": project.start_date.isoformat()}).status_code, 400)
        self.assertEqual(self.patch(path, {"start_date": day(30).isoformat()}).status_code, 400)
        self.assertEqual(self.patch(path, {"progress": 40}).status_code, 200)  # no change, no new log

    def test_patch_without_change_logs_nothing(self):
        project = self.project()
        before = ActivityLog.objects.count()
        self.patch(f"/projects/{project.id}/", {"phase": project.phase})
        self.assertEqual(ActivityLog.objects.count(), before)

    def test_lead_change_reroles_members(self):
        project = self.project(name="P")
        old = project.lead
        new = self.member(name="New Lead")
        res = self.patch(f"/projects/{project.id}/", {"lead_id": new.id})
        self.assertEqual(res.status_code, 200)
        roles = {m["name"]: m["role"] for m in res.data["members"]}
        self.assertEqual(roles, {old.name: "Team Member", "New Lead": "Project Lead"})
        # existing member promoted: no duplicate row
        third = self.member(name="Third")
        self.post(f"/projects/{project.id}/members/", {"member_id": third.id, "role": "QA"})
        res = self.patch(f"/projects/{project.id}/", {"lead_id": third.id})
        self.assertEqual(ProjectMember.objects.filter(project=project, member=third).count(), 1)
        self.assertEqual({m["name"]: m["role"] for m in res.data["members"]}["Third"], "Project Lead")
        self.assertEqual(ProjectMember.objects.filter(project=project, role="Project Lead").count(), 1)
        self.assertIn(
            f"You changed the project lead from New Lead to Third",
            project.activity.values_list("description", flat=True),
        )

    def test_members_add_remove_rules(self):
        project = self.project()
        person = self.member(name="Pat")
        base = f"/projects/{project.id}/members/"
        res = self.post(base, {"member_id": person.id})
        self.assertEqual(res.status_code, 201)
        self.assertEqual([m for m in res.data["members"] if m["name"] == "Pat"][0]["role"], "Team Member")
        dup = self.post(base, {"member_id": person.id})
        self.assertEqual(dup.status_code, 400)
        self.assertEqual(self.post(base, {"member_id": 9999}).status_code, 400)
        self.assertEqual(self.get(base).data["count"], 2)
        # the lead cannot be removed
        res = self.delete(f"{base}{project.lead_id}/")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(self.delete(f"{base}{person.id}/").status_code, 204)
        self.assertEqual(self.delete(f"{base}{person.id}/").status_code, 404)
        texts = set(project.activity.values_list("description", flat=True))
        self.assertIn("You added Pat to the team", texts)
        self.assertIn("You removed Pat from the team", texts)

    def test_removing_member_keeps_their_tasks(self):
        project = self.project()
        person = self.member(name="Pat")
        self.post(f"/projects/{project.id}/members/", {"member_id": person.id})
        t = self.task(project=project, owner=person)
        self.delete(f"/projects/{project.id}/members/{person.id}/")
        t.refresh_from_db()
        self.assertEqual(t.owner_id, person.id)

    def test_objectives_crud(self):
        project = self.project()
        base = f"/projects/{project.id}/objectives/"
        res = self.post(base, {"description": "  Ship   it "})
        self.assertEqual(res.status_code, 201)
        obj = res.data["objectives"][0]
        self.assertEqual(obj["description"], "Ship it")
        self.assertEqual(self.post(base, {"description": "  "}).status_code, 400)
        res = self.patch(f"{base}{obj['id']}/", {"description": "Ship it fast"})
        self.assertEqual(res.data["objectives"][0]["description"], "Ship it fast")
        self.assertEqual(self.patch(f"{base}{obj['id']}/", {"description": ""}).status_code, 400)
        self.assertEqual(self.patch(f"{base}9999/", {"description": "x"}).status_code, 404)
        self.assertEqual(self.delete(f"{base}{obj['id']}/").status_code, 204)
        self.assertEqual(self.get(f"/projects/{project.id}/").data["objectives"], [])

    def test_decision_set_clear_resolve_undo(self):
        project = self.project(name="P")
        base = f"/projects/{project.id}/decision/"
        res = self.patch(base, {"decision": " Approve it "})
        self.assertEqual(res.data["decision"], "Approve it")
        res = self.post(f"{base}resolve/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["project"]["decision"], "")
        activity_id = res.data["activity_id"]
        self.assertEqual(self.post(f"{base}resolve/").status_code, 400)  # nothing pending now
        undo = self.post(f"{base}undo/", {"activity_id": activity_id})
        self.assertEqual(undo.data["project"]["decision"], "Approve it")
        self.assertFalse(ActivityLog.objects.filter(pk=activity_id).exists())
        # undo is a one-shot
        self.assertEqual(self.post(f"{base}undo/", {"activity_id": activity_id}).status_code, 404)
        # clearing via PATCH
        self.assertEqual(self.patch(base, {"decision": ""}).data["decision"], "")
        self.assertTrue(project.activity.filter(action="decision.cleared").exists())

    def test_undo_refused_when_new_decision_entered(self):
        project = self.project()
        base = f"/projects/{project.id}/decision/"
        self.patch(base, {"decision": "A"})
        activity_id = self.post(f"{base}resolve/").data["activity_id"]
        self.patch(base, {"decision": "B"})
        self.assertEqual(self.post(f"{base}undo/", {"activity_id": activity_id}).status_code, 409)

    def test_history_and_tasks_endpoints(self):
        project = self.project()
        other = self.project(name="Other")
        self.task(project=project, title="Mine")
        self.task(project=other, title="Not mine")
        self.patch(f"/projects/{project.id}/", {"progress": 5})
        hist = self.get(f"/projects/{project.id}/history/")
        self.assertEqual(hist.status_code, 200)
        self.assertEqual(hist.data["results"][0]["description"], "You updated progress from 0% to 5%")
        titles = [t["title"] for t in self.get(f"/projects/{project.id}/tasks/").data["results"]]
        self.assertEqual(titles, ["Mine"])
        self.assertEqual(self.get("/projects/9999/history/").status_code, 404)
        self.assertEqual(self.get("/projects/9999/tasks/").status_code, 404)

    def test_delete_project_rules(self):
        project = self.project(name="Gone")
        obj_path = f"/projects/{project.id}/objectives/"
        self.post(obj_path, {"description": "x"})
        t = self.task(project=project)
        res = self.delete(f"/projects/{project.id}/")
        self.assertEqual(res.status_code, 409)
        self.assertTrue(Project.objects.filter(pk=project.id).exists())
        t.delete()
        self.assertEqual(self.delete(f"/projects/{project.id}/").status_code, 204)
        self.assertFalse(Project.objects.filter(pk=project.id).exists())
        self.assertFalse(ProjectMember.objects.filter(project_id=project.id).exists())
        # history is preserved in the global feed
        self.assertTrue(ActivityLog.objects.filter(description="You deleted the project Gone").exists())
        self.assertEqual(self.delete(f"/projects/{project.id}/").status_code, 404)

    def test_persistence_across_requests(self):
        lead = self.member()
        pid = self.post("/projects/", self.valid(lead)).data["id"]
        self.patch(f"/projects/{pid}/", {"progress": 33})
        self.client.cookies.clear()
        self.assertEqual(self.get(f"/projects/{pid}/").data["progress"], 33)
        self.assertEqual(Project.objects.get(pk=pid).progress, 33)
