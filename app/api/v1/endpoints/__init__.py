from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.torrents import router as torrents_router

__all__ = ["health_router", "torrents_router"]

