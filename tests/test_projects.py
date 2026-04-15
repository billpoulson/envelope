"""Tests for project name/slug validation and slug suggestions."""

import unittest

from fastapi import HTTPException

from app.services.projects import slug_suggestion_from_name, validate_project_name, validate_project_slug


class ValidateProjectSlugTests(unittest.TestCase):
    def test_valid(self) -> None:
        validate_project_slug("my-app")
        validate_project_slug("a1")

    def test_empty_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_project_slug("")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_uppercase_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_project_slug("MyApp")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_reserved_rejected(self) -> None:
        for slug in ("new", "edit", "groups"):
            with self.subTest(slug=slug):
                with self.assertRaises(HTTPException) as ctx:
                    validate_project_slug(slug)
                self.assertEqual(ctx.exception.status_code, 400)


class ValidateProjectNameTests(unittest.TestCase):
    def test_valid(self) -> None:
        validate_project_name("My Project 1")

    def test_empty_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_project_name("   ")
        self.assertEqual(ctx.exception.status_code, 400)


class SlugSuggestionTests(unittest.TestCase):
    def test_basic(self) -> None:
        self.assertEqual(slug_suggestion_from_name("My Cool App"), "my-cool-app")

    def test_reserved_gets_suffix(self) -> None:
        self.assertEqual(slug_suggestion_from_name("new"), "new-1")

    def test_empty_name_becomes_project(self) -> None:
        self.assertEqual(slug_suggestion_from_name("@@@"), "project")


if __name__ == "__main__":
    unittest.main()
