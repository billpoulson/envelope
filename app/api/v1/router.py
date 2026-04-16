from fastapi import APIRouter

from app.api.v1 import auth, bundles, certificates, env_resolve, keys, projects, sealed_secrets, settings, stacks, system

router = APIRouter()
router.include_router(auth.router, tags=["auth"])
router.include_router(settings.router)
router.include_router(env_resolve.router, tags=["env-links"])
router.include_router(bundles.router, tags=["bundles"])
router.include_router(stacks.router, tags=["stacks"])
router.include_router(sealed_secrets.router, tags=["sealed-secrets"])
router.include_router(certificates.router, tags=["certificates"])
router.include_router(projects.router, tags=["projects"])
router.include_router(keys.router, tags=["api-keys"])
router.include_router(system.router, tags=["system"])
