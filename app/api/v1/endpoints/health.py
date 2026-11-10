from fastapi import APIRouter
from app.core.config import settings
from app.schemas.torrent import HealthResponse
from app.services.qbit_service import qbit_service

router = APIRouter()


@router.get("/health", response_model=HealthResponse, summary="Check API & qBittorrent Health")
def check_health():
    is_connected, qbit_ver = qbit_service.check_connection()
    return HealthResponse(
        status="healthy" if is_connected else "degraded",
        app_version=settings.VERSION,
        qbittorrent_connected=is_connected,
        qbittorrent_version=qbit_ver,
    )
