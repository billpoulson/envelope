"""Passphrase-wrapped encryption for backup blobs (Scrypt + AES-256-GCM)."""

from __future__ import annotations

import asyncio
import os
import struct

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b"ENVCRYPT1"  # 8 bytes
VERSION = 1
_SALT_LEN = 32
_NONCE_LEN = 12
_KEY_LEN = 32
# AAD binds ciphertext to this format (version upgrades change AAD).
_AAD = b"envelope-backup-crypto-v1"

# OWASP-style memory-hard parameters (tune if needed for very slow clients).
_SCRYPT_N = 2**17
_SCRYPT_R = 8
_SCRYPT_P = 1


class BackupCryptoError(Exception):
    pass


class WrongPassphraseError(BackupCryptoError):
    pass


async def encrypt_bytes_async(plaintext: bytes, passphrase: str) -> bytes:
    """Run Scrypt + AES-GCM off the asyncio event loop (avoids starving other requests)."""
    return await asyncio.to_thread(encrypt_bytes, plaintext, passphrase)


def encrypt_bytes(plaintext: bytes, passphrase: str) -> bytes:
    if not passphrase:
        raise BackupCryptoError("passphrase is required")
    salt = os.urandom(_SALT_LEN)
    kdf = Scrypt(
        salt=salt,
        length=_KEY_LEN,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
    )
    key = kdf.derive(passphrase.encode("utf-8"))
    nonce = os.urandom(_NONCE_LEN)
    aes = AESGCM(key)
    ciphertext = aes.encrypt(nonce, plaintext, _AAD)
    return MAGIC + struct.pack(">B", VERSION) + salt + nonce + ciphertext


def decrypt_bytes(blob: bytes, passphrase: str) -> bytes:
    if not passphrase:
        raise BackupCryptoError("passphrase is required")
    if len(blob) < len(MAGIC) + 1 + _SALT_LEN + _NONCE_LEN + 16:
        raise BackupCryptoError("truncated or invalid backup file")
    if blob[: len(MAGIC)] != MAGIC:
        raise BackupCryptoError("unknown file format (bad magic)")
    ver = blob[len(MAGIC)]
    if ver != VERSION:
        raise BackupCryptoError(f"unsupported backup format version: {ver}")
    off = len(MAGIC) + 1
    salt = blob[off : off + _SALT_LEN]
    off += _SALT_LEN
    nonce = blob[off : off + _NONCE_LEN]
    off += _NONCE_LEN
    ciphertext = blob[off:]
    kdf = Scrypt(
        salt=salt,
        length=_KEY_LEN,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
    )
    key = kdf.derive(passphrase.encode("utf-8"))
    aes = AESGCM(key)
    try:
        return aes.decrypt(nonce, ciphertext, _AAD)
    except InvalidTag as e:
        raise WrongPassphraseError("decryption failed (wrong passphrase or corrupt data)") from e
