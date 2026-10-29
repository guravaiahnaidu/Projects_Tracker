"""JWT sign-in for managers.

Token handling:
  - The ACCESS token is returned in the JSON body. The frontend keeps it in memory (never localStorage) and sends it as
    "Authorization: Bearer <token>". It is short-lived (DJANGO_JWT_ACCESS_MINUTES, default 15).
  - The REFRESH token is never put in a response body. It lives only in an HttpOnly cookie scoped to /api/auth/, so page
    scripts cannot read it and it is not sent with ordinary data requests. Each refresh rotates it and blacklists the
    old one; logout blacklists it and clears the cookie.
  - CSRF: only refresh/ and logout/ act on the cookie. They are protected by SameSite=Strict on the cookie plus an
    Origin allow-list (CORS_ALLOWED_ORIGINS and the API's own origin). Data endpoints authenticate with the Bearer
    header only, which a cross-site page cannot attach, so they need no CSRF token.
"""

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import update_last_login
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.tokens import RefreshToken

from common.throttling import LoginRateThrottle

from .permissions import IsManager, can_manage_project_access, is_manager, role_of


class InvalidCredentials(AuthenticationFailed):
    default_detail = "Invalid username or password."
    default_code = "invalid_credentials"


class RefreshTokenInvalid(AuthenticationFailed):
    default_detail = "Your session has expired. Please sign in again."
    default_code = "token_not_valid"


class OriginNotAllowed(PermissionDenied):
    default_detail = "Request origin is not allowed."
    default_code = "origin_not_allowed"


def user_payload(user) -> dict:
    return {
        "id": user.id,
        "username": user.get_username(),
        "email": user.email,
        "role": role_of(user),
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
        "groups": sorted(user.groups.values_list("name", flat=True)),
        "can_manage_project_access": can_manage_project_access(user),
    }


def _session_response(user, refresh: RefreshToken, status_code=status.HTTP_200_OK) -> Response:
    response = Response(
        {
            "access": str(refresh.access_token),
            "token_type": "Bearer",
            "access_expires_in": int(jwt_settings.ACCESS_TOKEN_LIFETIME.total_seconds()),
            "user": user_payload(user),
        },
        status=status_code,
    )
    response.set_cookie(
        settings.JWT_REFRESH_COOKIE["name"],
        str(refresh),
        max_age=int(jwt_settings.REFRESH_TOKEN_LIFETIME.total_seconds()),
        path=settings.JWT_REFRESH_COOKIE["path"],
        domain=settings.JWT_REFRESH_COOKIE["domain"],
        secure=settings.JWT_REFRESH_COOKIE["secure"],
        httponly=True,
        samesite=settings.JWT_REFRESH_COOKIE["samesite"],
    )
    return response


def _clear_cookie(response: Response) -> Response:
    response.delete_cookie(
        settings.JWT_REFRESH_COOKIE["name"],
        path=settings.JWT_REFRESH_COOKIE["path"],
        domain=settings.JWT_REFRESH_COOKIE["domain"],
        samesite=settings.JWT_REFRESH_COOKIE["samesite"],
    )
    return response


def _check_origin(request) -> None:
    """Cookie endpoints only: refuse a browser request coming from a page that is not the frontend.

    Browsers always send Origin on POST; a request without it (curl, server-side code) carries no ambient cookie risk.
    """
    origin = request.headers.get("Origin")
    if origin is None:
        return
    own = f"{request.scheme}://{request.get_host()}"
    if origin != own and origin not in settings.CORS_ALLOWED_ORIGINS:
        raise OriginNotAllowed()


class _AuthEndpoint(APIView):
    # These endpoints read credentials from the body or the cookie, so a stale Authorization header must not block
    # them. The Bearer challenge keeps 401 (not 403) for failed sign-ins.
    authentication_classes = []
    permission_classes = []

    def get_authenticate_header(self, request):
        return 'Bearer realm="api"'


class LoginView(_AuthEndpoint):
    throttle_classes = [*APIView.throttle_classes, LoginRateThrottle]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        username, password = data.get("username"), data.get("password")
        fields = {}
        if not isinstance(username, str) or not username.strip():
            fields["username"] = ["Enter your username."]
        if not isinstance(password, str) or not password:
            fields["password"] = ["Enter your password."]
        if fields:
            raise ValidationError(fields)

        # authenticate() returns None for a wrong password and for inactive users. A non-manager gets the same
        # answer as a wrong password so the response never reveals which accounts exist.
        user = authenticate(request, username=username.strip(), password=password)
        if not is_manager(user):
            raise InvalidCredentials()
        update_last_login(None, user)
        return _session_response(user, RefreshToken.for_user(user))


class RefreshView(_AuthEndpoint):
    def post(self, request):
        _check_origin(request)
        raw = request.COOKIES.get(settings.JWT_REFRESH_COOKIE["name"])
        if not raw:
            raise RefreshTokenInvalid("You are not signed in.")
        try:
            old = RefreshToken(raw)  # verifies signature, expiry and the blacklist
        except TokenError:
            return _clear_cookie(self.handle_exception(RefreshTokenInvalid()))

        user = get_user_model().objects.filter(pk=old.payload.get(jwt_settings.USER_ID_CLAIM)).first()
        old.blacklist()  # rotation: a refresh token works once
        if not is_manager(user):  # deleted, deactivated or no longer staff since sign-in
            return _clear_cookie(self.handle_exception(RefreshTokenInvalid()))
        return _session_response(user, RefreshToken.for_user(user))


class LogoutView(_AuthEndpoint):
    def post(self, request):
        _check_origin(request)
        raw = request.COOKIES.get(settings.JWT_REFRESH_COOKIE["name"])
        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass  # already expired or revoked: signing out still succeeds
        return _clear_cookie(Response(status=status.HTTP_204_NO_CONTENT))


class MeView(APIView):
    # Always protected, whatever DJANGO_API_REQUIRE_AUTH says.
    permission_classes = [IsManager]

    def get(self, request):
        return Response(user_payload(request.user))
