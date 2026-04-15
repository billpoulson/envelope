"""Unit tests for cli/envelope_run.py (opaque env URL builder and dotenv formatting)."""

import importlib.util
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "envelope_run_cli",
    Path(__file__).resolve().parent.parent / "cli" / "envelope_run.py",
)
assert _spec and _spec.loader
_er = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_er)


class BuildFetchUrlTests(unittest.TestCase):
    def test_root_deployment(self) -> None:
        u = _er.build_fetch_url("https://envelope.example.com", "a" * 16)
        self.assertEqual(
            u,
            f"https://envelope.example.com/env/{'a' * 16}?format=json",
        )

    def test_prefix_in_envelope_url(self) -> None:
        """Single Envelope URL includes gateway path prefix (no separate root-path param)."""
        u = _er.build_fetch_url("https://envelope.example.com/envelope", "b" * 16)
        self.assertEqual(
            u,
            f"https://envelope.example.com/envelope/env/{'b' * 16}?format=json",
        )

    def test_trailing_slash_stripped(self) -> None:
        u = _er.build_fetch_url("https://h.example.com/envelope/", "c" * 16)
        self.assertEqual(
            u,
            f"https://h.example.com/envelope/env/{'c' * 16}?format=json",
        )

    def test_token_length_bounds(self) -> None:
        with self.assertRaises(ValueError):
            _er.build_fetch_url("https://x.com", "x" * 15)
        with self.assertRaises(ValueError):
            _er.build_fetch_url("https://x.com", "y" * 257)


class FormatSecretsDotenvTests(unittest.TestCase):
    def test_sorted_keys_and_escapes(self) -> None:
        s = _er.format_secrets_dotenv({"B": "a\nb", "A": 'q"uote'})
        self.assertEqual(
            s,
            'A="q\\"uote"\nB="a\\nb"\n',
        )


if __name__ == "__main__":
    unittest.main()
