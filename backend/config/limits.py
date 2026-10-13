"""Maximum lengths for free-text fields, enforced by the serializers.

The database columns for these fields are unbounded TEXT (changing them would need a migration of existing
data); the limits below are validation limits only. Chosen to be generous for real use while keeping a single
request, an activity-log line and the weekly brief a sensible size.
"""

PROJECT_DESCRIPTION_MAX = 5000  # a few paragraphs
PROJECT_DECISION_MAX = 1000  # one decision statement; it is also copied into activity text
TASK_NOTE_MAX = 2000  # "what is it waiting on"
