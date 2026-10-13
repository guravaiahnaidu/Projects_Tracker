from django.http import JsonResponse
from django.http.response import HttpResponseRedirectBase
from django.urls import Resolver404, resolve
from django.views.decorators.csrf import csrf_exempt


class HttpResponsePermanentRedirectKeepMethod(HttpResponseRedirectBase):
    status_code = 308


@csrf_exempt
def api_not_found(request, path=""):
    """Fallback for /api/v1/ URLs that match no endpoint.

    - A URL that only lacks its trailing slash is redirected with 308, which (unlike 301/302) keeps the HTTP
      method and body, so a POST to /api/v1/tasks is not silently turned into a GET.
    - Everything else gets the standard JSON error envelope instead of Django's HTML 404 page.
    """
    if not request.path.endswith("/"):
        try:
            match = resolve(request.path_info + "/")
        except Resolver404:
            match = None
        if match is not None and match.func is not api_not_found:
            target = request.path + "/"
            query = request.META.get("QUERY_STRING")
            return HttpResponsePermanentRedirectKeepMethod(f"{target}?{query}" if query else target)
    return JsonResponse(
        {"error": {"code": "not_found", "message": "No such API endpoint.", "fields": {}}}, status=404
    )
