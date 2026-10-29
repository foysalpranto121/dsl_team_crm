"""Settings for the DSL Business Team CRM. Secrets and machine-specific values come from backend/.env."""
import os
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env(name, default=""):
    return os.environ.get(name, default).strip()


def env_bool(name, default=False):
    v = env(name)
    return default if not v else v.lower() in ("1", "true", "yes", "on")


def env_list(name):
    return [x.strip() for x in env(name).split(",") if x.strip()]


SECRET_KEY = env("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY in backend/.env (see .env.example).")
DEBUG = env_bool("DJANGO_DEBUG")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS") or ["localhost", "127.0.0.1"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "drf_spectacular",
    "accounts",
    "core",
    "team",
    "tracker",
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

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DB_NAME", "DSLCRM"),
        "USER": env("DB_USER", "postgres"),
        "PASSWORD": env("DB_PASSWORD"),
        "HOST": env("DB_HOST", "localhost"),
        "PORT": env("DB_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "Asia/Dhaka"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------- API ----------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["accounts.authentication.ApprovedJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["accounts.permissions.IsApproved"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_RATES": {"auth": "30/min"},
}
SPECTACULAR_SETTINGS = {"TITLE": "DSL Business Team CRM API", "VERSION": "1.0.0", "SERVE_INCLUDE_SCHEMA": False}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "USER_AUTHENTICATION_RULE": "accounts.authentication.user_can_sign_in",
}
# The refresh token lives in an httpOnly cookie so page scripts can never read it.
REFRESH_COOKIE = {
    "key": "dsl_refresh",
    "path": "/api/auth/",
    "httponly": True,
    "samesite": "Lax",
    "secure": not DEBUG,
}

FRONTEND_URL = env("FRONTEND_URL", "http://localhost:5173").rstrip("/")
BACKEND_URL = env("BACKEND_URL", "http://localhost:8000").rstrip("/")
CORS_ALLOWED_ORIGINS = [FRONTEND_URL]
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = [FRONTEND_URL, BACKEND_URL]

# ---------- Google sign-in and approval ----------
GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID")
GOOGLE_ALLOWED_DOMAINS = [d.lower() for d in env_list("GOOGLE_ALLOWED_DOMAINS")]
ADMIN_EMAILS = [e.lower() for e in env_list("ADMIN_EMAILS")]
APPROVAL_LINK_MAX_AGE = 7 * 24 * 3600

# ---------- Email ----------
if env("EMAIL_HOST_USER") and env("EMAIL_HOST_PASSWORD"):   # Gmail needs both; until then emails print in the terminal
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = "smtp.gmail.com"
    EMAIL_PORT = 587
    EMAIL_USE_TLS = True
    EMAIL_HOST_USER = env("EMAIL_HOST_USER")
    EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD")
    DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL") or EMAIL_HOST_USER
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"  # prints emails in the terminal
    DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "DSL Business Team CRM <no-reply@localhost>")

# ---------- Uploads ----------
PROFILE_PHOTO_MAX_BYTES = 3 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_CONTENT_TYPE_NOSNIFF = True
