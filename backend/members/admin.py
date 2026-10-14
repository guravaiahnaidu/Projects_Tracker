from django.contrib import admin

from .models import Member


@admin.register(Member)
class MemberAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "title", "department", "load", "created_at")
    list_filter = ("department",)
    search_fields = ("name", "title", "department")
    ordering = ("name",)
    readonly_fields = ("created_at", "updated_at")
