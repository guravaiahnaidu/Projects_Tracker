from django.urls import path

from .views import TaskCompleteView, TaskDetailView, TaskListView

urlpatterns = [
    path("tasks/", TaskListView.as_view()),
    path("tasks/<int:pk>/", TaskDetailView.as_view()),
    path("tasks/<int:pk>/complete/", TaskCompleteView.as_view()),
]
