import getpass
import os
import platform
import socket
import time
from typing import Optional
import httpx
import psutil
from fastapi import APIRouter, HTTPException, Query, status
from app.core.config import settings
from app.schemas.torrent import ServerPathItem, ServerPathsResponse, SystemStatsResponse

router = APIRouter()

_ip_cache: dict[str, object] = {"ip": None, "fetched_at": 0.0}
_IP_CACHE_TTL = 300.0


def _detect_os_name() -> str:
    """Returns a friendly OS name, reading /etc/os-release on Linux when present."""
    if os.path.exists("/etc/os-release"):
        try:
            with open("/etc/os-release", "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("PRETTY_NAME="):
                        return line.split("=", 1)[1].strip().strip('"')
        except OSError:
            pass
    return f"{platform.system()} {platform.release()}".strip()


async def _get_public_ip() -> Optional[str]:
    now = time.time()
    cached_ip = _ip_cache.get("ip")
    fetched_at = float(_ip_cache.get("fetched_at", 0.0) or 0.0)
    if cached_ip and (now - fetched_at) < _IP_CACHE_TTL:
        return str(cached_ip)

    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get("https://api.ipify.org?format=json")
            if resp.status_code == 200:
                ip = resp.json().get("ip")
                if ip:
                    _ip_cache["ip"] = ip
                    _ip_cache["fetched_at"] = now
                    return str(ip)
    except Exception:
        pass
    return str(cached_ip) if cached_ip else None


@router.get(
    "/stats",
    response_model=SystemStatsResponse,
    summary="Get Host System Resources",
    description="Retrieve CPU, RAM, disk storage, OS, uptime, and public IP of the VPS host.",
)
async def get_system_stats():
    hostname = socket.gethostname()
    os_name = _detect_os_name()
    arch = f"{platform.system()} {platform.machine()}".strip()
    try:
        user = getpass.getuser()
    except Exception:
        user = "unknown"

    cpu_percent = float(psutil.cpu_percent(interval=0.1))
    cpu_cores = psutil.cpu_count(logical=True) or os.cpu_count() or 1
    vm = psutil.virtual_memory()

    target_disk = settings.DEFAULT_SAVE_PATH
    if not os.path.exists(target_disk):
        target_disk = os.path.abspath(os.sep)
    disk = psutil.disk_usage(target_disk)

    uptime_seconds = max(0, int(time.time() - psutil.boot_time()))
    public_ip = await _get_public_ip()

    return SystemStatsResponse(
        hostname=hostname,
        os_name=os_name,
        architecture=arch,
        active_user=f"{user}@{hostname}",
        cpu_percent=round(cpu_percent, 1),
        cpu_cores=cpu_cores,
        ram_used_bytes=int(vm.used),
        ram_total_bytes=int(vm.total),
        ram_percent=round(float(vm.percent), 1),
        disk_path=target_disk,
        disk_free_bytes=int(disk.free),
        disk_used_bytes=int(disk.used),
        disk_total_bytes=int(disk.total),
        disk_percent=round(float(disk.percent), 1),
        uptime_seconds=uptime_seconds,
        public_ip=public_ip,
    )


@router.get(
    "/paths",
    response_model=ServerPathsResponse,
    summary="Browse Server Download Paths",
    description="List directories inside the configured download path for re-seeding local files.",
)
def browse_server_paths(
    path: Optional[str] = Query(
        default=None,
        description="Directory path to list (restricted within the default download directory).",
    ),
):
    base_root = os.path.realpath(settings.DEFAULT_SAVE_PATH)
    if not os.path.exists(base_root):
        return ServerPathsResponse(
            current_path=settings.DEFAULT_SAVE_PATH,
            parent_path=None,
            directories=[],
        )

    requested = os.path.realpath(path) if path else base_root
    try:
        if os.path.commonpath([base_root, requested]) != base_root:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access outside the configured download directory is not permitted.",
            )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid path.",
        ) from e

    if not os.path.isdir(requested):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Directory not found: {requested}",
        )

    dirs: list[ServerPathItem] = []
    try:
        with os.scandir(requested) as entries:
            for entry in sorted(entries, key=lambda e: e.name.lower()):
                if entry.is_dir(follow_symlinks=False) and not entry.name.startswith("."):
                    dirs.append(ServerPathItem(name=entry.name, path=entry.path))
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied reading directory.",
        ) from e

    parent_path = os.path.dirname(requested) if requested != base_root else None
    return ServerPathsResponse(
        current_path=requested,
        parent_path=parent_path,
        directories=dirs,
    )

