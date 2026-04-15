"""Shared query parameters for disambiguating bundle/stack API paths."""

from fastapi import Query

from app.services.project_environments import UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL


def _sanitize_query_environment_slug(raw: str | None) -> str | None:
    """Strip accidental ``?key=...`` suffix when clients send a malformed ``environment_slug`` query."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if "?" in s:
        s = s.split("?", 1)[0].strip()
    return s or None


class ResourcePathScope:
    """Optional ``project_slug`` + ``environment_slug`` when names repeat per environment."""

    def __init__(
        self,
        project_slug: str | None = Query(
            None,
            description="When set, restrict to this project (required if several bundles/stacks share the path name).",
        ),
        environment_slug: str | None = Query(
            None,
            description=(
                "Environment slug within the project, or "
                f"{UNASSIGNED_ENVIRONMENT_SLUG_SENTINEL!r} for resources not assigned to an environment."
            ),
        ),
    ) -> None:
        self.project_slug = project_slug
        self.environment_slug = _sanitize_query_environment_slug(environment_slug)
