from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.functions import Lower

MAX_LOAD = 200
STRETCHED_THRESHOLD = 100  # load strictly above this counts as "stretched"


class Status(models.TextChoices):
    ACTIVE = "active", "Active"
    ON_LEAVE = "on_leave", "On leave"
    INACTIVE = "inactive", "Inactive"


class EmploymentType(models.TextChoices):
    FULL_TIME = "full_time", "Full-time"
    PART_TIME = "part_time", "Part-time"
    CONTRACT = "contract", "Contract"
    INTERN = "intern", "Intern"


class Member(models.Model):
    name = models.CharField(max_length=120)
    title = models.CharField(max_length=120)
    department = models.CharField(max_length=120)
    email = models.EmailField(max_length=254, blank=True, default="")  # stored lower-case; "" = not given
    phone = models.CharField(max_length=32, blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    employment_type = models.CharField(
        max_length=16, choices=EmploymentType.choices, default=EmploymentType.FULL_TIME
    )
    start_date = models.DateField(null=True, blank=True)
    load = models.PositiveSmallIntegerField(
        default=60, validators=[MinValueValidator(0), MaxValueValidator(MAX_LOAD)]
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="member_name_ci_unique"),
            models.UniqueConstraint(
                Lower("email"), condition=~models.Q(email=""), name="member_email_ci_unique"
            ),
            models.CheckConstraint(
                condition=models.Q(load__gte=0, load__lte=MAX_LOAD), name="member_load_0_200"
            ),
        ]

    def __str__(self):
        return self.name

    @property
    def stretched(self) -> bool:
        return self.load > STRETCHED_THRESHOLD
