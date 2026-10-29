from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework_simplejwt.tokens import AccessToken

from tests.support import ApiTestCase

AUTH = "/auth"
COOKIE = "pt_refresh"
PASSWORD = "Correct-Horse-Battery-9"
FRONTEND = "http://localhost:3000"

User = get_user_model()


class AuthTestCase(ApiTestCase):
    def setUp(self):
        self.manager = User.objects.create_user("manager", "manager@example.com", PASSWORD, is_staff=True)

    def login(self, username="manager", password=PASSWORD):
        return self.post(f"{AUTH}/login/", {"username": username, "password": password})

    def bearer(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def manager_token(self):
        return str(AccessToken.for_user(self.manager))

    def assert_error(self, response, status, code):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(response.json()["error"]["code"], code)


class LoginTests(AuthTestCase):
    def test_valid_login_returns_access_token_and_sets_refresh_cookie_only(self):
        r = self.login()
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["token_type"], "Bearer")
        self.assertEqual(body["access_expires_in"], 15 * 60)
        self.assertEqual(body["user"]["username"], "manager")
        self.assertEqual(body["user"]["role"], "manager")
        self.assertNotIn("refresh", body)  # the refresh token is never exposed to page scripts
        self.assertEqual(str(AccessToken(body["access"])["user_id"]), str(self.manager.id))  # a string claim since simplejwt 5.5
        cookie = r.cookies[COOKIE]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["path"], "/api/auth/")
        self.assertEqual(cookie["samesite"], "Strict")
        self.manager.refresh_from_db()
        self.assertIsNotNone(self.manager.last_login)

    def test_superuser_role_is_admin(self):
        User.objects.create_superuser("boss", "boss@example.com", PASSWORD)
        self.assertEqual(self.login("boss").json()["user"]["role"], "admin")

    def test_invalid_credentials_get_one_generic_401(self):
        User.objects.create_user("employee", "employee@example.com", PASSWORD)  # not staff
        User.objects.create_user("gone", "gone@example.com", PASSWORD, is_staff=True, is_active=False)
        for username, password in (("manager", "wrong"), ("nobody", PASSWORD), ("employee", PASSWORD), ("gone", PASSWORD)):
            with self.subTest(username=username):
                r = self.login(username, password)
                self.assert_error(r, 401, "invalid_credentials")
                self.assertEqual(r.json()["error"]["message"], "Invalid username or password.")
                self.assertIn("Bearer", r["WWW-Authenticate"])
                self.assertNotIn(COOKIE, r.cookies)

    def test_email_is_not_accepted_as_username(self):
        self.assert_error(self.login("manager@example.com"), 401, "invalid_credentials")

    def test_missing_fields_are_a_validation_error(self):
        r = self.post(f"{AUTH}/login/", {"username": " "})
        self.assert_error(r, 400, "validation_error")
        self.assertEqual(set(r.json()["error"]["fields"]), {"username", "password"})

    def test_non_object_body_is_a_validation_error(self):
        self.assert_error(self.client.post("/api/auth/login/", [1, 2], format="json"), 400, "validation_error")

    def test_stale_authorization_header_does_not_block_login(self):
        self.bearer("garbage")
        self.assertEqual(self.login().status_code, 200)

    def test_login_attempts_are_throttled(self):
        for _ in range(10):
            self.login(password="wrong")
        self.assert_error(self.login(), 429, "throttled")


