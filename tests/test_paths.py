"""Tests for URL path helpers (gateway root prefix)."""

import unittest
from unittest.mock import MagicMock, patch

from app.paths import url_path


class UrlPathTests(unittest.TestCase):
    def _mock_settings(self, root_path: str) -> MagicMock:
        s = MagicMock()
        s.root_path = root_path
        return s

    @patch("app.paths.get_settings")
    def test_no_prefix_preserves_path(self, gs: MagicMock) -> None:
        gs.return_value = self._mock_settings("")
        self.assertEqual(url_path("/bundles"), "/bundles")
        self.assertEqual(url_path("bundles"), "/bundles")

    @patch("app.paths.get_settings")
    def test_no_prefix_root(self, gs: MagicMock) -> None:
        gs.return_value = self._mock_settings("")
        self.assertEqual(url_path("/"), "/")
        self.assertEqual(url_path(""), "/")

    @patch("app.paths.get_settings")
    def test_with_prefix_appends(self, gs: MagicMock) -> None:
        gs.return_value = self._mock_settings("/envelope")
        self.assertEqual(url_path("/bundles"), "/envelope/bundles")
        self.assertEqual(url_path("/app/foo"), "/envelope/app/foo")

    @patch("app.paths.get_settings")
    def test_with_prefix_root_becomes_prefix_only(self, gs: MagicMock) -> None:
        gs.return_value = self._mock_settings("/envelope")
        self.assertEqual(url_path("/"), "/envelope")

    @patch("app.paths.get_settings")
    def test_prefix_without_leading_slash_normalized_by_settings(self, gs: MagicMock) -> None:
        """Settings validator adds leading slash; url_path assumes normalized root."""
        gs.return_value = self._mock_settings("/v1")
        self.assertEqual(url_path("/x"), "/v1/x")


if __name__ == "__main__":
    unittest.main()
