"""Tests for Settings (env) normalization."""

import unittest

from app.config import Settings


class SettingsRootPathTests(unittest.TestCase):
    def test_empty_string(self) -> None:
        s = Settings(root_path="")
        self.assertEqual(s.root_path, "")

    def test_adds_leading_slash(self) -> None:
        s = Settings(root_path="envelope")
        self.assertEqual(s.root_path, "/envelope")

    def test_strips_trailing_slash(self) -> None:
        s = Settings(root_path="/envelope/")
        self.assertEqual(s.root_path, "/envelope")

    def test_single_slash_normalizes_to_empty(self) -> None:
        """Validator strips trailing slashes; lone `/` becomes empty (no prefix)."""
        s = Settings(root_path="/")
        self.assertEqual(s.root_path, "")


if __name__ == "__main__":
    unittest.main()
