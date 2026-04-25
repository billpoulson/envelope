"""Unit tests for cli/envelope_run.py and the reusable action metadata."""

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
_ACTION_YML = _repo_root / ".github" / "actions" / "envelope-env" / "action.yml"
_ACTION_NODE = _repo_root / ".github" / "actions" / "envelope-env" / "envelope_env.js"


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
    def test_sorted_keys_and_raw_values(self) -> None:
        s = _er.format_secrets_dotenv(
            {
                "B": "plain",
                "A": "['https://exhelion.net/auth/callback']",
                "C": "'http://localhost/auth/callback'",
            }
        )
        self.assertEqual(
            s,
            "A=['https://exhelion.net/auth/callback']\n"
            "B=plain\n"
            "C='http://localhost/auth/callback'\n",
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


class ActionMetadataTests(unittest.TestCase):
    def test_action_uses_node_entrypoint(self) -> None:
        action_text = _ACTION_YML.read_text(encoding="utf-8")
        self.assertIn("using: node20", action_text)
        self.assertIn("main: envelope_env.js", action_text)
        self.assertTrue(_ACTION_NODE.exists())

    def test_python_helper_is_still_available_for_vendored_users(self) -> None:
        self.assertTrue(
            _ACTION_ENVELOPE_RUN.exists(),
            "keep envelope_run.py available for users who vendored the older action",
        )


if __name__ == "__main__":
    unittest.main()
