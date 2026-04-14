"""Bundle stacks: ordered bundle layers merged into one env map (later layers overwrite keys)."""

from __future__ import annotations

import json
import re
from typing import Any, NamedTuple

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Bundle, BundleStack, BundleStackLayer
from app.paths import url_path
from app.services.bundles import load_bundle_entries, load_bundle_secrets, validate_bundle_name

class LayerSpec(NamedTuple):
    """One stack layer: bundle, key subset, optional UI label."""

    bundle: str
    keys: list[str] | None  # None = all keys
    label: str | None = None


def normalize_layer_label(raw: str | None) -> str | None:
    """Strip / empty → None; max 256 chars or raise HTTPException."""
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    if len(s) > 256:
        raise HTTPException(
            status_code=400,
            detail="Layer label must be at most 256 characters",
        )
    return s


def parse_layer_label_field(raw: object | None) -> str | None:
    """Web/JSON parsing: invalid → ValueError."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError('layer "label" must be a string')
    s = raw.strip()
    if not s:
        return None
    if len(s) > 256:
        raise ValueError("Layer label must be at most 256 characters")
    return s


_STACK_NAME_MAX_LEN = 256
# Human-readable titles (spaces allowed). Block path/reserved/shell-hostile characters.
_STACK_NAME_FORBIDDEN = re.compile(r'[/\\<>:"|?*\x00-\x1f]')


def validate_stack_name(name: str) -> None:
    """Stack names may include spaces and common punctuation; bundle names stay stricter."""
    if not name.strip():
        raise HTTPException(status_code=400, detail="Stack name is required")
    if len(name) > _STACK_NAME_MAX_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Stack name must be at most {_STACK_NAME_MAX_LEN} characters",
        )
    if _STACK_NAME_FORBIDDEN.search(name):
        raise HTTPException(
            status_code=400,
            detail='Stack name cannot contain / \\ : * ? " < > | or control characters',
        )


async def get_stack_by_name(
    session: AsyncSession, name: str
) -> BundleStack | None:
    validate_stack_name(name)
    r = await session.execute(
        select(BundleStack)
        .where(BundleStack.name == name)
        .options(
            selectinload(BundleStack.layers)
            .selectinload(BundleStackLayer.bundle)
            .selectinload(Bundle.group),
            selectinload(BundleStack.group),
        )
    )
    return r.scalar_one_or_none()


def _layer_key_filter(layer: BundleStackLayer, secrets_map: dict[str, str]) -> dict[str, str]:
    mode = getattr(layer, "keys_mode", None) or "all"
    if mode != "pick" or not layer.selected_keys_json:
        return dict(secrets_map)
    try:
        picked: list[str] = json.loads(layer.selected_keys_json)
    except json.JSONDecodeError:
        return dict(secrets_map)
    ps = set(picked)
    return {k: v for k, v in secrets_map.items() if k in ps}


def _layer_entry_filter(
    layer: BundleStackLayer, ent_map: dict[str, tuple[str, bool]]
) -> dict[str, tuple[str, bool]]:
    mode = getattr(layer, "keys_mode", None) or "all"
    if mode != "pick" or not layer.selected_keys_json:
        return dict(ent_map)
    try:
        picked: list[str] = json.loads(layer.selected_keys_json)
    except json.JSONDecodeError:
        return dict(ent_map)
    ps = set(picked)
    return {k: v for k, v in ent_map.items() if k in ps}


async def load_stack_secrets(session: AsyncSession, stack: BundleStack) -> dict[str, str]:
    """Merge decrypted secrets from each layer in order; later layers win on duplicate keys."""
    layers = sorted(stack.layers, key=lambda L: L.position)
    if not layers:
        raise HTTPException(status_code=400, detail="Stack has no layers")
    merged: dict[str, str] = {}
    for layer in layers:
        _, sm = await load_bundle_secrets(session, layer.bundle.name)
        sm = _layer_key_filter(layer, sm)
        merged.update(sm)
    return merged


def validate_through_layer_position(stack: BundleStack, pos: int | None) -> int | None:
    """Return None for full merge, or pos if it matches a layer position; else raise 400."""
    if pos is None:
        return None
    layers = sorted(stack.layers, key=lambda L: L.position)
    if not layers:
        raise HTTPException(status_code=400, detail="Stack has no layers")
    positions = {L.position for L in layers}
    if pos not in positions:
        raise HTTPException(
            status_code=400,
            detail="through_layer_position must match a layer position in this stack",
        )
    return pos


async def load_stack_secrets_through(
    session: AsyncSession, stack: BundleStack, through_layer_position: int
) -> dict[str, str]:
    """Merge layers from bottom through the layer at ``through_layer_position`` (inclusive)."""
    layers = sorted(stack.layers, key=lambda L: L.position)
    if not layers:
        raise HTTPException(status_code=400, detail="Stack has no layers")
    validate_through_layer_position(stack, through_layer_position)
    merged: dict[str, str] = {}
    for layer in layers:
        if layer.position > through_layer_position:
            break
        _, sm = await load_bundle_secrets(session, layer.bundle.name)
        sm = _layer_key_filter(layer, sm)
        merged.update(sm)
    return merged


async def load_stack_layer_secret_maps(
    session: AsyncSession, stack: BundleStack
) -> list[dict[str, str]]:
    """Per-layer secret maps after each layer's key filter (bottom → top order)."""
    layers = sorted(stack.layers, key=lambda L: L.position)
    out: list[dict[str, str]] = []
    for layer in layers:
        _, sm = await load_bundle_secrets(session, layer.bundle.name)
        sm = _layer_key_filter(layer, sm)
        out.append(dict(sm))
    return out


