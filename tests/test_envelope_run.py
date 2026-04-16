"""Unit tests for cli/envelope_run.py (opaque env URL builder and dotenv formatting)."""

import importlib.util
import tempfile
import unittest
from pathlib import Path

_repo_root = Path(__file__).resolve().parent.parent

_spec = importlib.util.spec_from_file_location(
    "envelope_run_cli",
    _repo_root / "cli" / "envelope_run.py",
)
assert _spec and _spec.loader
_er = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_er)

_ACTION_ENVELOPE_RUN = _repo_root / ".github" / "actions" / "envelope-env" / "envelope_run.py"


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


class OpaqueUrlWithJsonFormatTests(unittest.TestCase):
    def test_no_query(self) -> None:
        u = _er.opaque_url_with_json_format(
            f"https://envelope.example.com/env/{'a' * 16}",
        )
        self.assertEqual(u, f"https://envelope.example.com/env/{'a' * 16}?format=json")

    def test_prefix_path(self) -> None:
        u = _er.opaque_url_with_json_format(
            f"https://envelope.example.com/envelope/env/{'b' * 16}",
        )
        self.assertEqual(
            u,
            f"https://envelope.example.com/envelope/env/{'b' * 16}?format=json",
        )

    def test_replaces_format_dotenv(self) -> None:
        u = _er.opaque_url_with_json_format(
            f"https://h.example.com/env/{'c' * 16}?format=dotenv",
        )
        self.assertEqual(
            u,
            f"https://h.example.com/env/{'c' * 16}?format=json",
        )

    def test_preserves_other_query_params(self) -> None:
        u = _er.opaque_url_with_json_format(
            f"https://h.example.com/env/{'d' * 16}?x=1",
        )
        self.assertIn("format=json", u)
        self.assertIn("x=1", u)


class AppendGithubEnvTests(unittest.TestCase):
    def test_multiline_value(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w+", delete=False, encoding="utf-8") as tf:
            path = tf.name
        try:
            _er.append_github_env({"K": "a\nb"}, path)
            body = Path(path).read_text(encoding="utf-8")
            self.assertIn("K<<", body)
            self.assertIn("a\nb", body)
        finally:
            Path(path).unlink(missing_ok=True)


class ActionEnvelopeRunCopyTests(unittest.TestCase):
    def test_matches_cli_byte_for_byte(self) -> None:
        cli_text = (_repo_root / "cli" / "envelope_run.py").read_bytes()
        action_text = _ACTION_ENVELOPE_RUN.read_bytes()
        self.assertEqual(
            cli_text,
            action_text,
            "copy .github/actions/envelope-env/envelope_run.py from cli/envelope_run.py",
        )


if __name__ == "__main__":
    unittest.main()
