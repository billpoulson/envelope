"""Stack layer key aliases (export name -> source key from merged layers below)."""

import unittest

from app.services.stacks import (
    _apply_layer_aliases_to_entry_map,
    _apply_layer_aliases_to_str_map,
    normalize_layer_aliases_map,
)


class NormalizeLayerAliasesTests(unittest.TestCase):
    def test_empty(self) -> None:
        self.assertIsNone(normalize_layer_aliases_map(None))
        self.assertIsNone(normalize_layer_aliases_map({}))

    def test_ok(self) -> None:
        m = normalize_layer_aliases_map({"VITE_OIDC_KEY": "OIDC_KEY"})
        self.assertEqual(m, {"VITE_OIDC_KEY": "OIDC_KEY"})

    def test_rejects_same_target_source(self) -> None:
        with self.assertRaises(ValueError):
            normalize_layer_aliases_map({"FOO": "FOO"})


class ApplyLayerAliasMapsTests(unittest.TestCase):
    def test_str_map_copies_from_prefix(self) -> None:
        prefix = {"OIDC_KEY": "sec"}
        sm: dict[str, str] = {}
        _apply_layer_aliases_to_str_map(prefix, sm, {"VITE_OIDC_KEY": "OIDC_KEY"})
        self.assertEqual(sm["VITE_OIDC_KEY"], "sec")

    def test_entry_map_preserves_secret_flag(self) -> None:
        prefix = {"OIDC_KEY": ("top-secret", True)}
        row: dict[str, tuple[str, bool]] = {}
        _apply_layer_aliases_to_entry_map(
            prefix, row, {"VITE_OIDC_KEY": "OIDC_KEY"}
        )
        self.assertEqual(row["VITE_OIDC_KEY"], ("top-secret", True))


if __name__ == "__main__":
    unittest.main()
