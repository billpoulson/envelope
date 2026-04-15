"""API key scope matching: admin, read/write on bundles and projects, with fnmatch wildcards."""

from __future__ import annotations

import json
import re
from fnmatch import fnmatchcase

from fastapi import HTTPException

# Tokens: read:project:slug:my-app | read:project:id:7 (legacy) | read:project:* | name glob

_ADMIN = "admin"
# Terraform HTTP backend for remote state (HashiCorp docs: backend "http").
_TERRAFORM_HTTP_STATE = "terraform:http_state"
# Deprecated: accepted for existing keys only.
_LEGACY_PULUMI_STATE_SCOPE = "pulumi:state"
_READ_BUNDLE = "read:bundle:"
_WRITE_BUNDLE = "write:bundle:"
_READ_STACK = "read:stack:"
_WRITE_STACK = "write:stack:"
_READ_PROJECT = "read:project:"
_WRITE_PROJECT = "write:project:"

_ID_SUFFIX = re.compile(r"^id:(\d+)$")
_SLUG_SUFFIX = re.compile(r"^slug:([^:]+)$")


def parse_scopes_json(raw: str | None) -> list[str]:
    """Parse stored JSON array; invalid or empty defaults to read-all-bundles."""
    if not raw or not str(raw).strip():
        return ["read:bundle:*"]
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return ["read:bundle:*"]
    if not isinstance(data, list):
        return ["read:bundle:*"]
    out = [str(x).strip() for x in data if str(x).strip()]
    return out if out else ["read:bundle:*"]


def scopes_to_json(scopes: list[str]) -> str:
    return json.dumps(scopes, separators=(",", ":"))


def scopes_allow_admin(scopes: list[str]) -> bool:
    return _ADMIN in scopes


def scopes_allow_terraform_http_state(scopes: list[str]) -> bool:
    if _ADMIN in scopes:
        return True
    if _TERRAFORM_HTTP_STATE in scopes:
        return True
    if _LEGACY_PULUMI_STATE_SCOPE in scopes:
        return True
    return False


def validate_scopes_list(scopes: list[str]) -> None:
    if not scopes:
        raise HTTPException(status_code=400, detail="scopes must be a non-empty JSON array")
    if _ADMIN in scopes and len(scopes) > 1:
        raise HTTPException(
            status_code=400,
            detail='"admin" cannot be combined with other scopes',
        )
    for s in scopes:
        if s == _ADMIN:
            continue
        if s in (_TERRAFORM_HTTP_STATE, _LEGACY_PULUMI_STATE_SCOPE):
            continue
        if s.startswith(_READ_BUNDLE):
            if len(s) <= len(_READ_BUNDLE):
                raise HTTPException(status_code=400, detail=f"Invalid scope: {s!r}")
            continue
        if s.startswith(_WRITE_BUNDLE):
            if len(s) <= len(_WRITE_BUNDLE):
                raise HTTPException(status_code=400, detail=f"Invalid scope: {s!r}")
            continue
        if s.startswith(_READ_STACK):
            if len(s) <= len(_READ_STACK):
                raise HTTPException(status_code=400, detail=f"Invalid scope: {s!r}")
            continue
        if s.startswith(_WRITE_STACK):
            if len(s) <= len(_WRITE_STACK):
                raise HTTPException(status_code=400, detail=f"Invalid scope: {s!r}")
            continue
        if s.startswith(_READ_PROJECT):
            if len(s) <= len(_READ_PROJECT):
                raise HTTPException(status_code=400, detail=f"Invalid scope: {s!r}")
            continue
        if s.startswith(_WRITE_PROJECT):
            if len(s) <= len(_WRITE_PROJECT):
                raise HTTPException(status_code=400, detail=f"Invalid scope: {s!r}")
            continue
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown scope: {s!r}. Use admin, terraform:http_state, read:bundle:..., write:bundle:..., "
                "read:stack:..., write:stack:..., read:project:..., write:project:... "
                "(wildcards: * ?; use slug:my-app for a project slug)"
            ),
        )


def _glob_match(pattern: str, value: str) -> bool:
    return fnmatchcase(value, pattern)


def _project_suffix_match(
    suffix: str,
    project_id: int,
    project_name: str,
    project_slug: str | None,
) -> bool:
    if suffix == "*":
        return True
    m = _ID_SUFFIX.match(suffix)
    if m:
        return int(m.group(1)) == project_id
    m = _SLUG_SUFFIX.match(suffix)
    if m and project_slug is not None:
        return m.group(1) == project_slug
    return _glob_match(suffix, project_name)


def _bundle_scope_matches(pat: str, bundle_name: str, bundle_slug: str | None) -> bool:
    if _glob_match(pat, bundle_name):
        return True
    if bundle_slug and _glob_match(pat, bundle_slug):
        return True
    return False


def can_read_bundle(
    scopes: list[str],
    *,
    bundle_name: str,
    bundle_slug: str | None = None,
    group_id: int | None,
    project_name: str | None,
    project_slug: str | None = None,
) -> bool:
    if scopes_allow_admin(scopes):
        return True
    for s in scopes:
        if s.startswith(_READ_BUNDLE):
            pat = s[len(_READ_BUNDLE) :]
            if pat and _bundle_scope_matches(pat, bundle_name, bundle_slug):
                return True
        if group_id is not None and project_name is not None and s.startswith(_READ_PROJECT):
            suf = s[len(_READ_PROJECT) :]
            if suf and _project_suffix_match(suf, group_id, project_name, project_slug):
                return True
    return False


