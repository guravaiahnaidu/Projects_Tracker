from activity.models import ActivityLog
from tests.support import ApiTestCase
from members.models import Member


class MemberApiTests(ApiTestCase):
    def valid(self, **extra):
        return {"name": "Asha Rao", "title": "Analyst", "department": "Finance", **extra}

    def test_create_defaults_and_whitespace_collapse(self):
        res = self.post("/members/", self.valid(name="  Asha    Rao "))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["name"], "Asha Rao")
        self.assertEqual(res.data["load"], 60)
        self.assertFalse(res.data["stretched"])
        self.assertEqual(Member.objects.count(), 1)

    def test_required_fields_have_frontend_messages(self):
        res = self.post("/members/", {})
        self.assertEqual(res.status_code, 400)
        fields = res.data["error"]["fields"]
        self.assertEqual(fields["name"], ["Enter the employee's full name."])
        self.assertEqual(fields["title"], ["Enter a job title."])
        self.assertEqual(fields["department"], ["Choose or type a department."])

    def test_name_unique_case_insensitive(self):
        self.post("/members/", self.valid())
        res = self.post("/members/", self.valid(name="ASHA rao"))
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["name"], ["ASHA rao is already on the team."])

    def test_load_bounds(self):
        for load, ok in [(0, True), (200, True), (201, False), (-1, False)]:
            res = self.post("/members/", self.valid(name=f"P{load}", load=load))
            self.assertEqual(res.status_code == 201, ok, load)
        self.assertEqual(self.get("/members/").data["count"], 2)

    def test_stretched_only_above_100(self):
        self.post("/members/", self.valid(name="A", load=100))
        self.post("/members/", self.valid(name="B", load=101))
        rows = {r["name"]: r for r in self.get("/members/").data["results"]}
        self.assertFalse(rows["A"]["stretched"])
        self.assertTrue(rows["B"]["stretched"])

    def test_create_with_memberships_logs_and_links(self):
        project = self.project()
        res = self.post("/members/", self.valid(memberships=[{"project_id": project.id, "role": ""}]))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["projects"][0]["role"], "Team Member")
        texts = list(ActivityLog.objects.values_list("description", flat=True))
        self.assertIn("You added Asha Rao (Analyst, Finance) to the team", texts)
        self.assertIn("You added Asha Rao to the team as Team Member", texts)

    def test_memberships_with_unknown_project_rejected_atomically(self):
        res = self.post("/members/", self.valid(memberships=[{"project_id": 999}]))
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Member.objects.count(), 0)

    def test_retrieve_patch_and_404(self):
        m = self.member(name="Old Name")
        self.assertEqual(self.get(f"/members/{m.id}/").data["name"], "Old Name")
        res = self.patch(f"/members/{m.id}/", {"load": 150, "title": "Lead"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data["load"], res.data["title"], res.data["stretched"]), (150, "Lead", True))
        self.assertEqual(self.get("/members/9999/").status_code, 404)
        self.assertEqual(self.patch(f"/members/{m.id}/", {"load": 500}).status_code, 400)

    def test_patch_name_can_keep_own_name_but_not_take_anothers(self):
        a, b = self.member(name="Aa"), self.member(name="Bb")
        self.assertEqual(self.patch(f"/members/{a.id}/", {"name": "aa"}).status_code, 200)
        self.assertEqual(self.patch(f"/members/{a.id}/", {"name": "BB"}).status_code, 400)

    def test_delete_free_member_and_blocked_members(self):
        free = self.member(name="Free")
        self.assertEqual(self.delete(f"/members/{free.id}/").status_code, 204)
        project = self.project()
        res = self.delete(f"/members/{project.lead_id}/")
        self.assertEqual(res.status_code, 409)
        self.assertIn("leads 1 project", res.data["error"]["message"])
        owner = self.member(name="Owner")
        self.task(project=project, owner=owner)
        self.assertEqual(self.delete(f"/members/{owner.id}/").status_code, 409)
        self.assertTrue(Member.objects.filter(pk=owner.id).exists())

    def test_delete_removes_plain_memberships(self):
        project = self.project()
        extra = self.member(name="Extra")
        self.post(f"/projects/{project.id}/members/", {"member_id": extra.id})
        self.assertEqual(self.delete(f"/members/{extra.id}/").status_code, 204)
        self.assertEqual(project.memberships.count(), 1)

    def test_filters_and_sorts(self):
        project = self.project(name="Alpha")
        busy = self.member(name="Busy", load=120, department="Ops")
        calm = self.member(name="Calm", load=40, title="Designer")
        self.task(project=project, owner=busy, due=-2)
        self.task(project=project, owner=busy, due=3, state="blocked", note="waiting")
        self.task(project=project, owner=calm, due=5)
        self.post(f"/projects/{project.id}/members/", {"member_id": calm.id})

        names = lambda **p: [r["name"] for r in self.get("/members/", **p).data["results"]]
        self.assertEqual(names(show="stretched"), ["Busy"])
        self.assertEqual(names(show="overdue"), ["Busy"])
        self.assertEqual(names(show="blocked"), ["Busy"])
        self.assertEqual(names(q="designer"), ["Calm"])
        self.assertEqual(names(q="alpha", sort="name"), ["Calm", project.lead.name])
        self.assertEqual(names(project=project.id, sort="name"), ["Calm", project.lead.name])
        self.assertEqual(names(sort="tasks")[:2], ["Busy", "Calm"])
        self.assertEqual(names(sort="name")[0], "Busy")
        row = self.get("/members/", q="busy").data["results"][0]
        self.assertEqual((row["open_tasks"], row["overdue_tasks"], row["blocked_tasks"]), (2, 1, 1))

    def test_departments_union_of_members_and_projects(self):
        self.member(name="X", department="Finance")
        self.project(department="Marketing")
        res = self.get("/members/departments/")
        self.assertIn("Finance", res.data["results"])
        self.assertIn("Marketing", res.data["results"])
        self.assertIn("Engineering", res.data["results"])

    def test_list_rejects_unknown_show_and_sort_values(self):
        # Regression: these used to be silently ignored (200 with an unfiltered list), unlike every other filter.
        self.member(name="A")
        for params in ({"show": "bogus"}, {"sort": "bogus"}, {"show": "STRETCHED"}):
            res = self.get("/members/", **params)
            self.assertEqual(res.status_code, 400, params)
            self.assertEqual(res.data["error"]["code"], "validation_error")
        for params in ({"show": "all"}, {"show": "stretched"}, {"show": "overdue"}, {"show": "blocked"}, {"sort": "name"}, {"sort": "tasks"}, {"sort": "stretched"}):
            self.assertEqual(self.get("/members/", **params).status_code, 200, params)

    def test_contact_and_status_defaults(self):
        res = self.post("/members/", self.valid())
        self.assertEqual(res.status_code, 201)
        self.assertEqual(
            (res.data["email"], res.data["phone"], res.data["status"], res.data["employment_type"], res.data["start_date"]),
            ("", "", "active", "full_time", None),
        )

    def test_create_with_contact_and_status(self):
        res = self.post(
            "/members/",
            self.valid(
                email="  Asha.Rao@Example.COM ",
                phone=" +91  98450 12345 ",
                status="on_leave",
                employment_type="contract",
                start_date="2026-11-02",
            ),
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["email"], "asha.rao@example.com")
        self.assertEqual(res.data["phone"], "+91 98450 12345")
        self.assertEqual(res.data["status"], "on_leave")
        self.assertEqual(res.data["employment_type"], "contract")
        self.assertEqual(res.data["start_date"], "2026-11-02")

    def test_invalid_contact_and_choices_rejected(self):
        cases = {
            "email": ["not-an-email", "a@b", "x" * 250 + "@ex.com"],
            "phone": ["12345", "+1 (555) abc-1234", "1" * 16],
            "status": ["away"],
            "employment_type": ["freelance"],
            "start_date": ["14/10/2026"],
        }
        for field, values in cases.items():
            for value in values:
                res = self.post("/members/", self.valid(**{field: value}))
                self.assertEqual(res.status_code, 400, (field, value))
                self.assertIn(field, res.data["error"]["fields"], (field, value))
        self.assertEqual(Member.objects.count(), 0)

    def test_email_unique_case_insensitive_but_blank_allowed_twice(self):
        self.assertEqual(self.post("/members/", self.valid(email="asha@example.com")).status_code, 201)
        res = self.post("/members/", self.valid(name="Other", email="ASHA@example.com"))
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["email"], ["asha@example.com is already used by Asha Rao."])
        self.assertEqual(self.post("/members/", self.valid(name="B1")).status_code, 201)
        self.assertEqual(self.post("/members/", self.valid(name="B2", email="")).status_code, 201)

    def test_patch_contact_and_status_logs_changes(self):
        a = self.member(name="Aa")
        b = self.member(name="Bb")
        self.patch(f"/members/{b.id}/", {"email": "bb@example.com"})
        res = self.patch(f"/members/{a.id}/", {"status": "inactive", "email": "aa@example.com"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data["status"], res.data["email"]), ("inactive", "aa@example.com"))
        # Keeping your own email is fine; taking someone else's is not.
        self.assertEqual(self.patch(f"/members/{a.id}/", {"email": "AA@example.com"}).status_code, 200)
        self.assertEqual(self.patch(f"/members/{a.id}/", {"email": "bb@example.com"}).status_code, 400)
        texts = list(ActivityLog.objects.values_list("description", flat=True))
        self.assertIn("You updated Aa: email (none) -> aa@example.com, status active -> inactive", texts)

    def test_search_matches_email(self):
        self.post("/members/", self.valid(email="unique.handle@example.com"))
        self.post("/members/", self.valid(name="Someone Else"))
        res = self.get("/members/", q="unique.handle")
        self.assertEqual([r["name"] for r in res.data["results"]], ["Asha Rao"])
