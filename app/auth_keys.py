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


def device_code_lookup_hmac(raw: str, master_key: str) -> str:
    """Indexed digest for CLI device flow (never store raw device_code)."""
    mk = master_key.strip().encode("utf-8")
    hmac_key = hashlib.sha256(b"envelope-cli-device-v1|" + mk).digest()
    return hmac.new(hmac_key, raw.encode("utf-8"), hashlib.sha256).hexdigest()
