"""Unit tests for stack key graph payload (override lineage)."""

import unittest

from app.services.stacks import stack_key_graph_payload


class StackKeyGraphPayloadTests(unittest.TestCase):
    def test_empty_maps(self) -> None:
        self.assertEqual(stack_key_graph_payload([], []), {"layers": [], "rows": []})

    def test_single_layer(self) -> None:
        p = stack_key_graph_payload(
            [{"A": ("1", False), "B": ("x", True)}],
            ["only"],
            ["/bundles/only/edit"],
        )
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
        self.assertEqual(p["layers"][0]["display_label"], "My label")
        self.assertEqual(p["layers"][0]["label"], "My label · bottom")
        rows = {r["key"]: r for r in p["rows"]}
        self.assertEqual(rows["K"]["cells"], ["a"])
        self.assertEqual(rows["K"]["cell_secrets"], [False])
        self.assertEqual(rows["K"]["merged_secret"], False)
        self.assertEqual(rows["K"]["winner_layer_index"], 0)
        self.assertEqual(rows["K"]["merged"], "a")

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
        self.assertEqual(row["winner_layer_index"], 2)
        self.assertEqual(row["merged"], "c")
        self.assertEqual(row["merged_secret"], False)

    def test_all_layers_blank_no_merged(self) -> None:
        p = stack_key_graph_payload(
            [{"K": ("", False)}, {"K": ("  ", False)}],
            ["a", "b"],
        )
        row = next(r for r in p["rows"] if r["key"] == "K")
        self.assertIsNone(row["winner_layer_index"])
        self.assertIsNone(row["merged"])
        self.assertIsNone(row["merged_secret"])

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


if __name__ == "__main__":
    unittest.main()
