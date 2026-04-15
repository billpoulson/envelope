"""Unit tests for project environment validation helpers."""

import unittest

from fastapi import HTTPException

from app.services.project_environments import (
    slug_suggestion_from_name,
    validate_environment_name,
    validate_environment_slug,
)


class ValidateEnvironmentNameTests(unittest.TestCase):
    def test_ok(self) -> None:
        validate_environment_name("Production")
        validate_environment_name("E2E / staging")

    def test_empty(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_environment_name("  ")
        self.assertEqual(ctx.exception.status_code, 400)


class ValidateEnvironmentSlugTests(unittest.TestCase):
    def test_ok(self) -> None:
        validate_environment_slug("prod")
        validate_environment_slug("e2e-1")

    def test_uppercase_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_environment_slug("Prod")
        self.assertEqual(ctx.exception.status_code, 400)


class SlugSuggestionTests(unittest.TestCase):
    def test_basic(self) -> None:
        self.assertEqual(slug_suggestion_from_name("CI / E2E"), "ci-e2e")


if __name__ == "__main__":
    unittest.main()
