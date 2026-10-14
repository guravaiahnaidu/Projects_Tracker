from datetime import date, timedelta

from activity.models import ActivityLog
from tests.support import ApiTestCase, day
from tasks import rules
from tasks.models import Task

NOTE_MESSAGE = "Say what the task is waiting on, so others can help unblock it."


class TaskRulesTests(ApiTestCase):
    ON = date(2026, 1, 1)

    def t(self, offset, state="in-progress"):
        return Task(due_date=self.ON + timedelta(days=offset), state=state)

    def test_group_boundaries(self):
        expected = {-1: "overdue", 0: "today", 1: "next2", 2: "next2", 3: "week", 7: "week", 8: "later"}
        for offset, group in expected.items():
            self.assertEqual(rules.group(self.t(offset), self.ON), group, offset)

    def test_done_and_blocked_override_dates(self):
        self.assertEqual(rules.group(self.t(-5, "done"), self.ON), "done")
        self.assertEqual(rules.group(self.t(-5, "blocked"), self.ON), "blocked")
        self.assertEqual(rules.bucket(self.t(-5, "blocked"), self.ON), "blocked")

    def test_bucket_workload_and_labels(self):
        self.assertEqual(rules.bucket(self.t(0), self.ON), "today")
        self.assertEqual(rules.bucket(self.t(5), self.ON), "upcoming")
        self.assertEqual(rules.workload_kind(self.t(7), self.ON), "soon")
        self.assertEqual(rules.workload_kind(self.t(8), self.ON), "later")
        self.assertEqual(rules.due_label(self.t(-1), self.ON), "1 day overdue")
        self.assertEqual(rules.due_label(self.t(-3), self.ON), "3 days overdue")
        self.assertEqual(rules.due_label(self.t(0), self.ON), "Due today")
        self.assertEqual(rules.due_label(self.t(1), self.ON), "Due tomorrow")
        self.assertEqual(rules.due_label(self.t(4), self.ON), "Due in 4 days")


