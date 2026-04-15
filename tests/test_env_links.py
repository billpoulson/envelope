"""Tests for opaque env link token helpers."""

import hashlib
import unittest

from app.services.env_links import new_env_link_token, token_sha256_hex


class EnvLinkTokenTests(unittest.TestCase):
    def test_sha_matches_manual_hash(self) -> None:
        raw = "test-token"
        expected = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        self.assertEqual(token_sha256_hex(raw), expected)

    def test_new_token_digest_matches_token_sha256(self) -> None:
        raw, digest = new_env_link_token()
        self.assertEqual(len(digest), 64)
        self.assertEqual(token_sha256_hex(raw), digest)

    def test_raw_tokens_differ(self) -> None:
        a, _ = new_env_link_token()
        b, _ = new_env_link_token()
        self.assertNotEqual(a, b)


if __name__ == "__main__":
    unittest.main()
