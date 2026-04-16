import hashlib
import hmac
import secrets

from passlib.context import CryptContext

KEY_PREFIX = "env_"

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def generate_raw_api_key() -> str:
    return KEY_PREFIX + secrets.token_hex(32)


def key_lookup_hmac(raw: str, master_key: str) -> str:
    """Stable 64-char hex digest for indexed API key lookup (HMAC-SHA256)."""
    mk = master_key.strip().encode("utf-8")
    hmac_key = hashlib.sha256(mk).digest()
    return hmac.new(hmac_key, raw.encode("utf-8"), hashlib.sha256).hexdigest()


def hash_api_key(raw: str) -> str:
    return _pwd.hash(raw)


def verify_api_key(raw: str, key_hash: str) -> bool:
    return _pwd.verify(raw, key_hash)
