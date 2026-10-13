from django.contrib import admin
from django.urls import include, path, re_path

from .views import api_not_found

urlpatterns = [
    path("admin/", admin.site.urls),
    path(
        "api/v1/",
        include(
            [
                path("", include("members.urls")),
                path("", include("projects.urls")),
                path("", include("tasks.urls")),
                path("", include("activity.urls")),
                path("", include("dashboard.urls")),
            ]
        ),
    ),
    # Must stay last: anything under /api/v1/ that matched no endpoint above.
    re_path(r"^api/v1/(?P<path>.*)$", api_not_found),
]
