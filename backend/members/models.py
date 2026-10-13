from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.functions import Lower

MAX_LOAD = 200
STRETCHED_THRESHOLD = 100  # load strictly above this counts as "stretched"


class Member(models.Model):
    name = models.CharField(max_length=120)
    title = models.CharField(max_length=120)
    department = models.CharField(max_length=120)
    load = models.PositiveSmallIntegerField(
        default=60, validators=[MinValueValidator(0), MaxValueValidator(MAX_LOAD)]
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="member_name_ci_unique"),
            models.CheckConstraint(
                condition=models.Q(load__gte=0, load__lte=MAX_LOAD), name="member_load_0_200"
            ),
        ]

    def __str__(self):
        return self.name

    @property
    def stretched(self) -> bool:
        return self.load > STRETCHED_THRESHOLD
