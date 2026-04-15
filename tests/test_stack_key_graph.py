"""Unit tests for stack key graph payload (override lineage)."""

import unittest

from app.services.stacks import stack_key_graph_payload


class StackKeyGraphPayloadTests(unittest.TestCase):
    def test_empty_maps(self) -> None:
        self.assertEqual(
            stack_key_graph_payload([], []),
            {"layers": [], "rows": [], "secret_values_included": True},
        )

    def test_single_layer(self) -> None:
        p = stack_key_graph_payload(
            [{"A": ("1", False), "B": ("x", True)}],
            ["only"],
            ["/bundles/only/edit"],
        )
        self.assertTrue(p["secret_values_included"])
        self.assertEqual(len(p["layers"]), 1)
        self.assertEqual(p["layers"][0]["bundle"], "only")
        self.assertEqual(p["layers"][0]["bundle_edit_path"], "/bundles/only/edit")
        self.assertIsNone(p["layers"][0].get("display_label"))

    def test_custom_layer_display_label(self) -> None:
        p = stack_key_graph_payload(
            [{"K": ("a", False)}],
            ["bun"],
            ["/bundles/bun/edit"],
            ["My label"],
        )
        self.assertTrue(p["secret_values_included"])
        self.assertEqual(p["layers"][0]["display_label"], "My label")
        self.assertEqual(p["layers"][0]["label"], "My label · bottom")
        rows = {r["key"]: r for r in p["rows"]}
        r = rows["K"]
        self.assertEqual(r["cells"], ["a"])
        self.assertEqual(r["cell_secrets"], [False])
        self.assertEqual(r["cells_value_present"], [True])
        self.assertEqual(r["cells_secret_redacted"], [False])
        self.assertEqual(r["merged_secret"], False)
        self.assertEqual(r["merged_value_redacted"], False)
        self.assertEqual(r["winner_layer_index"], 0)
        self.assertEqual(r["merged"], "a")
        self.assertEqual(r["cells_alias_source"], [None])

    def test_cells_alias_source_metadata(self) -> None:
        p = stack_key_graph_payload(
            [
                {"OIDC_KEY": ("a", False)},
                {"VITE_OIDC_KEY": ("a", False)},
            ],
            ["l0", "l1"],
            None,
            None,
            [{}, {"VITE_OIDC_KEY": "OIDC_KEY"}],
        )
        by = {r["key"]: r for r in p["rows"]}
        self.assertEqual(by["OIDC_KEY"]["cells_alias_source"], [None, None])
        self.assertEqual(by["VITE_OIDC_KEY"]["cells_alias_source"], [None, "OIDC_KEY"])

    def test_override_top_wins(self) -> None:
        p = stack_key_graph_payload(
            [
                {"K": ("a", False)},
                {"K": ("b", True)},
                {"K": ("c", False)},
            ],
            ["l0", "l1", "l2"],
        )
        row = next(r for r in p["rows"] if r["key"] == "K")
        self.assertEqual(row["cells"], ["a", "b", "c"])
        self.assertEqual(row["cell_secrets"], [False, True, False])
        self.assertEqual(row["cells_value_present"], [True, True, True])
        self.assertEqual(row["cells_secret_redacted"], [False, False, False])
        self.assertEqual(row["cells_alias_source"], [None, None, None])
        self.assertEqual(row["winner_layer_index"], 2)
        self.assertEqual(row["merged"], "c")
        self.assertEqual(row["merged_secret"], False)
        self.assertEqual(row["merged_value_redacted"], False)

    def test_all_layers_blank_no_merged(self) -> None:
        p = stack_key_graph_payload(
            [{"K": ("", False)}, {"K": ("  ", False)}],
            ["a", "b"],
        )
        row = next(r for r in p["rows"] if r["key"] == "K")
        self.assertEqual(row["cells_value_present"], [True, True])
        self.assertEqual(row["cells_secret_redacted"], [False, False])
        self.assertIsNone(row["winner_layer_index"])
        self.assertIsNone(row["merged"])
        self.assertIsNone(row["merged_secret"])
        self.assertFalse(row["merged_value_redacted"])

    def test_sparse_layers(self) -> None:
        p = stack_key_graph_payload(
            [
                {"X": ("only-bottom", False)},
                {"Y": ("only-mid", False)},
                {"Z": ("only-top", True)},
            ],
            ["a", "b", "c"],
        )
        by = {r["key"]: r for r in p["rows"]}
        self.assertEqual(by["X"]["cells"], ["only-bottom", None, None])
        self.assertEqual(by["X"]["cell_secrets"], [False, None, None])
        self.assertEqual(by["X"]["cells_value_present"], [True, None, None])
        self.assertEqual(by["X"]["cells_secret_redacted"], [False, None, None])
        self.assertEqual(by["X"]["winner_layer_index"], 0)
        self.assertEqual(by["X"]["merged"], "only-bottom")
        self.assertEqual(by["X"]["merged_secret"], False)
        self.assertEqual(by["Y"]["cells"], [None, "only-mid", None])
        self.assertEqual(by["Y"]["winner_layer_index"], 1)
        self.assertEqual(by["Y"]["merged"], "only-mid")
        self.assertEqual(by["Y"]["merged_secret"], False)
        self.assertEqual(by["Z"]["cells"], [None, None, "only-top"])
        self.assertEqual(by["Z"]["winner_layer_index"], 2)
        self.assertEqual(by["Z"]["merged"], "only-top")
        self.assertEqual(by["Z"]["merged_secret"], True)
        self.assertEqual(by["Z"]["cells_secret_redacted"], [None, None, False])

    def test_redacts_secret_cells_when_disabled(self) -> None:
        p = stack_key_graph_payload(
            [
                {"K": ("a", False)},
                {"K": ("secret-val", True)},
            ],
            ["l0", "l1"],
            include_secret_values=False,
        )
        self.assertFalse(p["secret_values_included"])
        row = next(r for r in p["rows"] if r["key"] == "K")
        self.assertEqual(row["cells"], ["a", None])
        self.assertEqual(row["cell_secrets"], [False, True])
        self.assertEqual(row["cells_value_present"], [True, True])
        self.assertEqual(row["cells_secret_redacted"], [False, True])
        self.assertEqual(row["winner_layer_index"], 1)
        self.assertIsNone(row["merged"])
        self.assertTrue(row["merged_secret"])
        self.assertTrue(row["merged_value_redacted"])

    def test_redaction_non_secret_winner_with_secret_lower_layer(self) -> None:
        p = stack_key_graph_payload(
            [
                {"K": ("bottom-sec", True)},
                {"K": ("top-plain", False)},
            ],
            ["l0", "l1"],
            include_secret_values=False,
        )
        row = next(r for r in p["rows"] if r["key"] == "K")
        self.assertEqual(row["cells"], [None, "top-plain"])
        self.assertEqual(row["cells_secret_redacted"], [True, False])
        self.assertEqual(row["winner_layer_index"], 1)
        self.assertEqual(row["merged"], "top-plain")
        self.assertEqual(row["merged_secret"], False)
        self.assertFalse(row["merged_value_redacted"])


if __name__ == "__main__":
    unittest.main()