class AccessTokenTests(AuthTestCase):
    def test_me_requires_a_token(self):
        r = self.get(f"{AUTH}/me/")
        self.assert_error(r, 401, "not_authenticated")
        self.assertIn("Bearer", r["WWW-Authenticate"])

    def test_me_returns_the_signed_in_user(self):
        self.manager.email = "lead@example.com"
        self.manager.save()
        self.bearer(self.login().json()["access"])
        r = self.get(f"{AUTH}/me/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            r.json(),
            {
                "id": self.manager.id,
                "username": "manager",
                "email": "lead@example.com",
                "role": "manager",
                "is_staff": True,
                "is_superuser": False,
                "groups": [],
                "can_manage_project_access": False,
            },
        )

    def test_invalid_and_expired_tokens_are_401(self):
        self.bearer("not-a-jwt")
        self.assert_error(self.get(f"{AUTH}/me/"), 401, "token_not_valid")

        expired = AccessToken.for_user(self.manager)
        expired.set_exp(lifetime=-timedelta(seconds=1))
        self.bearer(str(expired))
        r = self.get(f"{AUTH}/me/")
        self.assert_error(r, 401, "token_not_valid")
        # The wording depends on the simplejwt version ("Token is invalid or expired" before 5.5, "Token is expired"
        # since); the frontend relies on the 401 and the token_not_valid code only.
        self.assertIn("expired", r.json()["error"]["message"])

    def test_token_of_a_deactivated_user_is_rejected(self):
        token = self.manager_token()
        self.manager.is_active = False
        self.manager.save()
        self.bearer(token)
        self.assert_error(self.get(f"{AUTH}/me/"), 401, "authentication_failed")

    def test_token_of_a_non_manager_is_forbidden(self):
        employee = User.objects.create_user("employee", password=PASSWORD)
        self.bearer(str(AccessToken.for_user(employee)))
        self.assert_error(self.get(f"{AUTH}/me/"), 403, "permission_denied")


class RefreshAndLogoutTests(AuthTestCase):
    def refresh(self, origin=None):
        headers = {"HTTP_ORIGIN": origin} if origin else {}
        return self.client.post(f"/api{AUTH}/refresh/", format="json", **headers)

    def test_refresh_rotates_the_cookie_and_old_one_stops_working(self):
        old = self.login().cookies[COOKIE].value
        r = self.refresh(FRONTEND)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(str(AccessToken(r.json()["access"])["user_id"]), str(self.manager.id))
        new = r.cookies[COOKIE].value
        self.assertNotEqual(new, old)

        self.client.cookies[COOKIE] = old  # replaying a rotated token
        r = self.refresh()
        self.assert_error(r, 401, "token_not_valid")
        self.assertEqual(r.cookies[COOKIE]["max-age"], 0)  # cleared

        self.client.cookies[COOKIE] = new
        self.assertEqual(self.refresh().status_code, 200)

    def test_refresh_without_cookie_is_401(self):
        self.assert_error(self.refresh(), 401, "token_not_valid")

    def test_refresh_fails_once_the_user_is_no_longer_a_manager(self):
        self.login()
        self.manager.is_staff = False
        self.manager.save()
        self.assert_error(self.refresh(), 401, "token_not_valid")

    def test_refresh_and_logout_refuse_foreign_origins(self):
        self.login()
        self.assert_error(self.refresh("https://evil.example"), 403, "origin_not_allowed")
        r = self.client.post(f"/api{AUTH}/logout/", HTTP_ORIGIN="https://evil.example")
        self.assert_error(r, 403, "origin_not_allowed")
        self.assertEqual(self.refresh(FRONTEND).status_code, 200)  # the session survived both attempts

    def test_logout_revokes_the_refresh_token_and_clears_the_cookie(self):
        token = self.login().cookies[COOKIE].value
        r = self.client.post(f"/api{AUTH}/logout/", HTTP_ORIGIN=FRONTEND)
        self.assertEqual(r.status_code, 204)
        self.assertEqual(r.cookies[COOKIE]["max-age"], 0)
        self.client.cookies[COOKIE] = token
        self.assert_error(self.refresh(), 401, "token_not_valid")

    def test_logout_without_a_session_still_succeeds(self):
        self.assertEqual(self.client.post(f"/api{AUTH}/logout/").status_code, 204)


