"""Who may use the API.

Only managers sign in: an active Django user with is_staff (or is_superuser). Employees (members.Member) have no
login of their own, so there is no per-employee access to scope; every signed-in manager sees all dashboard data.
"""

from django.conf import settings
from rest_framework.permissions import BasePermission


def is_manager(user) -> bool:
    return bool(user and user.is_authenticated and user.is_active and (user.is_staff or user.is_superuser))


def role_of(user) -> str:
    return "admin" if user.is_superuser else "manager"


class IsManager(BasePermission):
    """A signed-in manager (no token -> 401, a token for a non-manager -> 403)."""

    message = "Only manager accounts can use this endpoint."

    def has_permission(self, request, view):
        return is_manager(request.user)


class ApiAccessPolicy(BasePermission):
    """Default permission of every API view.

    With DJANGO_API_REQUIRE_AUTH off (the default while the frontend has no login screen) the API stays open exactly
    as before. With it on, every data endpoint needs a manager's access token. Read per request, so the switch also
    works with override_settings in tests.
    """

    message = IsManager.message

    def has_permission(self, request, view):
        if not settings.API_REQUIRE_AUTH:
            return True
        return is_manager(request.user)
