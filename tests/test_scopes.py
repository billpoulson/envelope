"""Tests for API key scope parsing and authorization helpers."""

import unittest

from fastapi import HTTPException

from app.services.scopes import (
    can_create_bundle,
    can_create_project,
    can_create_stack,
    can_read_bundle,
    can_read_stack,
    can_write_bundle,
    parse_scopes_json,
    scopes_to_json,
    validate_scopes_list,
)


class ParseScopesJsonTests(unittest.TestCase):
    def test_empty_defaults_to_read_all_bundles(self) -> None:
        self.assertEqual(parse_scopes_json(None), ["read:bundle:*"])
        self.assertEqual(parse_scopes_json(""), ["read:bundle:*"])
        self.assertEqual(parse_scopes_json("   "), ["read:bundle:*"])

    def test_invalid_json_defaults(self) -> None:
        self.assertEqual(parse_scopes_json("{not json"), ["read:bundle:*"])

    def test_non_list_defaults(self) -> None:
        self.assertEqual(parse_scopes_json('{"x":1}'), ["read:bundle:*"])

    def test_list_strips_and_filters_empty(self) -> None:
        self.assertEqual(
            parse_scopes_json('["read:bundle:a", "", "  ", "write:bundle:*"]'),
            ["read:bundle:a", "write:bundle:*"],
        )


class ScopesToJsonTests(unittest.TestCase):
    def test_round_trip_compact(self) -> None:
        scopes = ["read:bundle:x", "admin"]
        self.assertEqual(parse_scopes_json(scopes_to_json(scopes)), scopes)


class ValidateScopesListTests(unittest.TestCase):
    def test_empty_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_scopes_list([])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_admin_alone_ok(self) -> None:
        validate_scopes_list(["admin"])

    def test_admin_with_other_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_scopes_list(["admin", "read:bundle:*"])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_unknown_scope_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_scopes_list(["read:foo:*"])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_bare_prefix_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_scopes_list(["read:bundle:"])
        self.assertEqual(ctx.exception.status_code, 400)


class CanReadBundleTests(unittest.TestCase):
    def test_glob_match(self) -> None:
        self.assertTrue(
            can_read_bundle(
                ["read:bundle:prod-*"],
                bundle_name="prod-api",
                group_id=None,
                project_name=None,
            )
        )

    def test_no_match(self) -> None:
        self.assertFalse(
            can_read_bundle(
                ["read:bundle:staging-*"],
                bundle_name="prod-api",
                group_id=None,
                project_name=None,
            )
        )

    def test_project_read_by_slug(self) -> None:
        self.assertTrue(
            can_read_bundle(
                ["read:project:slug:my-app"],
                bundle_name="any",
                group_id=1,
                project_name="My App",
                project_slug="my-app",
            )
        )


class CanWriteBundleTests(unittest.TestCase):
    def test_write_project_wildcard(self) -> None:
        self.assertTrue(
            can_write_bundle(
                ["write:project:*"],
                bundle_name="b",
                group_id=2,
                project_name="P",
                project_slug="p",
            )
        )


class CanReadStackTests(unittest.TestCase):
    def test_stack_glob(self) -> None:
        self.assertTrue(
            can_read_stack(
                ["read:stack:default"],
                stack_name="default",
                group_id=None,
                project_name=None,
            )
        )


class CanCreateStackTests(unittest.TestCase):
    def test_ungrouped_requires_write_stack(self) -> None:
        self.assertTrue(
            can_create_stack(
                ["write:stack:*"],
                stack_name="s",
                group_id=None,
                project_name=None,
            )
        )
        self.assertFalse(
            can_create_stack(
                ["read:stack:*"],
                stack_name="s",
                group_id=None,
                project_name=None,
            )
        )

    def test_grouped_needs_project_context(self) -> None:
        self.assertFalse(
            can_create_stack(
                ["write:project:slug:x"],
                stack_name="s",
                group_id=1,
                project_name="X",
                project_slug=None,
            )
        )


class CanCreateBundleTests(unittest.TestCase):
    def test_ungrouped_write_bundle(self) -> None:
        self.assertTrue(
            can_create_bundle(
                ["write:bundle:*"],
                bundle_name="b",
                group_id=None,
                project_name=None,
            )
        )


class CanCreateProjectTests(unittest.TestCase):
    def test_admin(self) -> None:
        self.assertTrue(can_create_project(["admin"]))

    def test_write_project_star(self) -> None:
        self.assertTrue(can_create_project(["write:project:*"]))

    def test_read_only_false(self) -> None:
        self.assertFalse(can_create_project(["read:project:*"]))


if __name__ == "__main__":
    unittest.main()