# One read endpoint per module the dashboard uses.
DATA_ENDPOINTS = [
    "/members/",
    "/projects/",
    "/tasks/",
    "/activity/",
    "/daily-updates/",
    "/dashboard/summary/",
    "/dashboard/attention/",
    "/dashboard/team-workload/",
    "/today/",
    "/weekly-brief/",
]


class OpenApiRegressionTests(AuthTestCase):
    """DJANGO_API_REQUIRE_AUTH is off by default: the current dashboard keeps working without signing in."""

    def test_data_endpoints_stay_open(self):
        for path in DATA_ENDPOINTS:
            with self.subTest(path=path):
                self.assertEqual(self.get(path).status_code, 200)

    def test_writes_stay_open(self):
        project = self.project()
        r = self.post("/tasks/", {"title": "Ship it", "project_id": project.id, "owner_id": project.lead_id})
        self.assertEqual(r.status_code, 201, r.content)

    def test_a_valid_token_is_also_accepted(self):
        self.bearer(self.manager_token())
        self.assertEqual(self.get("/tasks/").status_code, 200)


@override_settings(API_REQUIRE_AUTH=True)
class ProtectedApiTests(AuthTestCase):
    def test_data_endpoints_need_a_token(self):
        for path in DATA_ENDPOINTS:
            with self.subTest(path=path):
                r = self.get(path)
                self.assert_error(r, 401, "not_authenticated")
                self.assertIn("Bearer", r["WWW-Authenticate"])

    def test_writes_need_a_token(self):
        project = self.project()
        task = self.task(project=project)
        self.assert_error(self.post("/tasks/", {"title": "x", "project_id": project.id}), 401, "not_authenticated")
        self.assert_error(self.patch(f"/tasks/{task.id}/", {"title": "y"}), 401, "not_authenticated")
        self.assert_error(self.delete(f"/tasks/{task.id}/"), 401, "not_authenticated")
        task.refresh_from_db()
        self.assertEqual(task.title, "Do it")

    def test_manager_keeps_full_dashboard_access(self):
        self.bearer(self.login().json()["access"])
        for path in DATA_ENDPOINTS:
            with self.subTest(path=path):
                self.assertEqual(self.get(path).status_code, 200)
        project = self.project()
        r = self.post("/tasks/", {"title": "Ship it", "project_id": project.id, "owner_id": project.lead_id})
        self.assertEqual(r.status_code, 201, r.content)

    def test_employees_cannot_reach_any_employee_data(self):
        # Employees have no sign-in: an employee's account can never get a token, and even a token minted for a
        # non-manager account cannot read or change anyone's tasks or daily updates, whatever the parameters.
        lead = self.member(name="Employee A")
        other = self.member(name="Employee B")
        project = self.project(lead=lead)
        task = self.task(project=project, owner=other)
        employee = User.objects.create_user("employee-a", "a@example.com", PASSWORD)

        self.assert_error(self.login("employee-a"), 401, "invalid_credentials")
        self.bearer(str(AccessToken.for_user(employee)))
        for path in (f"/tasks/?owner={other.id}", f"/tasks/{task.id}/", f"/daily-updates/?employee={other.id}", f"/members/{other.id}/"):
            with self.subTest(path=path):
                self.assert_error(self.get(path), 403, "permission_denied")
        self.assert_error(self.patch(f"/tasks/{task.id}/", {"title": "hijacked"}), 403, "permission_denied")
        task.refresh_from_db()
        self.assertEqual(task.title, "Do it")

    def test_auth_endpoints_remain_reachable(self):
        self.assertEqual(self.login().status_code, 200)
        self.assertEqual(self.client.post(f"/api{AUTH}/refresh/").status_code, 200)
        self.assertEqual(self.client.post(f"/api{AUTH}/logout/").status_code, 204)

    def test_unknown_api_urls_still_return_json_404(self):
        self.bearer(self.manager_token())
        self.assert_error(self.get("/no-such-thing/"), 404, "not_found")
