"""Production-configuration safety. Each case imports config.settings in a fresh interpreter with a controlled
environment, because settings are evaluated once at import time."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
GOOD_KEY = "k8s-Zp3vQx9LmN2rT7wYb4HdF6gJ1cA5eU0oIiKsXn8Rt3yV2zPq"  # 50+ chars, many distinct characters, test only

PROBE = (
    "import json, config.settings as s;"
    "print(json.dumps({k: getattr(s, k, None) for k in ('ENVIRONMENT','DEBUG','ALLOWED_HOSTS','CORS_ALLOWED_ORIGINS',"
    "'SECURE_SSL_REDIRECT','SESSION_COOKIE_SECURE','CSRF_COOKIE_SECURE','SECURE_HSTS_SECONDS','SECURE_PROXY_SSL_HEADER',"
    "'API_REQUIRE_AUTH','JWT_REFRESH_COOKIE','CORS_ALLOW_CREDENTIALS')}))"
)


def load_settings(extra_env, argv0="-c"):
    """Import config.settings with only the given environment (no inherited DJANGO_*/CORS_* variables)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_", "CORS_"))}
    env.update(extra_env)
    env["PYTHONPATH"] = str(BACKEND)
    code = f"import sys; sys.argv[0] = {argv0!r};" + PROBE
    # Run from an empty dir so a developer's backend/.env cannot leak in through the working directory;
    # the loader only reads backend/.env, which does not exist in a clean checkout (and is skipped when present
    # because the variables below are already set).
    with tempfile.TemporaryDirectory() as cwd:
        return subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, cwd=cwd, timeout=60)


PROD = {
    "DJANGO_ENV": "production",
    "DJANGO_SECRET_KEY": GOOD_KEY,
    "DJANGO_ALLOWED_HOSTS": "tracker.example.org",
    "CORS_ALLOWED_ORIGINS": "https://tracker.example.org",
    "DJANGO_ACKNOWLEDGE_NO_AUTH": "true",
}


