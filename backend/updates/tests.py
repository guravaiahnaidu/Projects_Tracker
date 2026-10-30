from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework_simplejwt.tokens import AccessToken

from activity.models import ActivityLog
from tests.support import API, ApiTestCase, day
from updates.models import DailyUpdate, Feedback


class FeedbackEditDeleteTests(ApiTestCase):
    """Editing and deleting one feedback entry: managers and admins only (always enforced), scoped to its update."""

    def setUp(self):
        self.manager = get_user_model().objects.create_user("mgr", password="x-Pass-12345", is_staff=True)
        self.sign_in(self.manager)
        project, person = self.project(name="Portal"), self.member(name="Dev One")
        self.uid = self.post(
            "/daily-updates/", {"employee_id": person.id, "project_id": project.id, "date": day(0).isoformat(), "completed": ["Built it"]}
        ).data["id"]
        self.first = self.give("Suggestion", "Add tests")
        self.second = self.give("Appreciation", "Great work")

    def sign_in(self, user):
        self.client.credentials(**({"HTTP_AUTHORIZATION": f"Bearer {AccessToken.for_user(user)}"} if user else {}))

    def give(self, type_, content):
        return self.post(f"/daily-updates/{self.uid}/feedback/", {"type": type_, "content": content}).data["feedback"][-1]

    def url(self, fid, uid=None):
        return f"/daily-updates/{uid or self.uid}/feedback/{fid}/"

    def test_edit_changes_only_that_entry_and_keeps_author_and_time(self):
        res = self.patch(self.url(self.first["id"]), {"type": "Next steps", "content": "  Add more tests  ", "manager_name": "Impostor"})
        self.assertEqual(res.status_code, 200, res.data)
        edited, other = res.data["feedback"]
        self.assertEqual((edited["id"], edited["type"], edited["content"]), (self.first["id"], "Next steps", "Add more tests"))
        self.assertEqual((edited["manager_name"], edited["created_at"]), (self.first["manager_name"], self.first["created_at"]))
        self.assertEqual(other, self.second)
        self.assertEqual(Feedback.objects.count(), 2)  # updated in place, no duplicate
        self.assertTrue(ActivityLog.objects.filter(action="update.feedback_edited").exists())

    def test_edit_validation(self):
        for bad in ({"content": "   "}, {"type": "Praise"}, {"content": "x" * 2001}):
            self.assertEqual(self.patch(self.url(self.first["id"]), bad).status_code, 400, bad)
        self.assertEqual(Feedback.objects.get(pk=self.first["id"]).content, "Add tests")

    def test_delete_removes_only_that_entry(self):
        res = self.delete(self.url(self.first["id"]))
        self.assertEqual(res.status_code, 200)
        self.assertEqual([f["id"] for f in res.data["feedback"]], [self.second["id"]])
        self.assertEqual(res.data["review_status"], "feedback")
        self.assertEqual(res.data["completed"], ["Built it"])  # the work summary is untouched
        self.assertTrue(ActivityLog.objects.filter(action="update.feedback_deleted").exists())
        self.assertEqual(self.delete(self.url(self.first["id"])).status_code, 404)

    def test_deleting_the_last_entry_returns_update_to_reviewed(self):
        self.delete(self.url(self.first["id"]))
        res = self.delete(self.url(self.second["id"]))
        self.assertEqual((res.data["feedback"], res.data["review_status"]), ([], "reviewed"))

    def test_entry_of_another_update_is_not_found(self):
        other = self.post(
            "/daily-updates/", {"employee_id": self.member(name="Dev Two").id, "project_id": self.project(name="Other").id, "date": day(0).isoformat(), "completed": ["x"]}
        ).data["id"]
        self.assertEqual(self.patch(self.url(self.first["id"], other), {"content": "Hijack"}).status_code, 404)
        self.assertEqual(self.delete(self.url(self.first["id"], other)).status_code, 404)
        self.assertEqual(Feedback.objects.get(pk=self.first["id"]).content, "Add tests")

    def test_needs_a_manager_even_with_sign_in_switched_off(self):
        for user, code in ((None, 401), (get_user_model().objects.create_user("plain", password="x-Pass-12345"), 403)):
            self.sign_in(user)
            self.assertEqual(self.patch(self.url(self.first["id"]), {"content": "Changed"}).status_code, code)
            self.assertEqual(self.delete(self.url(self.first["id"])).status_code, code)
        self.assertEqual(Feedback.objects.count(), 2)
        admin = get_user_model().objects.create_superuser("boss", password="x-Pass-12345")
        self.sign_in(admin)
        self.assertEqual(self.delete(self.url(self.first["id"])).status_code, 200)

    @override_settings(API_REQUIRE_AUTH=True)
    def test_with_sign_in_required_anonymous_gets_401(self):
        self.sign_in(None)
        self.assertEqual(self.patch(self.url(self.first["id"]), {"content": "Changed"}).status_code, 401)


