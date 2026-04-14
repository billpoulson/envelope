"""Tests for bundle initial paste parsers (import kinds)."""

import unittest

from app.services.bundles import (
    parse_bundle_initial_paste,
    parse_bundle_entries_json,
)


class JsonObjectKindTests(unittest.TestCase):
    def test_empty(self) -> None:
        rows, err = parse_bundle_initial_paste("", "json_object")
        self.assertIsNone(err)
        self.assertEqual(rows, [])

    def test_plain_object(self) -> None:
        raw = '{"A": "b", "C": "d"}'
        rows, err = parse_bundle_initial_paste(raw, "json_object")
        self.assertIsNone(err)
        self.assertEqual(len(rows), 2)
        keys = {r[0] for r in rows}
        self.assertEqual(keys, {"A", "C"})

    def test_invalid_not_object(self) -> None:
        rows, err = parse_bundle_initial_paste('["a=b"]', "json_object")
        self.assertIsNotNone(err)
        self.assertIn("object", err.lower())
        self.assertEqual(rows, [])

    def test_parse_bundle_entries_json_compat(self) -> None:
        rows, err = parse_bundle_entries_json('{"X": "y"}')
        self.assertIsNone(err)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "X")


class JsonArrayKindTests(unittest.TestCase):
    def test_kv_strings(self) -> None:
        raw = '["NODE_ENV=production", "LOG_LEVEL=info"]'
        rows, err = parse_bundle_initial_paste(raw, "json_array")
        self.assertIsNone(err)
        self.assertEqual(
            {(r[0], r[1], r[2]) for r in rows},
            {("NODE_ENV", "production", True), ("LOG_LEVEL", "info", True)},
        )

    def test_value_with_equals(self) -> None:
        raw = '["URL=https://x.example/a=b"]'
        rows, err = parse_bundle_initial_paste(raw, "json_array")
        self.assertIsNone(err)
        self.assertEqual(rows[0][1], "https://x.example/a=b")

    def test_not_array(self) -> None:
        rows, err = parse_bundle_initial_paste("{}", "json_array")
        self.assertIsNotNone(err)
        self.assertEqual(rows, [])


class CsvQuotedKindTests(unittest.TestCase):
    def test_user_example(self) -> None:
        raw = '"AFFINITY_COOKIE_DOMAIN=exhelion.net","NODE_ENV=production",'
        rows, err = parse_bundle_initial_paste(raw, "csv_quoted")
        self.assertIsNone(err)
        self.assertEqual(
            {(r[0], r[1]) for r in rows},
            {("AFFINITY_COOKIE_DOMAIN", "exhelion.net"), ("NODE_ENV", "production")},
        )

    def test_no_trailing_comma(self) -> None:
        raw = '"A=b","C=d"'
        rows, err = parse_bundle_initial_paste(raw, "csv_quoted")
        self.assertIsNone(err)
        self.assertEqual(len(rows), 2)


class DotenvLinesKindTests(unittest.TestCase):
    def test_multiline(self) -> None:
        raw = "FOO=bar\n# comment\n\nBAZ=qux\n"
        rows, err = parse_bundle_initial_paste(raw, "dotenv_lines")
        self.assertIsNone(err)
        self.assertEqual(
            {(r[0], r[1]) for r in rows},
            {("FOO", "bar"), ("BAZ", "qux")},
        )

    def test_line_without_equals(self) -> None:
        rows, err = parse_bundle_initial_paste("not_a_line", "dotenv_lines")
        self.assertIsNotNone(err)
        self.assertEqual(rows, [])


if __name__ == "__main__":
    unittest.main()
