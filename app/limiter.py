from slowapi import Limiter
from slowapi.util import get_remote_address

# Client host comes from the ASGI scope; with uvicorn + FORWARDED_ALLOW_IPS, the proxy is trusted and
# scope["client"] reflects the real client (see uvicorn.middleware.proxy_headers.ProxyHeadersMiddleware).
limiter = Limiter(key_func=get_remote_address)
