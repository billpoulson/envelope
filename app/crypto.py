from cryptography.fernet import Fernet, InvalidToken


class CryptoError(Exception):
    pass


def fernet_from_master_key(master_key: str) -> Fernet:
    key = master_key.strip().encode("ascii")
    return Fernet(key)


def encrypt_value(fernet: Fernet, plaintext: str) -> str:
    return fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_value(fernet: Fernet, token: str) -> str:
    try:
        return fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        raise CryptoError("decryption failed") from e
