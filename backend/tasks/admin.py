from django.contrib import admin

from .models import Task


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "project", "owner", "due_date", "state", "priority")
    list_filter = ("state", "priority", "project")
    search_fields = ("title", "note", "project__name", "owner__name")
    ordering = ("due_date", "id")
    autocomplete_fields = ("project", "owner")
    readonly_fields = ("created_at", "updated_at")
