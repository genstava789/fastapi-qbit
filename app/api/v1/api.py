from fastapi import APIRouter
from app.api.v1.endpoints import health_router, system_router, torrents_router, gdrive_router

api_router = APIRouter()

api_router.include_router(health_router, tags=["Health"])
api_router.include_router(torrents_router, prefix="/torrents", tags=["Torrents"])
api_router.include_router(system_router, prefix="/system", tags=["System"])
api_router.include_router(gdrive_router, prefix="/drive", tags=["Google Drive"])
api_router.include_router(gdrive_router, prefix="/gdrive", tags=["Google Drive"], include_in_schema=False)
