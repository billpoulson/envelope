import secrets

from passlib.context import CryptContext

KEY_PREFIX = "env_"

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def generate_raw_api_key() -> str:
    return KEY_PREFIX + secrets.token_hex(32)


def hash_api_key(raw: str) -> str:
    return _pwd.hash(raw)


def verify_api_key(raw: str, key_hash: str) -> bool:
    return _pwd.verify(raw, key_hash)
