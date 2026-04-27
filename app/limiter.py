from slowapi import Limiter
from slowapi.util import get_remote_address

# Client host comes from the ASGI scope; with uvicorn + FORWARDED_ALLOW_IPS, the proxy is trusted and
# scope["client"] reflects the real client (see uvicorn.middleware.proxy_headers.ProxyHeadersMiddleware).
limiter = Limiter(key_func=get_remote_address)

# Shared limit strings (per client IP unless key_func overrides).
LOGIN = "20/minute"
OIDC_REDIRECT = "45/minute"
OIDC_CALLBACK = "45/minute"
CLI_DEVICE_AUTHORIZE = "20/minute"
CLI_DEVICE_TOKEN = "120/minute"
API_KEYS_LIST = "120/minute"
API_KEYS_CREATE = "60/minute"
API_KEYS_DELETE = "60/minute"
SEALED_SECRETS_LIST = "120/minute"
SEALED_SECRETS_WRITE = "60/minute"
CERTIFICATES_LIST = "120/minute"
CERTIFICATES_WRITE = "60/minute"