class DailyUpdateApiTests(ApiTestCase):
    def setUp(self):
        self.project_ = self.project(name="Portal")
        self.person = self.member(name="Dev One")

    def body(self, **extra):
        return {
            "employee_id": self.person.id,
            "project_id": self.project_.id,
            "date": day(0).isoformat(),
            "completed": ["Built the page", "  "],
            "in_progress": ["API integration"],
            "next_steps": ["Connect to the API"],
            "blockers": [],
            "notes": " Going well ",
            "status": "On track",
            **extra,
        }

    def create(self, **extra):
        return self.post("/daily-updates/", self.body(**extra))

    # --- create ---
    def test_create_persists_cleans_and_logs(self):
        res = self.create()
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["completed"], ["Built the page"])  # blank lines dropped
        self.assertEqual(res.data["notes"], "Going well")
        self.assertEqual(res.data["review_status"], "new")
        self.assertEqual(res.data["employee_name"], "Dev One")
        self.assertEqual(res.data["project_name"], "Portal")
        self.assertEqual(res.data["feedback"], [])
        self.assertTrue(DailyUpdate.objects.filter(pk=res.data["id"]).exists())
        self.assertTrue(ActivityLog.objects.filter(action="update.shared").exists())

    def test_status_defaults_to_on_track(self):
        body = self.body()
        del body["status"]
        self.assertEqual(self.post("/daily-updates/", body).data["status"], "On track")

    def test_create_validation(self):
        for bad in (
            {"employee_id": 9999},
            {"project_id": 9999},
            {"date": day(1).isoformat()},  # future
            {"date": "nope"},
            {"status": "Fine"},
            {"completed": "not a list"},
            {"completed": ["x" * 501]},
        ):
            self.assertEqual(self.create(**bad).status_code, 400, bad)
        empty = self.create(completed=[], in_progress=[], next_steps=[], blockers=[], notes="")
        self.assertEqual(empty.status_code, 400)
        self.assertEqual(self.post("/daily-updates/", {}).status_code, 400)
        self.assertEqual(DailyUpdate.objects.count(), 0)

    def test_one_update_per_person_project_and_day(self):
        self.assertEqual(self.create().status_code, 201)
        self.assertEqual(self.create().status_code, 409)
        self.assertEqual(DailyUpdate.objects.count(), 1)
        self.assertEqual(self.create(date=day(-1).isoformat()).status_code, 201)

    # --- read ---
    def test_list_newest_first_with_filters(self):
        other = self.project(name="Other")
        a = self.create(date=day(-2).isoformat()).data["id"]
        b = self.create(date=day(0).isoformat()).data["id"]
        c = self.post("/daily-updates/", self.body(project_id=other.id, completed=["Unique wording"]))
        ids = lambda **p: [r["id"] for r in self.get("/daily-updates/", **p).data["results"]]
        self.assertEqual(ids(), [c.data["id"], b, a])  # same day: newest share first
        self.assertEqual(self.get("/daily-updates/").data["count"], 3)
        self.assertEqual(ids(project=other.id), [c.data["id"]])
        self.assertEqual(ids(date=day(-2).isoformat()), [a])
        self.assertEqual(ids(employee=self.person.id), [c.data["id"], b, a])
        self.assertEqual(ids(q="unique WORDING"), [c.data["id"]])
        self.assertEqual(ids(q="portal"), [b, a])  # matches the project name
        self.assertEqual(ids(review="reviewed"), [])
        self.assertEqual(self.get("/daily-updates/").data["new_count"], 3)
        self.assertEqual(self.get("/daily-updates/", review="bogus").status_code, 400)
        self.assertEqual(self.get("/daily-updates/", date="x").status_code, 400)
        self.assertEqual(self.get("/daily-updates/", project="abc").status_code, 400)

    def test_empty_list(self):
        res = self.get("/daily-updates/")
        self.assertEqual((res.status_code, res.data["results"], res.data["count"]), (200, [], 0))

    def test_detail_and_404(self):
        uid = self.create().data["id"]
        self.assertEqual(self.get(f"/daily-updates/{uid}/").data["id"], uid)
        self.assertEqual(self.get("/daily-updates/9999/").status_code, 404)

    # --- update ---
    def test_mark_reviewed_only_moves_new_forward(self):
        uid = self.create().data["id"]
        res = self.patch(f"/daily-updates/{uid}/", {"review_status": "reviewed"})
        self.assertEqual(res.data["review_status"], "reviewed")
        self.post(f"/daily-updates/{uid}/feedback/", {"type": "Suggestion", "content": "Nice"})
        again = self.patch(f"/daily-updates/{uid}/", {"review_status": "reviewed"})
        self.assertEqual(again.data["review_status"], "feedback")  # never downgraded

    def test_patch_rejects_unsupported_review_values_and_ignores_identity_fields(self):
        uid = self.create().data["id"]
        self.assertEqual(self.patch(f"/daily-updates/{uid}/", {"review_status": "feedback"}).status_code, 400)
        self.assertEqual(self.patch(f"/daily-updates/{uid}/", {"review_status": "new"}).status_code, 400)
        res = self.patch(f"/daily-updates/{uid}/", {"project_id": self.project().id, "date": day(-3).isoformat()})
        self.assertEqual(res.data["date"], day(0).isoformat())
        self.assertEqual(res.data["project"], self.project_.id)

    def test_patch_edits_content_without_duplicating(self):
        uid = self.create().data["id"]
        res = self.patch(f"/daily-updates/{uid}/", {"completed": ["Changed"], "status": "Blocked", "notes": ""})
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data["completed"], res.data["status"], res.data["notes"]), (["Changed"], "Blocked", ""))
        self.assertEqual(DailyUpdate.objects.count(), 1)
        self.assertEqual(self.patch(f"/daily-updates/{uid}/", {"status": "Meh"}).status_code, 400)
        self.assertEqual(self.patch("/daily-updates/9999/", {"notes": "x"}).status_code, 404)

    def test_edit_cleans_logs_and_keeps_review_and_feedback(self):
        uid = self.create().data["id"]
        self.post(f"/daily-updates/{uid}/feedback/", {"type": "Suggestion", "content": "Nice"})
        res = self.patch(f"/daily-updates/{uid}/", {"completed": [" Built  the page ", "", "Wrote tests"], "notes": " Done "})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["completed"], ["Built the page", "Wrote tests"])
        self.assertEqual(res.data["own"]["completed"], ["Built the page", "Wrote tests"])
        self.assertEqual(res.data["notes"], "Done")
        self.assertEqual(res.data["review_status"], "feedback")
        self.assertEqual(len(res.data["feedback"]), 1)
        self.assertTrue(ActivityLog.objects.filter(action="update.edited", entity_id=uid).exists())

    def test_edit_without_changes_is_not_logged(self):
        uid = self.create().data["id"]
        self.patch(f"/daily-updates/{uid}/", {"review_status": "reviewed"})
        self.patch(f"/daily-updates/{uid}/", {"completed": ["Built the page"]})
        self.assertFalse(ActivityLog.objects.filter(action="update.edited").exists())

    def test_delete_removes_update_feedback_and_history(self):
        uid = self.create().data["id"]
        self.post(f"/daily-updates/{uid}/feedback/", {"type": "Suggestion", "content": "Nice"})
        res = self.delete(f"/daily-updates/{uid}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(DailyUpdate.objects.filter(pk=uid).exists())
        self.assertFalse(Feedback.objects.exists())
        self.assertEqual(list(ActivityLog.objects.filter(entity_type="update").values_list("action", flat=True)), ["update.deleted"])
        self.assertEqual(self.delete(f"/daily-updates/{uid}/").status_code, 404)
        # the same person, project and day can be shared again
        self.assertEqual(self.create().status_code, 201)

    def test_edit_cannot_empty_a_shared_update(self):
        uid = self.create().data["id"]
        res = self.patch(f"/daily-updates/{uid}/", {"completed": [" "], "in_progress": [], "next_steps": [], "notes": ""})
        self.assertEqual(res.status_code, 400)
        self.assertIn("completed", res.data["error"]["fields"])
        self.assertEqual(DailyUpdate.objects.get(pk=uid).completed, ["Built the page"])

    # --- feedback ---
    def test_feedback_appends_and_sets_status(self):
        uid = self.create().data["id"]
        first = self.post(f"/daily-updates/{uid}/feedback/", {"type": "Appreciation", "content": " Good work "})
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data["review_status"], "feedback")
        # The actor is never taken from the request body: a supplied manager_name is ignored.
        second = self.post(
            f"/daily-updates/{uid}/feedback/", {"type": "Next steps", "content": "Escalate early", "manager_name": "Impostor"}
        )
        fb = second.data["feedback"]
        self.assertEqual([f["content"] for f in fb], ["Good work", "Escalate early"])  # earlier entries kept, oldest first
        self.assertEqual([f["manager_name"] for f in fb], ["Manager", "Manager"])
        self.assertEqual(Feedback.objects.filter(update_id=uid).count(), 2)
        self.assertEqual(self.get("/daily-updates/", review="feedback").data["count"], 1)

    def test_feedback_validation(self):
        uid = self.create().data["id"]
        url = f"/daily-updates/{uid}/feedback/"
        self.assertEqual(self.post(url, {"type": "Suggestion", "content": "   "}).status_code, 400)
        self.assertEqual(self.post(url, {"type": "Rant", "content": "x"}).status_code, 400)
        self.assertEqual(self.post(url, {"content": "x"}).status_code, 400)
        self.assertEqual(self.post("/daily-updates/9999/feedback/", {"type": "Suggestion", "content": "x"}).status_code, 404)
        self.assertEqual(Feedback.objects.count(), 0)
        self.assertEqual(DailyUpdate.objects.get(pk=uid).review_status, "new")

    # --- unsupported methods / relations ---
    def test_unsupported_methods(self):
        uid = self.create().data["id"]
        self.assertEqual(self.delete("/daily-updates/").status_code, 405)
        self.assertEqual(self.client.put(f"{API}/daily-updates/{uid}/", {}, format="json").status_code, 405)
        self.assertEqual(self.get(f"/daily-updates/{uid}/feedback/").status_code, 405)

    def test_member_with_updates_cannot_be_deleted(self):
        self.create()
        res = self.delete(f"/members/{self.person.id}/")
        self.assertEqual(res.status_code, 409)
        self.assertIn("daily update", res.data["error"]["message"])

    def test_deleting_project_removes_its_updates(self):
        self.create()
        self.assertEqual(self.delete(f"/projects/{self.project_.id}/").status_code, 204)
        self.assertEqual(DailyUpdate.objects.count(), 0)

    # --- paging ---
    def test_list_is_paged(self):
        for n in range(5):
            self.create(date=day(-n).isoformat())
        res = self.get("/daily-updates/", limit=2, offset=1)
        self.assertEqual((res.data["count"], len(res.data["results"]), res.data["limit"], res.data["offset"]), (5, 2, 2, 1))
        self.assertEqual([r["date"] for r in res.data["results"]], [day(-1).isoformat(), day(-2).isoformat()])
        searched = self.get("/daily-updates/", q="portal", limit=2)
        self.assertEqual((searched.data["count"], len(searched.data["results"])), (5, 2))
        for bad in ({"limit": 0}, {"limit": 100000}, {"limit": "x"}, {"offset": -1}):
            self.assertEqual(self.get("/daily-updates/", **bad).status_code, 400, bad)

    def test_feedback_cannot_target_another_update_via_body(self):
        a = self.create().data["id"]
        b = self.create(date=day(-1).isoformat()).data["id"]
        self.post(f"/daily-updates/{a}/feedback/", {"type": "Suggestion", "content": "x", "update": b, "update_id": b})
        self.assertEqual(Feedback.objects.filter(update_id=a).count(), 1)
        self.assertEqual(Feedback.objects.filter(update_id=b).count(), 0)

    def test_page_boundaries(self):
        for n in range(3):
            self.create(date=day(-n).isoformat())
        past_end = self.get("/daily-updates/", offset=3)
        self.assertEqual((past_end.status_code, past_end.data["results"], past_end.data["count"]), (200, [], 3))
        self.assertEqual(len(self.get("/daily-updates/", limit=3).data["results"]), 3)  # exact fit
        self.assertEqual(len(self.get("/daily-updates/", offset=2, limit=5).data["results"]), 1)  # short last page
        self.assertEqual(self.get("/daily-updates/", limit=1000).status_code, 200)  # maximum allowed
        self.assertEqual(self.get("/daily-updates/", limit=1001).status_code, 400)
        pages = [r["id"] for off in (0, 1, 2) for r in self.get("/daily-updates/", limit=1, offset=off).data["results"]]
        self.assertEqual(len(pages), len(set(pages)), "pages must not overlap")


