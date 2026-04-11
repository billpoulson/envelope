from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, LargeBinary, String, Text, UniqueConstraint
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
    name: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("bundle_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )

    group: Mapped["BundleGroup | None"] = relationship(back_populates="bundles")
    secrets: Mapped[list["Secret"]] = relationship(
        back_populates="bundle", cascade="all, delete-orphan"
    )
    sealed_secrets: Mapped[list["SealedSecret"]] = relationship(
        back_populates="bundle", cascade="all, delete-orphan"
    )
    env_links: Mapped[list["BundleEnvLink"]] = relationship(
        back_populates="bundle", cascade="all, delete-orphan"
    )


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


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128))
    key_hash: Mapped[str] = mapped_column(String(256))
    # JSON array of scope strings, e.g. ["admin"] or ["read:bundle:*","read:project:prod-*"]
    scopes: Mapped[str] = mapped_column(Text, default='["read:bundle:*"]')
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
