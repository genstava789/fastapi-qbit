from fastapi import APIRouter
from app.api.v1.endpoints import health_router, torrents_router

api_router = APIRouter()

api_router.include_router(health_router, tags=["Health"])
api_router.include_router(torrents_router, prefix="/torrents", tags=["Torrents"])