class TasksFeedDailyUpdatesTests(ApiTestCase):
    def setUp(self):
        self.proj = self.project(name="Payroll")
        self.owner = self.proj.lead

    def add_task(self, **extra):
        body = {"title": "Reconcile payroll", "project_id": self.proj.id, "owner_id": self.owner.id, **extra}
        res = self.post("/tasks/", body)
        self.assertEqual(res.status_code, 201, res.data)
        return res.data["id"]

    def updates(self):
        return self.get("/daily-updates/").data["results"]

    def test_new_task_creates_daily_update_with_its_items(self):
        self.add_task()
        rows = self.updates()
        self.assertEqual(len(rows), 1)
        u = rows[0]
        self.assertEqual((u["employee"], u["project"], u["date"]), (self.owner.id, self.proj.id, day(0).isoformat()))
        self.assertTrue(u["from_tasks"])
        self.assertEqual(u["next_steps"], ["Reconcile payroll"])  # not started yet
        self.assertEqual(u["review_status"], "new")

    def test_marking_done_moves_item_to_completed_and_reopens_review(self):
        tid = self.add_task()
        uid = self.updates()[0]["id"]
        self.patch(f"/daily-updates/{uid}/", {"review_status": "reviewed"})
        self.post(f"/tasks/{tid}/complete/", {})
        u = self.updates()[0]
        self.assertEqual((u["completed"], u["next_steps"]), (["Reconcile payroll"], []))
        self.assertEqual(u["review_status"], "new", "a newly completed task is news for the manager")

    def test_states_map_to_sections_and_blocked_sets_status(self):
        self.add_task(title="A", state="done")
        self.add_task(title="B", state="in-progress")
        self.add_task(title="C", state="blocked", note="Waiting for bank file")
        u = self.updates()[0]
        self.assertEqual((u["completed"], u["in_progress"], u["blockers"]), (["A"], ["B"], ["C: Waiting for bank file"]))
        self.assertEqual(u["status"], "Blocked")
        self.assertEqual(len(u["tasks"]), 3)

    def test_task_notes_show_in_every_section(self):
        self.add_task(title="A", state="done", note="Shipped to staging")
        self.add_task(title="B", state="in-progress", note="Half the screens done")
        self.add_task(title="D", note="Starts after review")
        self.add_task(title="E")  # no note: the title alone
        u = self.updates()[0]
        self.assertEqual(u["completed"], ["A: Shipped to staging"])
        self.assertEqual(u["in_progress"], ["B: Half the screens done"])
        self.assertEqual(u["next_steps"], ["D: Starts after review", "E"])

    def test_past_work_date_lands_on_that_day_and_moves_with_edits(self):
        tid = self.add_task(work_date=day(-40).isoformat(), state="done")
        self.assertEqual([u["date"] for u in self.updates()], [day(-40).isoformat()])
        self.patch(f"/tasks/{tid}/", {"work_date": day(-35).isoformat()})
        self.assertEqual([u["date"] for u in self.updates()], [day(-35).isoformat()], "the empty old-day update is removed")

    def test_deleting_last_task_removes_auto_update_but_keeps_one_with_feedback(self):
        tid = self.add_task()
        self.delete(f"/tasks/{tid}/")
        self.assertEqual(self.updates(), [])
        tid = self.add_task()
        uid = self.updates()[0]["id"]
        self.post(f"/daily-updates/{uid}/feedback/", {"type": "Suggestion", "content": "Good work"})
        self.delete(f"/tasks/{tid}/")
        self.assertEqual([u["id"] for u in self.updates()], [uid], "manager feedback is never thrown away")

    def test_shared_update_keeps_its_text_and_gains_task_items_without_duplicates(self):
        shared = self.post(
            "/daily-updates/",
            {"employee_id": self.owner.id, "project_id": self.proj.id, "date": day(0).isoformat(), "completed": ["Reconcile payroll", "Call bank"]},
        )
        self.assertEqual(shared.status_code, 201, shared.data)
        self.add_task(state="done")
        self.add_task(title="File returns", state="done")
        u = self.updates()[0]
        self.assertFalse(u["from_tasks"])
        self.assertEqual(u["completed"], ["Reconcile payroll", "Call bank", "File returns"])
        self.assertEqual(u["own"]["completed"], ["Reconcile payroll", "Call bank"])  # typed text only
        self.assertEqual(DailyUpdate.objects.count(), 1)

    def test_update_with_logged_tasks_cannot_be_deleted(self):
        tid = self.add_task()
        uid = self.updates()[0]["id"]
        res = self.delete(f"/daily-updates/{uid}/")
        self.assertEqual(res.status_code, 409)
        self.assertIn("Tasks tab", res.data["error"]["message"])
        self.assertTrue(DailyUpdate.objects.filter(pk=uid).exists())
        self.delete(f"/tasks/{tid}/")  # with its tasks gone the auto-built update goes too
        self.assertFalse(DailyUpdate.objects.filter(pk=uid).exists())
