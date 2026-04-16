from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class BundleGroup(Base):
    """Named project / folder for bundles (optional)."""

    __tablename__ = "bundle_groups"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    # Stable URL/API identifier (lowercase a-z0-9._-); not the numeric primary key.
    slug: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    bundles: Mapped[list["Bundle"]] = relationship(back_populates="group")
    stacks: Mapped[list["BundleStack"]] = relationship(back_populates="group")
    environments: Mapped[list["ProjectEnvironment"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
    )


class ProjectEnvironment(Base):
    """Named deployment stage / environment within a project (e.g. Local, CI, Prod)."""

    __tablename__ = "project_environments"
    __table_args__ = (UniqueConstraint("group_id", "slug", name="uq_project_environment_slug"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("bundle_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    group: Mapped["BundleGroup"] = relationship(back_populates="environments")
    bundles: Mapped[list["Bundle"]] = relationship(back_populates="project_environment")
    stacks: Mapped[list["BundleStack"]] = relationship(back_populates="project_environment")


class BundleEnvLink(Base):
    """Opaque URL token → bundle export (dotenv/json). Raw token is never stored."""

    __tablename__ = "bundle_env_links"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(
        ForeignKey("bundles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_sha256: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    bundle: Mapped["Bundle"] = relationship(back_populates="env_links")


class Bundle(Base):
    __tablename__ = "bundles"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Display title; unique per (project group, name, environment) — see SQLite migration indexes.
    name: Mapped[str] = mapped_column(String(256), index=True)
    # Stable URL/API segment (lowercase a-z0-9._-), like stacks; unique per project env scope.
    slug: Mapped[str] = mapped_column(String(128), index=True, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("bundle_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    project_environment_id: Mapped[int | None] = mapped_column(
        ForeignKey("project_environments.id", ondelete="SET NULL"), nullable=True, index=True
    )

    group: Mapped["BundleGroup | None"] = relationship(back_populates="bundles")
    project_environment: Mapped["ProjectEnvironment | None"] = relationship(
        back_populates="bundles"
    )
    secrets: Mapped[list["Secret"]] = relationship(
        back_populates="bundle", cascade="all, delete-orphan"
    )
    sealed_secrets: Mapped[list["SealedSecret"]] = relationship(
        back_populates="bundle", cascade="all, delete-orphan"
    )
    env_links: Mapped[list["BundleEnvLink"]] = relationship(
        back_populates="bundle", cascade="all, delete-orphan"
    )
    stack_layers: Mapped[list["BundleStackLayer"]] = relationship(back_populates="bundle")


class BundleStack(Base):
    """Ordered list of bundles merged into one composite env (later layers overwrite keys)."""

    __tablename__ = "bundle_stacks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Display title (may repeat across projects; unique per project env scope — see migrations).
    name: Mapped[str] = mapped_column(String(256), index=True)
    # Stable URL/API segment (lowercase a-z0-9._-), like project slugs; unique per project env scope.
    slug: Mapped[str] = mapped_column(String(128), index=True, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("bundle_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    project_environment_id: Mapped[int | None] = mapped_column(
        ForeignKey("project_environments.id", ondelete="SET NULL"), nullable=True, index=True
    )

    group: Mapped["BundleGroup | None"] = relationship(back_populates="stacks")
    project_environment: Mapped["ProjectEnvironment | None"] = relationship(
        back_populates="stacks"
    )
    layers: Mapped[list["BundleStackLayer"]] = relationship(
        back_populates="stack",
        cascade="all, delete-orphan",
        order_by="BundleStackLayer.position",
    )
    env_links: Mapped[list["StackEnvLink"]] = relationship(
        back_populates="stack", cascade="all, delete-orphan"
    )


class BundleStackLayer(Base):
    __tablename__ = "bundle_stack_layers"
    __table_args__ = (
        UniqueConstraint("stack_id", "position", name="uq_stack_layer_position"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    stack_id: Mapped[int] = mapped_column(
        ForeignKey("bundle_stacks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    bundle_id: Mapped[int] = mapped_column(
        ForeignKey("bundles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # "all" = include every key from the bundle; "pick" = only keys in selected_keys_json
    keys_mode: Mapped[str] = mapped_column(String(16), default="all")
    selected_keys_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional display name for this row in the UI (bundle reference unchanged).
    layer_label: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # JSON object: export name -> source key from merged layers below this one (e.g. VITE_OIDC_KEY -> OIDC_KEY).
    aliases_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    stack: Mapped["BundleStack"] = relationship(back_populates="layers")
    bundle: Mapped["Bundle"] = relationship(back_populates="stack_layers")


class StackEnvLink(Base):
    """Opaque URL token → merged stack export (dotenv/json). Raw token is never stored.

    Optional ``through_layer_position`` limits the merge to layers from the bottom through
    that layer position (prefix slice); ``None`` means merge all layers.
    """

    __tablename__ = "stack_env_links"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    stack_id: Mapped[int] = mapped_column(
        ForeignKey("bundle_stacks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_sha256: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    # None = merge all layers; else merge layers with position <= this value (prefix slice).
    through_layer_position: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    stack: Mapped["BundleStack"] = relationship(back_populates="env_links")


class Secret(Base):
    __tablename__ = "secrets"
    __table_args__ = (UniqueConstraint("bundle_id", "key_name", name="uq_bundle_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(ForeignKey("bundles.id", ondelete="CASCADE"))
    key_name: Mapped[str] = mapped_column(String(512))
    # Fernet token when is_secret; UTF-8 plaintext when not (still at rest on disk)
    value_ciphertext: Mapped[str] = mapped_column(Text)
    is_secret: Mapped[bool] = mapped_column(Boolean, default=True)

    bundle: Mapped["Bundle"] = relationship(back_populates="secrets")


class Certificate(Base):
    """Public certificate metadata for client-side encrypted secret recipients."""

    __tablename__ = "certificates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    fingerprint_sha256: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    certificate_pem: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    sealed_recipients: Mapped[list["SealedSecretRecipient"]] = relationship(
        back_populates="certificate"
    )


class SealedSecret(Base):
    """Ciphertext-only secret payload stored without server-side decrypt keys."""

    __tablename__ = "sealed_secrets"
    __table_args__ = (UniqueConstraint("bundle_id", "key_name", name="uq_bundle_sealed_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(
        ForeignKey("bundles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key_name: Mapped[str] = mapped_column(String(512))
    enc_alg: Mapped[str] = mapped_column(String(64), default="aes-256-gcm")
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    payload_nonce: Mapped[str] = mapped_column(String(512))
    payload_aad: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    bundle: Mapped["Bundle"] = relationship(back_populates="sealed_secrets")
    recipients: Mapped[list["SealedSecretRecipient"]] = relationship(
        back_populates="sealed_secret", cascade="all, delete-orphan"
    )


class SealedSecretRecipient(Base):
    """Wrapped data-key envelope per certificate recipient."""

    __tablename__ = "sealed_secret_recipients"
    __table_args__ = (
        UniqueConstraint(
            "sealed_secret_id",
            "certificate_id",
            name="uq_sealed_secret_recipient",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sealed_secret_id: Mapped[int] = mapped_column(
        ForeignKey("sealed_secrets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    certificate_id: Mapped[int] = mapped_column(
        ForeignKey("certificates.id"), nullable=False, index=True
    )
    wrapped_key: Mapped[str] = mapped_column(Text)
    key_wrap_alg: Mapped[str] = mapped_column(String(64), default="rsa-oaep-256")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    sealed_secret: Mapped["SealedSecret"] = relationship(back_populates="recipients")
    certificate: Mapped["Certificate"] = relationship(back_populates="sealed_recipients")


class PulumiStateBlob(Base):
    """Raw checkpoint bytes for Terraform HTTP / tooling (not Fernet-wrapped bundle secrets)."""

    __tablename__ = "pulumi_state_blobs"

    key: Mapped[str] = mapped_column(String(2048), primary_key=True)
    body: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class PulumiStateLock(Base):
    """Advisory lock row for Terraform LOCK/UNLOCK (one lock per state key)."""

    __tablename__ = "pulumi_state_locks"

    key: Mapped[str] = mapped_column(String(2048), primary_key=True)
    lock_body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class OidcAppSettings(Base):
    """Singleton row (id=1): OIDC / OAuth2 settings for the browser admin UI."""

    __tablename__ = "oidc_app_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    issuer: Mapped[str | None] = mapped_column(String(512), nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    client_secret_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    scopes: Mapped[str] = mapped_column(String(512), default="openid email profile")
    allowed_email_domains: Mapped[str | None] = mapped_column(Text, nullable=True)
    post_login_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    redirect_uri_override: Mapped[str | None] = mapped_column(String(1024), nullable=True)


class OidcIdentity(Base):
    """Binds an IdP (issuer + sub) to exactly one API key for browser SSO."""

    __tablename__ = "oidc_identities"
    __table_args__ = (UniqueConstraint("issuer", "sub", name="uq_oidc_identities_issuer_sub"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    issuer: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    sub: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(512), nullable=True)
    api_key_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128))
    key_hash: Mapped[str] = mapped_column(String(256))
    # HMAC-SHA256 hex (64 chars) derived from master + raw key; unique index from migrations. NULL = legacy row.
    key_lookup_hmac: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # JSON array of scope strings, e.g. ["admin"] or ["read:bundle:*","read:project:prod-*"]
    scopes: Mapped[str] = mapped_column(Text, default='["read:bundle:*"]')
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
