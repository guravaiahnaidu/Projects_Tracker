from django.contrib import admin
from django.urls import include, path, re_path

from dashboard.views import TodayView, WeeklyBriefView
from projects.views import DecisionHistoryListView

from .views import api_not_found

handler500 = "config.views.server_error"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("members/", include("members.urls")),
    path("projects/", include("projects.urls")),
    path("tasks/", include("tasks.urls")),
    path("activity/", include("activity.urls")),
    path("daily-updates/", include("updates.urls")),
    path("dashboard/", include("dashboard.urls")),
    # Single endpoints that do not belong to an app prefix
    path("decision-history/", DecisionHistoryListView.as_view()),
    path("today/", TodayView.as_view()),
    path("weekly-brief/", WeeklyBriefView.as_view()),
    # Must stay last: any URL that matched no endpoint above (JSON 404, or a 308 when only the trailing slash is missing).
    re_path(r"^(?P<path>.*)$", api_not_found),
]
