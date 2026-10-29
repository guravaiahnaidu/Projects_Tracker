"""Encryption at rest for stored credentials (project access username / password).

Values are encrypted with Fernet (AES-128-CBC + HMAC). The key comes from DJANGO_FIELD_ENCRYPTION_KEY (a Fernet
key: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"); without it, a key
is derived from DJANGO_SECRET_KEY, so changing either one makes existing stored values unreadable.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _fernet() -> Fernet:
    key = getattr(settings, "FIELD_ENCRYPTION_KEY", "")
    if not key:
        key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest()).decode()
    return Fernet(key)


def encrypt(value: str) -> str:
    """Empty stays empty so "no value" is never stored as ciphertext."""
    return _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(token: str) -> str:
    """Empty for no value or a value that can no longer be read (key changed)."""
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return ""
