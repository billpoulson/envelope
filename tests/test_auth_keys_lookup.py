"""Unit tests for API key lookup HMAC helper."""

import unittest

from app.auth_keys import key_lookup_hmac


class KeyLookupHmacTests(unittest.TestCase):
    def test_deterministic_and_hex_length(self) -> None:
        a = key_lookup_hmac("env_abc", "master")
        b = key_lookup_hmac("env_abc", "master")
        self.assertEqual(a, b)
        self.assertEqual(len(a), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in a))

    def test_differs_for_different_raw_or_master(self) -> None:
        self.assertNotEqual(
            key_lookup_hmac("env_aaa", "master"),
            key_lookup_hmac("env_aab", "master"),
        )
        self.assertNotEqual(
            key_lookup_hmac("same", "m1"),
            key_lookup_hmac("same", "m2"),
        )


if __name__ == "__main__":
    unittest.main()