async def load_stack_layer_entry_maps(
    session: AsyncSession, stack: BundleStack
) -> list[dict[str, tuple[str, bool]]]:
    """Per-layer key -> (value, is_secret) after each layer's key filter (bottom → top)."""
    layers = sorted(stack.layers, key=lambda L: L.position)
    out: list[dict[str, tuple[str, bool]]] = []
    for layer in layers:
        _, ent = await load_bundle_entries(session, layer.bundle.name)
        ent = _layer_entry_filter(layer, ent)
        out.append(dict(ent))
    return out


def _effective_key_graph_value(val: str | None) -> str | None:
    """None or whitespace-only string counts as no value for winner / merged."""
    if val is None:
        return None
    if isinstance(val, str) and val.strip() == "":
        return None
    return val


def stack_key_graph_payload(
    layer_entry_maps: list[dict[str, tuple[str, bool]]],
    layer_bundle_names: list[str],
    layer_bundle_edit_paths: list[str] | None = None,
    layer_display_labels: list[str | None] | None = None,
    *,
    include_secret_values: bool = True,
) -> dict[str, Any]:
    """JSON-ready data for the admin UI: keys, per-layer values, secret flags, winner index.

    When ``include_secret_values`` is False, secret plaintext is omitted from ``cells`` and
    ``merged``; use ``cells_value_present``, ``cells_secret_redacted``, and ``merged_value_redacted``.
    """
    n = len(layer_entry_maps)
    if n == 0 or n != len(layer_bundle_names):
        return {"layers": [], "rows": [], "secret_values_included": include_secret_values}

    all_keys: set[str] = set()
    for m in layer_entry_maps:
        all_keys |= m.keys()

    rows: list[dict[str, Any]] = []
    for key in sorted(all_keys):
        cells: list[str | None] = []
        cell_secrets: list[bool | None] = []
        cells_value_present: list[bool | None] = []
        for i in range(n):
            ent = layer_entry_maps[i].get(key)
            if ent is None:
                cells.append(None)
                cell_secrets.append(None)
                cells_value_present.append(None)
            else:
                val, is_sec = ent
                cells.append(val)
                cell_secrets.append(bool(is_sec))
                cells_value_present.append(True)
        win_idx: int | None = None
        for i in range(n - 1, -1, -1):
            if _effective_key_graph_value(cells[i]) is not None:
                win_idx = i
                break
        merged_val = cells[win_idx] if win_idx is not None else None
        merged_secret: bool | None = (
            cell_secrets[win_idx] if win_idx is not None else None
        )
        merged_plain_effective = _effective_key_graph_value(merged_val)

        cells_secret_redacted: list[bool | None]
        merged_value_redacted: bool
        if include_secret_values:
            cells_secret_redacted = [
                None if cells_value_present[i] is None else False for i in range(n)
            ]
            merged_value_redacted = False
        else:
            cells_secret_redacted = [None] * n
            merged_value_redacted = False
            for i in range(n):
                if cell_secrets[i] is True and cells_value_present[i] is True:
                    cells[i] = None
                    cells_secret_redacted[i] = True
                elif cells_value_present[i] is True:
                    cells_secret_redacted[i] = False
            if (
                win_idx is not None
                and merged_secret is True
                and merged_plain_effective is not None
            ):
                merged_val = None
                merged_value_redacted = True

        row_out: dict[str, Any] = {
            "key": key,
            "cells": cells,
            "cell_secrets": cell_secrets,
            "cells_value_present": cells_value_present,
            "cells_secret_redacted": cells_secret_redacted,
            "winner_layer_index": win_idx,
            "merged": merged_val,
            "merged_secret": merged_secret,
            "merged_value_redacted": merged_value_redacted,
        }
        rows.append(row_out)

    layers_meta: list[dict[str, Any]] = []
    for i in range(n):
        custom = None
        if layer_display_labels and i < len(layer_display_labels):
            raw = layer_display_labels[i]
            if isinstance(raw, str) and raw.strip():
                custom = raw.strip()
        base = custom if custom else f"Layer {i + 1}"
        lab = base
        if i == 0:
            lab += " · bottom"
        elif i == n - 1:
            lab += " · top"
        edit_path = ""
        if layer_bundle_edit_paths and i < len(layer_bundle_edit_paths):
            edit_path = layer_bundle_edit_paths[i]
        layers_meta.append(
            {
                "bundle": layer_bundle_names[i],
                "position": i,
                "label": lab,
                "display_label": custom,
                "bundle_edit_path": edit_path,
            }
        )

    return {
        "layers": layers_meta,
        "rows": rows,
        "secret_values_included": include_secret_values,
    }