def can_write_bundle(
    scopes: list[str],
    *,
    bundle_name: str,
    bundle_slug: str | None = None,
    group_id: int | None,
    project_name: str | None,
    project_slug: str | None = None,
) -> bool:
    if scopes_allow_admin(scopes):
        return True
    for s in scopes:
        if s.startswith(_WRITE_BUNDLE):
            pat = s[len(_WRITE_BUNDLE) :]
            if pat and _bundle_scope_matches(pat, bundle_name, bundle_slug):
                return True
        if group_id is not None and project_name is not None and s.startswith(_WRITE_PROJECT):
            suf = s[len(_WRITE_PROJECT) :]
            if suf and _project_suffix_match(suf, group_id, project_name, project_slug):
                return True
    return False


def _stack_scope_matches(pat: str, stack_name: str, stack_slug: str | None) -> bool:
    if _glob_match(pat, stack_name):
        return True
    if stack_slug and _glob_match(pat, stack_slug):
        return True
    return False


def can_read_stack(
    scopes: list[str],
    *,
    stack_name: str,
    stack_slug: str | None = None,
    group_id: int | None,
    project_name: str | None,
    project_slug: str | None = None,
) -> bool:
    if scopes_allow_admin(scopes):
        return True
    for s in scopes:
        if s.startswith(_READ_STACK):
            pat = s[len(_READ_STACK) :]
            if pat and _stack_scope_matches(pat, stack_name, stack_slug):
                return True
        if group_id is not None and project_name is not None and s.startswith(_READ_PROJECT):
            suf = s[len(_READ_PROJECT) :]
            if suf and _project_suffix_match(suf, group_id, project_name, project_slug):
                return True
    return False


def can_write_stack(
    scopes: list[str],
    *,
    stack_name: str,
    stack_slug: str | None = None,
    group_id: int | None,
    project_name: str | None,
    project_slug: str | None = None,
) -> bool:
    if scopes_allow_admin(scopes):
        return True
    for s in scopes:
        if s.startswith(_WRITE_STACK):
            pat = s[len(_WRITE_STACK) :]
            if pat and _stack_scope_matches(pat, stack_name, stack_slug):
                return True
        if group_id is not None and project_name is not None and s.startswith(_WRITE_PROJECT):
            suf = s[len(_WRITE_PROJECT) :]
            if suf and _project_suffix_match(suf, group_id, project_name, project_slug):
                return True
    return False


def can_create_stack(
    scopes: list[str],
    *,
    stack_name: str,
    stack_slug: str | None = None,
    group_id: int | None,
    project_name: str | None,
    project_slug: str | None = None,
) -> bool:
    """Ungrouped stack: write:stack match; grouped: project write or matching write:stack."""
    if scopes_allow_admin(scopes):
        return True
    name_ok = any(
        s.startswith(_WRITE_STACK)
        and s[len(_WRITE_STACK) :]
        and _stack_scope_matches(s[len(_WRITE_STACK) :], stack_name, stack_slug)
        for s in scopes
    )
    if group_id is None:
        return name_ok
    if project_name is None or group_id is None or project_slug is None:
        return False
    if can_write_project(
        scopes,
        project_id=group_id,
        project_name=project_name,
        project_slug=project_slug,
    ):
        return True
    return False


def can_read_project(
    scopes: list[str],
    *,
    project_id: int,
    project_name: str,
    project_slug: str,
) -> bool:
    if scopes_allow_admin(scopes):
        return True
    for s in scopes:
        if not s.startswith(_READ_PROJECT):
            continue
        suf = s[len(_READ_PROJECT) :]
        if suf and _project_suffix_match(suf, project_id, project_name, project_slug):
            return True
    return False


def can_write_project(
    scopes: list[str],
    *,
    project_id: int,
    project_name: str,
    project_slug: str,
) -> bool:
    if scopes_allow_admin(scopes):
        return True
    for s in scopes:
        if not s.startswith(_WRITE_PROJECT):
            continue
        suf = s[len(_WRITE_PROJECT) :]
        if suf and _project_suffix_match(suf, project_id, project_name, project_slug):
            return True
    return False


def can_create_bundle(
    scopes: list[str],
    *,
    bundle_name: str,
    bundle_slug: str | None = None,
    group_id: int | None,
    project_name: str | None,
    project_slug: str | None = None,
) -> bool:
    """Create bundle: ungrouped needs write:bundle match; grouped needs can_write_project (any name) or deny."""
    if scopes_allow_admin(scopes):
        return True
    name_ok = any(
        s.startswith(_WRITE_BUNDLE)
        and s[len(_WRITE_BUNDLE) :]
        and _bundle_scope_matches(s[len(_WRITE_BUNDLE) :], bundle_name, bundle_slug)
        for s in scopes
    )
    if group_id is None:
        return name_ok
    if project_name is None or group_id is None or project_slug is None:
        return False
    if can_write_project(
        scopes,
        project_id=group_id,
        project_name=project_name,
        project_slug=project_slug,
    ):
        return True
    return False


def can_create_project(scopes: list[str]) -> bool:
    if scopes_allow_admin(scopes):
        return True
    return any(
        s.startswith(_WRITE_PROJECT) and s[len(_WRITE_PROJECT) :] == "*" for s in scopes
    )
