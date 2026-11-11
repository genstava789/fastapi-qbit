from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.system import router as system_router
from app.api.v1.endpoints.torrents import router as torrents_router
from app.api.v1.endpoints.gdrive import router as gdrive_router

__all__ = ["health_router", "system_router", "torrents_router", "gdrive_router"]
