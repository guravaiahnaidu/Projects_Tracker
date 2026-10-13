from django.urls import path

from .views import DepartmentListView, MemberDetailView, MemberListView

urlpatterns = [
    path("members/", MemberListView.as_view()),
    path("members/departments/", DepartmentListView.as_view()),
    path("members/<int:pk>/", MemberDetailView.as_view()),
]
