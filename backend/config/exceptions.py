"""Uniform JSON error envelope: {"error": {"code", "message", "fields"}}."""

from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.views import exception_handler


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The request conflicts with the current state."
    default_code = "conflict"


def _flatten(detail):
    if isinstance(detail, (list, tuple)):
        return [str(m) for m in detail]
    return [str(detail)]


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None

    fields = {}
    if isinstance(exc, ValidationError):
        data = response.data
        if isinstance(data, dict):
            fields = {k: _flatten(v) for k, v in data.items()}
            first = next(iter(fields.values()), ["Invalid request."])
            message = first[0]
        else:
            fields = {"non_field_errors": _flatten(data)}
            message = fields["non_field_errors"][0]
        code = "validation_error"
    else:
        message = str(getattr(exc, "detail", "Request failed."))
        code = getattr(exc, "default_code", "error")

    response.data = {"error": {"code": code, "message": message, "fields": fields}}
    return response