@unittest.skipIf((BACKEND / ".env").exists(), "a local backend/.env would add variables to these isolated checks")
class ProductionSettingsTests(unittest.TestCase):
    def assert_refuses(self, env, fragment, argv0="-c"):
        result = load_settings(env, argv0)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("ConfigurationError", result.stderr)
        self.assertIn(fragment, result.stderr)
        self.assertNotIn(GOOD_KEY, result.stderr)  # never echo secrets

    def test_valid_production_configuration_loads_and_is_hardened(self):
        result = load_settings(PROD)
        self.assertEqual(result.returncode, 0, result.stderr)
        s = json.loads(result.stdout)
        self.assertEqual(s["ENVIRONMENT"], "production")
        self.assertFalse(s["DEBUG"])
        self.assertEqual(s["ALLOWED_HOSTS"], ["tracker.example.org"])
        self.assertTrue(s["SECURE_SSL_REDIRECT"])
        self.assertTrue(s["SESSION_COOKIE_SECURE"] and s["CSRF_COOKIE_SECURE"])
        self.assertGreater(s["SECURE_HSTS_SECONDS"], 0)
        self.assertIsNone(s["SECURE_PROXY_SSL_HEADER"])

    def test_default_without_any_environment_is_production_and_fails_safely(self):
        # No DJANGO_ENV at all (e.g. started by gunicorn/wsgi): must NOT fall back to debug/dev settings.
        self.assert_refuses({}, "DJANGO_SECRET_KEY")

    def test_missing_or_weak_secret_key(self):
        for key in (None, "", "short", "dev-only-insecure-key-change-me-never-use-in-production", "django-insecure-" + "x1y2z3" * 10, "a" * 60):
            env = {k: v for k, v in PROD.items() if k != "DJANGO_SECRET_KEY"}
            if key is not None:
                env["DJANGO_SECRET_KEY"] = key
            with self.subTest(key=(key or "")[:8]):
                self.assert_refuses(env, "DJANGO_SECRET_KEY")

    def test_debug_true_is_refused_in_production(self):
        self.assert_refuses({**PROD, "DJANGO_DEBUG": "true"}, "DJANGO_DEBUG")

    def test_allowed_hosts_required_and_no_wildcard(self):
        env = {k: v for k, v in PROD.items() if k != "DJANGO_ALLOWED_HOSTS"}
        self.assert_refuses(env, "DJANGO_ALLOWED_HOSTS")
        self.assert_refuses({**PROD, "DJANGO_ALLOWED_HOSTS": "*"}, "DJANGO_ALLOWED_HOSTS")
        self.assert_refuses({**PROD, "DJANGO_ALLOWED_HOSTS": "good.example.org,*"}, "DJANGO_ALLOWED_HOSTS")

    def test_cors_origins_required_and_https_only(self):
        env = {k: v for k, v in PROD.items() if k != "CORS_ALLOWED_ORIGINS"}
        self.assert_refuses(env, "CORS_ALLOWED_ORIGINS")
        self.assert_refuses({**PROD, "CORS_ALLOWED_ORIGINS": "http://localhost:3000"}, "CORS_ALLOWED_ORIGINS")

    def test_unauthenticated_api_must_be_acknowledged_explicitly(self):
        env = {k: v for k, v in PROD.items() if k != "DJANGO_ACKNOWLEDGE_NO_AUTH"}
        self.assert_refuses(env, "DJANGO_ACKNOWLEDGE_NO_AUTH")
        self.assert_refuses({**PROD, "DJANGO_ACKNOWLEDGE_NO_AUTH": "false"}, "DJANGO_ACKNOWLEDGE_NO_AUTH")

    def test_requiring_auth_replaces_the_no_auth_acknowledgement(self):
        env = {k: v for k, v in PROD.items() if k != "DJANGO_ACKNOWLEDGE_NO_AUTH"}
        result = load_settings({**env, "DJANGO_API_REQUIRE_AUTH": "true"})
        self.assertEqual(result.returncode, 0, result.stderr)
        s = json.loads(result.stdout)
        self.assertTrue(s["API_REQUIRE_AUTH"])
        self.assertTrue(s["JWT_REFRESH_COOKIE"]["secure"])  # always Secure in production
        self.assertEqual(s["JWT_REFRESH_COOKIE"]["samesite"], "Strict")
        self.assertTrue(s["CORS_ALLOW_CREDENTIALS"])

    def test_jwt_configuration_is_validated(self):
        self.assert_refuses({**PROD, "DJANGO_JWT_SIGNING_KEY": "short"}, "DJANGO_JWT_SIGNING_KEY")
        self.assert_refuses({**PROD, "DJANGO_JWT_COOKIE_SAMESITE": "Anything"}, "DJANGO_JWT_COOKIE_SAMESITE")
        # None (frontend on another site) is allowed and always makes the cookie Secure, even when manage.py
        # commands run in development mode during a build.
        for env in ({**PROD, "DJANGO_JWT_COOKIE_SAMESITE": "none"}, {"DJANGO_ENV": "development", "DJANGO_JWT_COOKIE_SAMESITE": "None"}):
            with self.subTest(env=env.get("DJANGO_ENV")):
                result = load_settings(env)
                self.assertEqual(result.returncode, 0, result.stderr)
                cookie = json.loads(result.stdout)["JWT_REFRESH_COOKIE"]
                self.assertEqual((cookie["samesite"], cookie["secure"]), ("None", True))
        for name in ("DJANGO_JWT_ACCESS_MINUTES", "DJANGO_JWT_REFRESH_HOURS"):
            for value in ("0", "-5", "soon"):
                with self.subTest(name=name, value=value):
                    self.assert_refuses({**PROD, name: value}, name)

    def test_all_problems_are_reported_together(self):
        result = load_settings({"DJANGO_ENV": "production"})
        for fragment in ("DJANGO_SECRET_KEY", "DJANGO_ALLOWED_HOSTS", "CORS_ALLOWED_ORIGINS", "DJANGO_ACKNOWLEDGE_NO_AUTH"):
            self.assertIn(fragment, result.stderr)

    def test_invalid_environment_name(self):
        self.assert_refuses({"DJANGO_ENV": "staging"}, "DJANGO_ENV")

    def test_proxy_header_is_opt_in(self):
        result = load_settings({**PROD, "DJANGO_BEHIND_PROXY": "true"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["SECURE_PROXY_SSL_HEADER"], ["HTTP_X_FORWARDED_PROTO", "https"])

    def test_ssl_redirect_can_be_disabled_explicitly_only(self):
        result = load_settings({**PROD, "DJANGO_SSL_REDIRECT": "false"})
        self.assertFalse(json.loads(result.stdout)["SECURE_SSL_REDIRECT"])


@unittest.skipIf((BACKEND / ".env").exists(), "a local backend/.env would add variables to these isolated checks")
class DevelopmentSettingsTests(unittest.TestCase):
    def test_manage_py_defaults_to_development_without_configuration(self):
        result = load_settings({}, argv0="manage.py")
        self.assertEqual(result.returncode, 0, result.stderr)
        s = json.loads(result.stdout)
        self.assertEqual(s["ENVIRONMENT"], "development")
        self.assertTrue(s["DEBUG"])
        self.assertEqual(s["ALLOWED_HOSTS"], ["127.0.0.1", "localhost"])
        self.assertEqual(s["CORS_ALLOWED_ORIGINS"], ["http://localhost:3000", "http://127.0.0.1:3000"])
        self.assertIsNone(s["SECURE_SSL_REDIRECT"])  # production hardening is not applied in development
        self.assertFalse(s["API_REQUIRE_AUTH"])  # the dashboard keeps working until the frontend has a login
        self.assertFalse(s["JWT_REFRESH_COOKIE"]["secure"])  # plain-http localhost

    def test_explicit_environment_overrides_the_manage_py_default(self):
        result = load_settings({"DJANGO_ENV": "production"}, argv0="manage.py")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ConfigurationError", result.stderr)

    def test_the_running_test_process_is_in_development(self):
        from django.conf import settings

        self.assertEqual(settings.ENVIRONMENT, "development")
