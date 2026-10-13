from django.urls import path

from . import views

urlpatterns = [
    path("dashboard/summary/", views.SummaryView.as_view()),
    path("dashboard/attention/", views.AttentionView.as_view()),
    path("dashboard/key-dates/", views.KeyDatesView.as_view()),
    path("dashboard/team-workload/", views.TeamWorkloadView.as_view()),
    path("dashboard/decisions/", views.DecisionsView.as_view()),
    path("today/", views.TodayView.as_view()),
    path("weekly-brief/", views.WeeklyBriefView.as_view()),
]
