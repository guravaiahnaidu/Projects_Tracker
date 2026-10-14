"""Django settings for the Project Tracker API."""

import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (KEY=VALUE lines); real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_dotenv(BASE_DIR / ".env")


def _env_list(name: str, default: str = "") -> list[str]:
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    return default if raw is None else raw.strip().lower() in ("1", "true", "yes", "on")


class ConfigurationError(RuntimeError):
    """Production configuration is missing or unsafe; refuse to start rather than run insecurely."""


# --- Environment -----------------------------------------------------------------------------------------
# Safe by default: anything that is not `manage.py` (gunicorn/uvicorn/wsgi/asgi, a bare import) is PRODUCTION
# unless DJANGO_ENV says otherwise. Running `python manage.py ...` on a developer machine defaults to
# development so `runserver` and the tests work without any configuration.
_default_env = "development" if Path(sys.argv[0]).name == "manage.py" else "production"
ENVIRONMENT = os.environ.get("DJANGO_ENV", _default_env).strip().lower()
if ENVIRONMENT not in ("development", "production"):
    raise ConfigurationError("DJANGO_ENV must be 'development' or 'production'.")
PRODUCTION = ENVIRONMENT == "production"

DEBUG = _env_bool("DJANGO_DEBUG", default=not PRODUCTION)

_DEV_SECRET = "dev-only-insecure-key-change-me"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "" if PRODUCTION else _DEV_SECRET)
ALLOWED_HOSTS = _env_list("DJANGO_ALLOWED_HOSTS", "" if PRODUCTION else "127.0.0.1,localhost")
CORS_ALLOWED_ORIGINS = _env_list(
    "CORS_ALLOWED_ORIGINS", "" if PRODUCTION else "http://localhost:3000,http://127.0.0.1:3000"
)

if PRODUCTION:
    problems = []
    if DEBUG:
        problems.append("DJANGO_DEBUG must not be true in production")
    if len(SECRET_KEY) < 50 or len(set(SECRET_KEY)) < 5 or SECRET_KEY == _DEV_SECRET or SECRET_KEY.startswith("django-insecure"):
        problems.append("DJANGO_SECRET_KEY must be set to a random value of at least 50 characters")
    if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
        problems.append("DJANGO_ALLOWED_HOSTS must list the real host names (no '*')")
    if not CORS_ALLOWED_ORIGINS or any(not o.startswith("https://") for o in CORS_ALLOWED_ORIGINS):
        problems.append("CORS_ALLOWED_ORIGINS must list the https:// origin(s) of the frontend")
    if not _env_bool("DJANGO_ACKNOWLEDGE_NO_AUTH", False):
        problems.append(
            "the API has no authentication yet (every endpoint is open): set DJANGO_ACKNOWLEDGE_NO_AUTH=true only "
            "if access is restricted outside the app (VPN, firewall or an authenticating reverse proxy)"
        )
    if problems:
        raise ConfigurationError("Unsafe or incomplete production configuration: " + "; ".join(problems) + ".")

    # HTTPS and cookie hardening. Set DJANGO_BEHIND_PROXY=true when a TLS-terminating proxy forwards
    # X-Forwarded-Proto; DJANGO_HSTS_SECONDS can be raised once HTTPS is confirmed to work.
    SECURE_SSL_REDIRECT = _env_bool("DJANGO_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_HSTS_SECONDS", "3600"))
    SECURE_CONTENT_TYPE_NOSNIFF = True
    if _env_bool("DJANGO_BEHIND_PROXY", False):
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "members",
    "projects",
    "tasks",
    "activity",
    "dashboard",
    "updates",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# SQLite by default (local development). Set DJANGO_DB_ENGINE=postgresql (plus DJANGO_DB_NAME / _USER / _PASSWORD /
# _HOST / _PORT, read from the environment only) to run against PostgreSQL; this needs the psycopg package, which is
# not in requirements.txt because SQLite is the supported default.
if os.environ.get("DJANGO_DB_ENGINE", "sqlite").strip().lower() == "postgresql":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ.get("DJANGO_DB_NAME", "project_tracker"),
            "USER": os.environ.get("DJANGO_DB_USER", ""),
            "PASSWORD": os.environ.get("DJANGO_DB_PASSWORD", ""),
            "HOST": os.environ.get("DJANGO_DB_HOST", "localhost"),
            "PORT": os.environ.get("DJANGO_DB_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": os.environ.get("DJANGO_DB_PATH", BASE_DIR / "db.sqlite3"),
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-gb"

# "Today" for overdue / due-today / key-date logic is the calendar date in this zone.
TIME_ZONE = os.environ.get("DJANGO_TIME_ZONE", "Asia/Kolkata")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# CORS_ALLOWED_ORIGINS is defined with the environment settings above.

REST_FRAMEWORK = {
    # No login system exists in the frontend (open decision, see empty.txt), so the API is open.
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "config.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["config.throttling.WriteRateThrottle", "config.throttling.ReadRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "write": os.environ.get("DJANGO_THROTTLE_WRITE", "120/min"),
        "read": os.environ.get("DJANGO_THROTTLE_READ", "600/min"),
    },
    # 0 = trust only REMOTE_ADDR; raise it only when that many trusted reverse proxies sit in front (see throttling.py).
    "NUM_PROXIES": int(os.environ.get("DJANGO_NUM_PROXIES", "0")),
}

# Server-side logging: errors and the API's own warnings go to the console (stderr). Request bodies, tokens and
# personal data are never logged by this configuration; the "api" logger records only the view and exception type.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "loggers": {
        "api": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
    },
}
