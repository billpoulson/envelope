"""Unit tests for passphrase backup envelope (Scrypt + AES-GCM)."""

import unittest

from app.services.backup_crypto import (
    BackupCryptoError,
    WrongPassphraseError,
    decrypt_bytes,
    encrypt_bytes,
)


class BackupCryptoTests(unittest.TestCase):
    def test_round_trip(self) -> None:
        plain = b'{"hello": "world"}'
        enc = encrypt_bytes(plain, "correct horse battery staple")
        out = decrypt_bytes(enc, "correct horse battery staple")
        self.assertEqual(out, plain)

    def test_wrong_passphrase(self) -> None:
        enc = encrypt_bytes(b"secret", "pw-one")
        with self.assertRaises(WrongPassphraseError):
            decrypt_bytes(enc, "pw-two")

    def test_empty_passphrase_rejected(self) -> None:
        with self.assertRaises(BackupCryptoError):
            encrypt_bytes(b"x", "")
        with self.assertRaises(BackupCryptoError):
            decrypt_bytes(b"not-valid-anyway", "")

    def test_tampered_ciphertext(self) -> None:
        enc = encrypt_bytes(b"data", "pw")
        bad = bytearray(enc)
        if len(bad) > 20:
            bad[-5] ^= 0xFF
        with self.assertRaises(WrongPassphraseError):
            decrypt_bytes(bytes(bad), "pw")


if __name__ == "__main__":
    unittest.main()
