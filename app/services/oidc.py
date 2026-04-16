"""OpenID Connect discovery, authorization redirect, token exchange, and ID token validation."""

from __future__ import annotations

import base64
import hashlib
import secrets
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from jwt import PyJWKClient

_DISCOVERY_TTL_SEC = 3600.0
_discovery_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def generate_pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for S256."""
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def generate_oauth_state() -> str:
    return secrets.token_urlsafe(32)


async def fetch_discovery_document(issuer: str, client: httpx.AsyncClient) -> dict[str, Any]:
    base = issuer.rstrip("/")
    now = time.monotonic()
    hit = _discovery_cache.get(base)
    if hit is not None and now - hit[0] < _DISCOVERY_TTL_SEC:
        return hit[1]
    url = f"{base}/.well-known/openid-configuration"
    r = await client.get(url, follow_redirects=True)
    r.raise_for_status()
    doc = r.json()
    _discovery_cache[base] = (now, doc)
    return doc


def build_authorization_redirect_url(
    *,
    discovery: dict[str, Any],
    client_id: str,
    redirect_uri: str,
    scopes: str,
    state: str,
    nonce: str,
    code_challenge: str,
) -> str:
    auth_ep = discovery.get("authorization_endpoint")
    if not auth_ep or not isinstance(auth_ep, str):
        raise ValueError("OpenID discovery missing authorization_endpoint")
    q = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scopes,
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    sep = "&" if "?" in auth_ep else "?"
    return f"{auth_ep}{sep}{urlencode(q)}"


async def exchange_code_for_tokens(
    *,
    discovery: dict[str, Any],
    client: httpx.AsyncClient,
    code: str,
    redirect_uri: str,
    client_id: str,
    client_secret: str,
    code_verifier: str,
) -> dict[str, Any]:
    token_ep = discovery.get("token_endpoint")
    if not token_ep or not isinstance(token_ep, str):
        raise ValueError("OpenID discovery missing token_endpoint")
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret,
        "code_verifier": code_verifier,
    }
    r = await client.post(token_ep, data=data, headers={"Accept": "application/json"})
    r.raise_for_status()
    return r.json()


def decode_and_validate_id_token(
    *,
    id_token: str,
    discovery: dict[str, Any],
    client_id: str,
    nonce: str,
) -> dict[str, Any]:
    jwks_uri = discovery.get("jwks_uri")
    issuer = discovery.get("issuer")
    if not jwks_uri or not isinstance(jwks_uri, str):
        raise ValueError("OpenID discovery missing jwks_uri")
    if not issuer or not isinstance(issuer, str):
        raise ValueError("OpenID discovery missing issuer")

    header = jwt.get_unverified_header(id_token)
    alg = header.get("alg") or "RS256"

    jwks_client = PyJWKClient(jwks_uri)
    signing_key = jwks_client.get_signing_key_from_jwt(id_token)

    payload = jwt.decode(
        id_token,
        signing_key.key,
        algorithms=[alg],
        audience=client_id,
        issuer=issuer,
        options={"verify_exp": True},
    )
    if payload.get("nonce") != nonce:
        raise ValueError("ID token nonce mismatch")
    return payload