async def stack_key_graph_payload_for_stack(
    session: AsyncSession,
    stack: BundleStack,
    *,
    include_secret_values: bool = True,
) -> dict[str, Any]:
    """Layer maps + graph payload for a stack (admin UI)."""
    layers_sorted = sorted(stack.layers, key=lambda L: L.position)
    if not layers_sorted:
        return {"layers": [], "rows": [], "secret_values_included": include_secret_values}
    maps = await load_stack_layer_entry_maps(session, stack)
    names = [L.bundle.name for L in layers_sorted]
    edit_paths: list[str] = []
    labels: list[str | None] = []
    for L in layers_sorted:
        b = L.bundle
        g = getattr(b, "group", None)
        if g is not None and getattr(g, "slug", None):
            edit_paths.append(
                url_path(f"/projects/{g.slug}/bundles/{b.name}/edit")
            )
        else:
            edit_paths.append(url_path(f"/bundles/{b.name}/edit"))
        raw = getattr(L, "layer_label", None)
        labels.append(raw.strip() if isinstance(raw, str) and raw.strip() else None)
    return stack_key_graph_payload(
        maps, names, edit_paths, labels, include_secret_values=include_secret_values
    )


async def replace_stack_layers(
    session: AsyncSession,
    stack_id: int,
    layers: list[LayerSpec],
) -> None:
    """Replace all layers; order is bottom → top (last wins on key overlap)."""
    await session.execute(delete(BundleStackLayer).where(BundleStackLayer.stack_id == stack_id))
    for pos, spec in enumerate(layers):
        bn = spec.bundle.strip()
        keys = spec.keys
        lbl = normalize_layer_label(spec.label)
        validate_bundle_name(bn)
        r = await session.execute(select(Bundle.id).where(Bundle.name == bn))
        bid = r.scalar_one_or_none()
        if bid is None:
            raise HTTPException(status_code=400, detail=f"Bundle not found: {bn}")
        if keys is not None and len(keys) == 0:
            raise HTTPException(
                status_code=400,
                detail=f"Layer for bundle {bn!r}: select at least one key or use all keys",
            )
        if keys is None:
            km = "all"
            sj: str | None = None
        else:
            km = "pick"
            sj = json.dumps(sorted(set(keys)))
        session.add(
            BundleStackLayer(
                stack_id=stack_id,
                position=pos,
                bundle_id=bid,
                keys_mode=km,
                selected_keys_json=sj,
                layer_label=lbl,
            )
        )
    await session.flush()
