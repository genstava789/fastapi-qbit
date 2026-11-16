import getpass
import os
import platform
import socket
import time
import shutil
from typing import Optional
import httpx
import psutil
from fastapi import APIRouter, HTTPException, Query, status
from app.core.config import settings
from app.schemas.torrent import (
    LocalFileItem,
    LocalFilesResponse,
    RenameFileRequest,
    RenameFileResponse,
    ServerFileItem,
    ServerPathItem,
    ServerPathsResponse,
    SystemStatsResponse,
)

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

    save_path = os.path.realpath(settings.DEFAULT_SAVE_PATH)
    try:
        os.makedirs(save_path, exist_ok=True)
    except OSError:
        pass

    target_disk = save_path if os.path.exists(save_path) else os.path.abspath(os.sep)
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
        default_save_path=settings.DEFAULT_SAVE_PATH,
    )


@router.get(
    "/paths",
    response_model=ServerPathsResponse,
    summary="Browse Server Download Paths",
    description="List directories and files inside the configured download path for re-seeding local files.",
)
def browse_server_paths(
    path: Optional[str] = Query(
        default=None,
        description="Directory path to list (restricted within the default download directory).",
    ),
):
    base_root = os.path.realpath(settings.DEFAULT_SAVE_PATH)
    try:
        os.makedirs(base_root, exist_ok=True)
    except OSError:
        pass

    if not os.path.exists(base_root):
        return ServerPathsResponse(
            current_path=settings.DEFAULT_SAVE_PATH,
            parent_path=None,
            directories=[],
            files=[],
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
    files: list[ServerFileItem] = []
    try:
        with os.scandir(requested) as entries:
            for entry in sorted(entries, key=lambda e: e.name.lower()):
                if entry.name.startswith("."):
                    continue
                if entry.is_dir(follow_symlinks=False):
                    dirs.append(ServerPathItem(name=entry.name, path=entry.path))
                elif entry.is_file(follow_symlinks=False):
                    try:
                        stat = entry.stat(follow_symlinks=False)
                        files.append(
                            ServerFileItem(
                                name=entry.name,
                                path=entry.path,
                                size=stat.st_size,
                                modified=stat.st_mtime,
                            )
                        )
                    except OSError:
                        pass
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
        files=files,
    )


@router.get(
    "/files",
    response_model=LocalFilesResponse,
    summary="List Local Server Files and Folders",
    description="List local files and folders in the server download directory, matched with torrent metadata if available.",
)
def list_local_files(
    path: Optional[str] = Query(
        default=None,
        description="Directory path to scan (defaults to configured download directory).",
    ),
    recursive: bool = Query(
        default=True,
        description="Whether to recursively scan subdirectories.",
    ),
):
    base_root = os.path.realpath(settings.DEFAULT_SAVE_PATH)
    try:
        os.makedirs(base_root, exist_ok=True)
    except OSError:
        pass

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

    if not os.path.exists(requested):
        return LocalFilesResponse(root_path=base_root, files=[])

    # Map existing torrents for correlation
    torrent_hash_map: dict[str, str] = {}
    try:
        from app.services.qbit_service import qbit_service
        connected, _ = qbit_service.check_connection()
        if connected:
            for t in qbit_service.list_torrents():
                thash = t.get("hash")
                cpath = t.get("content_path")
                tname = t.get("name")
                if thash:
                    if cpath:
                        torrent_hash_map[os.path.realpath(cpath)] = thash
                    if tname:
                        torrent_hash_map[tname.lower()] = thash
    except Exception:
        pass

    results: list[LocalFileItem] = []
    max_items = 3000

    def scan_dir(dir_path: str, depth: int = 0):
        if len(results) >= max_items or depth > 10:
            return
        try:
            with os.scandir(dir_path) as entries:
                for entry in sorted(entries, key=lambda e: (not e.is_dir(), e.name.lower())):
                    if entry.name.startswith("."):
                        continue
                    try:
                        is_dir = entry.is_dir(follow_symlinks=False)
                        stat = entry.stat(follow_symlinks=False)
                        size = stat.st_size if not is_dir else 0
                        mod = stat.st_mtime
                        real_entry_path = os.path.realpath(entry.path)
                        thash = torrent_hash_map.get(real_entry_path) or torrent_hash_map.get(entry.name.lower())

                        results.append(
                            LocalFileItem(
                                name=entry.name,
                                path=entry.path,
                                size=size,
                                modified=mod,
                                is_directory=is_dir,
                                parent_path=dir_path,
                                torrent_hash=thash,
                            )
                        )
                        if is_dir and recursive:
                            scan_dir(entry.path, depth + 1)
                    except OSError:
                        continue
        except (PermissionError, OSError):
            pass

    scan_dir(requested, 0)
    return LocalFilesResponse(root_path=requested, files=results)


@router.delete(
    "/files",
    summary="Delete Local Server File or Directory",
    description="Delete a file or directory inside the server download directory.",
)
def delete_local_file(
    path: str = Query(..., description="File or directory path to delete."),
):
    base_root = os.path.realpath(settings.DEFAULT_SAVE_PATH)
    requested = os.path.realpath(path)

    try:
        if os.path.commonpath([base_root, requested]) != base_root or requested == base_root:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot delete files outside or root of download directory.",
            )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid path.",
        ) from e

    if not os.path.exists(requested):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File or directory not found.",
        )

    try:
        if os.path.isdir(requested):
            shutil.rmtree(requested)
        else:
            os.remove(requested)
        return {"success": True, "message": f"Deleted '{os.path.basename(requested)}'"}
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied: {str(e)}",
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete: {str(e)}",
        ) from e


@router.patch(
    "/files",
    response_model=RenameFileResponse,
    summary="Rename Local Server File or Directory",
    description="Rename a file or directory located inside the configured server download directory.",
)
@router.post(
    "/files/rename",
    response_model=RenameFileResponse,
    summary="Rename Local Server File or Directory",
    description="Rename a file or directory located inside the configured server download directory.",
)
def rename_local_file(payload: RenameFileRequest):
    new_name = payload.new_name.strip()
    if not new_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="New name cannot be empty.",
        )
    if "/" in new_name or "\\" in new_name or "\0" in new_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="New name cannot contain path separators.",
        )

    base_root = os.path.realpath(settings.DEFAULT_SAVE_PATH)
    requested = os.path.realpath(payload.path)

    try:
        if os.path.commonpath([base_root, requested]) != base_root or requested == base_root:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot rename files outside or root of download directory.",
            )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid path.",
        ) from e

    if not os.path.exists(requested):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File or directory to rename does not exist.",
        )

    parent_dir = os.path.dirname(requested)
    target_path = os.path.join(parent_dir, new_name)
    real_target = os.path.realpath(target_path)

    try:
        if os.path.commonpath([base_root, real_target]) != base_root:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="New path would be outside download directory.",
            )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid target path.",
        ) from e

    if os.path.exists(target_path) and real_target != requested:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An item named '{new_name}' already exists in this folder.",
        )

    try:
        os.rename(requested, target_path)
        return RenameFileResponse(
            success=True,
            message=f"Renamed successfully to '{new_name}'",
            old_path=requested,
            new_path=target_path,
        )
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied: {str(e)}",
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to rename: {str(e)}",
        ) from e

