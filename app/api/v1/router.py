from fastapi import APIRouter

from app.api.v1 import bundles, certificates, keys, projects, sealed_secrets, system

router = APIRouter()
router.include_router(bundles.router, tags=["bundles"])
router.include_router(sealed_secrets.router, tags=["sealed-secrets"])
router.include_router(certificates.router, tags=["certificates"])
router.include_router(projects.router, tags=["projects"])
router.include_router(keys.router, tags=["api-keys"])
router.include_router(system.router, tags=["system"])