class TaskApiTests(ApiTestCase):
    def valid(self, project, **extra):
        return {
            "title": "Write tests",
            "project_id": project.id,
            "owner_id": project.lead_id,
            "due_date": day(2).isoformat(),
            **extra,
        }

    def test_create_defaults_and_log(self):
        project = self.project()
        res = self.post("/tasks/", self.valid(project, title="  Write   tests "))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["title"], "Write tests")
        self.assertEqual((res.data["state"], res.data["priority"]), ("not-started", "Medium"))
        self.assertEqual(res.data["group"], "next2")
        self.assertEqual(res.data["project_name"], project.name)
        self.assertTrue(project.activity.filter(description="You added “Write tests”").exists())

    def test_create_validation(self):
        project = self.project()
        res = self.post("/tasks/", {})
        self.assertEqual(res.status_code, 400)
        fields = res.data["error"]["fields"]
        self.assertEqual(fields["title"], ["Give the task a name."])
        self.assertEqual(fields["due_date"], ["Pick a due date."])
        for key, value in [("project_id", 9999), ("owner_id", 9999), ("priority", "Urgent"), ("state", "wat")]:
            self.assertEqual(self.post("/tasks/", self.valid(project, **{key: value})).status_code, 400, key)
        self.assertEqual(self.post("/tasks/", self.valid(project, due_date="soon")).status_code, 400)
        self.assertEqual(Task.objects.count(), 0)

    def test_blocked_requires_note_on_create(self):
        project = self.project()
        res = self.post("/tasks/", self.valid(project, state="blocked"))
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["note"], [NOTE_MESSAGE])
        self.assertEqual(self.post("/tasks/", self.valid(project, state="blocked", note="   ")).status_code, 400)
        ok = self.post("/tasks/", self.valid(project, state="blocked", note="waiting on vendor"))
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(ok.data["group"], "blocked")

    def test_blocked_requires_note_on_update_including_inline_status_change(self):
        t = self.task()
        path = f"/tasks/{t.id}/"
        res = self.patch(path, {"state": "blocked"})  # what the inline status select sends
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["note"], [NOTE_MESSAGE])
        t.refresh_from_db()
        self.assertEqual(t.state, "not-started")
        self.assertEqual(self.patch(path, {"state": "blocked", "note": "stuck"}).status_code, 200)
        # once blocked, the note cannot be erased while still blocked
        self.assertEqual(self.patch(path, {"note": ""}).status_code, 400)
        # but unblocking and clearing together is fine
        res = self.patch(path, {"state": "in-progress", "note": ""})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["note"], "")

    def test_existing_note_satisfies_blocked_rule(self):
        t = self.task(note="old context")
        self.assertEqual(self.patch(f"/tasks/{t.id}/", {"state": "blocked"}).status_code, 200)

    def test_patch_fields_and_change_log(self):
        project = self.project()
        t = self.task(project=project, title="Old")
        other = self.member(name="Other")
        res = self.patch(
            f"/tasks/{t.id}/",
            {"title": "New", "owner_id": other.id, "priority": "High", "state": "in-progress", "due_date": day(9).isoformat(), "note": "n"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["group"], "later")
        text = project.activity.get(action="task.updated").description
        self.assertTrue(text.startswith("You updated “Old”: renamed to “New”, owner "), text)
        for fragment in ("priority Medium -> High", "status Not Started -> In Progress", "note updated"):
            self.assertIn(fragment, text)

    def test_patch_validation_and_immutable_project(self):
        t = self.task()
        path = f"/tasks/{t.id}/"
        self.assertEqual(self.patch(path, {"title": "  "}).status_code, 400)
        self.assertEqual(self.patch(path, {"due_date": "nope"}).status_code, 400)
        self.assertEqual(self.patch(path, {"owner_id": 9999}).status_code, 400)
        self.assertEqual(self.patch(path, {"priority": "x"}).status_code, 400)
        other = self.project(name="Other project")
        res = self.patch(path, {"project_id": other.id})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.patch(path, {"project_id": t.project_id}).status_code, 200)
        self.assertEqual(self.patch("/tasks/9999/", {"title": "x"}).status_code, 404)

    def test_no_change_logs_nothing(self):
        t = self.task()
        before = ActivityLog.objects.count()
        self.patch(f"/tasks/{t.id}/", {"title": t.title, "state": t.state})
        self.assertEqual(ActivityLog.objects.count(), before)

    def test_complete_is_idempotent_and_logged_once(self):
        t = self.task(title="Finish me")
        path = f"/tasks/{t.id}/complete/"
        self.assertEqual(self.post(path).data["state"], "done")
        self.assertEqual(self.post(path).status_code, 200)
        self.assertEqual(ActivityLog.objects.filter(description="You marked “Finish me” as Done").count(), 1)
        self.assertEqual(self.post("/tasks/9999/complete/").status_code, 404)

    def test_complete_a_blocked_task(self):
        t = self.task(state="blocked", note="stuck")
        res = self.post(f"/tasks/{t.id}/complete/")
        self.assertEqual(res.data["state"], "done")

    def test_retrieve_and_delete(self):
        t = self.task(title="Bye")
        self.assertEqual(self.get(f"/tasks/{t.id}/").data["title"], "Bye")
        self.assertEqual(self.delete(f"/tasks/{t.id}/").status_code, 204)
        self.assertEqual(self.get(f"/tasks/{t.id}/").status_code, 404)
        self.assertEqual(self.delete(f"/tasks/{t.id}/").status_code, 404)
        self.assertTrue(ActivityLog.objects.filter(description="You deleted “Bye”").exists())

    def seed(self):
        a = self.project(name="Alpha")
        b = self.project(name="Beta")
        pat = self.member(name="Pat")
        lee = self.member(name="Lee")
        self.task(a, pat, "overdue one", due=-3, priority="High")
        self.task(a, lee, "today one", due=0)
        self.task(b, pat, "tomorrow", due=1, state="in-progress")
        self.task(b, lee, "this week", due=5, priority="Low")
        self.task(a, pat, "far away", due=30)
        self.task(b, lee, "stuck", due=2, state="blocked", note="vendor")
        self.task(a, pat, "finished", due=-9, state="done")
        return a, b, pat, lee

    def titles(self, **params):
        return [t["title"] for t in self.get("/tasks/", **params).data["results"]]

    def test_default_lists_open_tasks_by_due_date(self):
        self.seed()
        self.assertEqual(
            self.titles(), ["overdue one", "today one", "tomorrow", "stuck", "this week", "far away"]
        )

    def test_status_filter(self):
        self.seed()
        self.assertEqual(len(self.titles(status="all")), 7)
        self.assertEqual(self.titles(status="done"), ["finished"])
        self.assertEqual(self.titles(status="blocked"), ["stuck"])
        self.assertEqual(self.titles(status="in-progress"), ["tomorrow"])
        self.assertEqual(self.get("/tasks/", status="bogus").status_code, 400)

    def test_group_filter_uses_real_dates(self):
        self.seed()
        self.assertEqual(self.titles(group="overdue"), ["overdue one"])
        self.assertEqual(self.titles(group="today"), ["today one"])
        self.assertEqual(self.titles(group="next2", status="all"), ["tomorrow"])
        self.assertEqual(self.titles(group="week"), ["this week"])
        self.assertEqual(self.titles(group="later"), ["far away"])
        self.assertEqual(self.titles(group="blocked"), ["stuck"])
        self.assertEqual(self.titles(group="done", status="all"), ["finished"])
        self.assertEqual(self.get("/tasks/", group="bogus").status_code, 400)

    def test_counts_cover_all_tasks_ignoring_filters(self):
        self.seed()
        counts = self.get("/tasks/", q="zzz-no-match").data["counts"]
        self.assertEqual(counts, {"overdue": 1, "today": 1, "next2": 1, "week": 1, "later": 1, "blocked": 1, "done": 1})

    def test_search_project_owner_priority_and_dates(self):
        a, b, pat, lee = self.seed()
        self.assertEqual(self.titles(q="TODAY"), ["today one"])
        self.assertEqual(self.titles(q="lee", status="all"), ["today one", "stuck", "this week"])
        self.assertEqual(self.titles(q="beta"), ["tomorrow", "stuck", "this week"])
        self.assertEqual(self.titles(project=b.id), ["tomorrow", "stuck", "this week"])
        self.assertEqual(self.titles(owner=lee.id), ["today one", "stuck", "this week"])
        self.assertEqual(self.titles(priority="High"), ["overdue one"])
        self.assertEqual(self.titles(due_from=day(0).isoformat(), due_to=day(1).isoformat()), ["today one", "tomorrow"])
        self.assertEqual(self.get("/tasks/", due_from="x").status_code, 400)
        self.assertEqual(self.get("/tasks/", project="abc").status_code, 400)

    def test_month_filter(self):
        project = self.project()
        t = self.task(project=project, due=0)
        month = t.due_date.strftime("%Y-%m")
        self.assertEqual(self.titles(month=month), [t.title])
        self.assertEqual(self.titles(month="1999-01"), [])
        self.assertEqual(self.get("/tasks/", month="2026").status_code, 400)

    def test_persistence_across_requests(self):
        project = self.project()
        tid = self.post("/tasks/", self.valid(project)).data["id"]
        self.patch(f"/tasks/{tid}/", {"priority": "Low"})
        self.assertEqual(self.get(f"/tasks/{tid}/").data["priority"], "Low")
        self.assertEqual(Task.objects.get(pk=tid).priority, "Low")

    def test_priority_filter_is_validated(self):
        # Regression: priority=bogus used to return 200 with an empty list instead of a 400.
        project = self.project()
        self.task(project=project, title="hi", priority="High")
        self.assertEqual(self.get("/tasks/", priority="High").data["count"], 1)
        self.assertEqual(self.get("/tasks/", priority="Low").data["count"], 0)
        res = self.get("/tasks/", priority="bogus")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["message"], "priority must be High, Medium or Low.")
        self.assertEqual(self.get(f"/projects/{project.id}/tasks/", priority="bogus").status_code, 400)
