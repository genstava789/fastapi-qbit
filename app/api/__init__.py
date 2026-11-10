from app.api.v1.api import api_router as api_router_v1
from app.api.webtorrent_proxy import proxy_router

__all__ = ["api_router_v1", "proxy_router"]
