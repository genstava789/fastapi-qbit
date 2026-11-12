import json
import logging
import os
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

logger = logging.getLogger(__name__)

# Allow OAuth scope changes when Google returns extra user-granted scopes
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"

CREDENTIALS_FILE = os.getenv("GDRIVE_CREDENTIALS_FILE", "credentials.json")
TOKEN_FILE = os.getenv("GDRIVE_TOKEN_FILE", "token.json")
SCOPES = ["https://www.googleapis.com/auth/drive"]

GDRIVE_SETTINGS_FILE = os.getenv("GDRIVE_SETTINGS_FILE", "gdrive_settings.json")


@dataclass
class UploadState:
    upload_id: str
    filename: str
    file_path: str
    folder_id: str
    status: str = "pending"
    progress_percent: float = 0.0
    bytes_uploaded: int = 0
    total_bytes: int = 0
    error: Optional[str] = None
    drive_file_id: Optional[str] = None
    torrent_hash: Optional[str] = None


class GDriveService:
    def __init__(self) -> None:
        self._uploads: Dict[str, UploadState] = {}
        self._root_folder_id: Optional[str] = None

    def _get_root_folder_id(self, service: Any) -> Optional[str]:
        """Resolve and cache the Google Drive My Drive root folder ID."""
        if self._root_folder_id:
            return self._root_folder_id
        try:
            root_meta = service.files().get(fileId="root", fields="id").execute()
            self._root_folder_id = root_meta.get("id")
        except Exception as e:
            logger.debug(f"Could not resolve root folder ID: {e}")
        return self._root_folder_id

    def _get_credentials_path(self) -> str:
        if os.path.exists(CREDENTIALS_FILE):
            return CREDENTIALS_FILE
        if os.path.exists("credentials.example.json"):
            return "credentials.example.json"
        return CREDENTIALS_FILE

    def _get_redirect_uri(self, explicit_uri: Optional[str] = None) -> str:
        """Resolve redirect URI from param, env var, credentials.json, or fallback."""
        if explicit_uri:
            return explicit_uri
        env_uri = os.getenv("GDRIVE_REDIRECT_URI")
        if env_uri:
            return env_uri
        try:
            creds_path = self._get_credentials_path()
            if os.path.exists(creds_path):
                with open(creds_path, "r") as f:
                    data = json.load(f)
                client_info = data.get("web", data.get("installed", {}))
                uris = client_info.get("redirect_uris", [])
                if uris:
                    for u in uris:
                        if "http" in u and "localhost" not in u:
                            return u
                    return uris[0]
        except Exception:
            pass
        return "urn:ietf:wg:oauth:2.0:oob"

    def _create_flow(self, redirect_uri: Optional[str] = None) -> Flow:
        """Create Flow instance compatible with both web and installed clients."""
        creds_path = self._get_credentials_path()
        flow = Flow.from_client_secrets_file(creds_path, SCOPES)
        flow.redirect_uri = self._get_redirect_uri(redirect_uri)
        # Disable PKCE auto-generation to prevent Missing code verifier on stateless exchange
        flow.autogenerate_code_verifier = False
        return flow

    def get_auth_url(self, redirect_uri: Optional[str] = None) -> str:
        """Generate OAuth authorization URL for auth flow."""
        flow = self._create_flow(redirect_uri)
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
        )
        return auth_url

    def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> bool:
        """Exchange authorization code for token and save to token.json."""
        try:
            flow = self._create_flow(redirect_uri)
            flow.fetch_token(code=code)
            creds = flow.credentials
            with open(TOKEN_FILE, "w") as token_file:
                token_file.write(creds.to_json())
            logger.info("Google Drive OAuth token saved successfully.")
            return True
        except Exception as e:
            logger.error(f"Failed to exchange authorization code: {e}")
            return False

    def get_credentials(self) -> Optional[Credentials]:
        """Load credentials from token.json, refresh if expired."""
        if not os.path.exists(TOKEN_FILE) or os.path.getsize(TOKEN_FILE) == 0:
            return None
        try:
            with open(TOKEN_FILE, "r") as f:
                content = f.read().strip()
                if not content or content == "{}":
                    return None
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
                with open(TOKEN_FILE, "w") as token_file:
                    token_file.write(creds.to_json())
            if creds and creds.valid:
                return creds
            return None
        except Exception as e:
            logger.warning(f"Failed to load/refresh credentials: {e}")
            return None

    def is_authenticated(self) -> bool:
        """Check if a valid token exists."""
        return self.get_credentials() is not None

    def _build_service(self) -> Any:
        """Build and return an authenticated Google Drive API service."""
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Not authenticated with Google Drive.")
        return build("drive", "v3", credentials=creds)

    def list_files(
        self, folder_id: str = "root", page_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """List files/folders in a Drive folder along with folder hierarchy metadata."""
        service = self._build_service()
        root_id = self._get_root_folder_id(service)
        is_root = not folder_id or folder_id == "root" or (root_id is not None and folder_id == root_id)
        effective_folder_id = "root" if is_root else folder_id

        query = f"'{effective_folder_id}' in parents and trashed = false"
        results = (
            service.files()
            .list(
                q=query,
                pageSize=50,
                fields="nextPageToken, files(id, name, mimeType, size, modifiedTime, parents)",
                pageToken=page_token,
                orderBy="folder,name",
            )
            .execute()
        )

        if is_root:
            breadcrumbs: List[Dict[str, str]] = []
            current_folder_name = "My Drive"
            parent_id: Optional[str] = None
        else:
            breadcrumbs = self._build_folder_path(service, effective_folder_id, root_id)
            current_folder_name = breadcrumbs[-1]["name"] if breadcrumbs else "Folder"
            parent_id = breadcrumbs[-2]["id"] if len(breadcrumbs) >= 2 else "root"

        return {
            "files": results.get("files", []),
            "nextPageToken": results.get("nextPageToken"),
            "currentFolderId": effective_folder_id,
            "currentFolderName": current_folder_name,
            "parentId": parent_id,
            "breadcrumbs": breadcrumbs,
        }

    def get_storage_quota(self) -> Dict[str, Any]:
        """Return storage quota and account information from Drive about()."""
        service = self._build_service()
        about = service.about().get(fields="storageQuota, user").execute()
        quota = about.get("storageQuota", {})
        user = about.get("user", {})
        return {
            "limit": int(quota.get("limit", 0)),
            "usage": int(quota.get("usage", 0)),
            "usageInDrive": int(quota.get("usageInDrive", 0)),
            "usageInTrash": int(quota.get("usageInTrash", 0)),
            "user_email": user.get("emailAddress"),
            "user_name": user.get("displayName"),
            "user_photo": user.get("photoLink"),
        }

    def delete_file(self, file_id: str) -> bool:
        """Delete a file or folder in Google Drive."""
        service = self._build_service()
        service.files().delete(fileId=file_id).execute()
        return True

    def empty_trash(self) -> bool:
        """Permanently empty all trashed files from Google Drive."""
        service = self._build_service()
        service.files().emptyTrash().execute()
        return True

    def rename_file(self, file_id: str, new_name: str) -> Dict[str, Any]:
        """Rename a file or folder in Google Drive."""
        service = self._build_service()
        updated = (
            service.files()
            .update(
                fileId=file_id,
                body={"name": new_name},
                fields="id, name, mimeType, size, modifiedTime, parents",
            )
            .execute()
        )
        return updated

    def batch_delete_files(self, file_ids: List[str]) -> Dict[str, Any]:
        """Delete multiple files or folders from Google Drive."""
        service = self._build_service()
        deleted = []
        errors = []
        for fid in file_ids:
            try:
                service.files().delete(fileId=fid).execute()
                deleted.append(fid)
            except Exception as e:
                errors.append({"file_id": fid, "error": str(e)})
        return {"deleted": deleted, "errors": errors}

    def create_folder(self, name: str, parent_id: str = "root") -> Dict[str, Any]:
        """Create a folder in Google Drive."""
        service = self._build_service()
        file_metadata = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        folder = (
            service.files()
            .create(body=file_metadata, fields="id, name, mimeType, parents")
            .execute()
        )
        return folder

    def _normalize_file_path(self, path: str, torrent_hash: Optional[str] = None) -> str:
        """Resolve path inside container if host path was passed or auto-match torrent content."""
        import glob
        from app.core.config import settings

        # 1. If torrent_hash is passed, query qBittorrent first
        if torrent_hash:
            try:
                from app.services.qbit_service import qbit_service
                connected, _ = qbit_service.check_connection()
                if connected:
                    torrent_info = qbit_service.get_torrent(torrent_hash)
                    if torrent_info and torrent_info.get("content_path"):
                        cpath = torrent_info["content_path"]
                        if os.path.exists(cpath):
                            return cpath
                        cpath_norm = self._normalize_file_path(cpath)
                        if os.path.exists(cpath_norm):
                            return cpath_norm
            except Exception as e:
                logger.warning(f"Failed to lookup torrent by hash {torrent_hash}: {e}")

        if path and os.path.exists(path):
            return path

        if not path:
            return ""

        basename = os.path.basename(path.rstrip("/\\"))
        download_dirs = [
            "/downloads",
            getattr(settings, "DEFAULT_SAVE_PATH", "/downloads/").rstrip("/\\"),
            "/home/boxd/Downloads",
            "/home/boxd/fastapi-qbit/downloads",
            "./downloads",
        ]

        candidates = [
            os.path.join("/downloads", basename),
            path.replace("/home/boxd/Downloads", "/downloads"),
            path.replace("/home/boxd/fastapi-qbit/downloads", "/downloads"),
            os.path.join("/home/boxd/Downloads", basename),
            os.path.join("/home/boxd/fastapi-qbit/downloads", basename),
        ]
        for c in candidates:
            if os.path.exists(c):
                return c

        # 2. Check for filename with extension or prefix matching in download directories
        for d in download_dirs:
            if not os.path.exists(d) or not os.path.isdir(d):
                continue
            escaped = glob.escape(basename)
            matches = glob.glob(os.path.join(d, f"{escaped}*"))
            if matches and os.path.exists(matches[0]):
                return matches[0]
            try:
                for entry in os.listdir(d):
                    full = os.path.join(d, entry)
                    if entry.lower() == basename.lower():
                        return full
                    if entry.lower().startswith(basename.lower()[:30]) or basename.lower().startswith(entry.lower()[:30]):
                        return full
            except OSError:
                pass

        # 3. Try finding torrent in qBittorrent matching basename or part of name
        try:
            from app.services.qbit_service import qbit_service
            connected, _ = qbit_service.check_connection()
            if connected:
                torrents = qbit_service.list_torrents()
                for t in torrents:
                    t_name = t.get("name", "")
                    t_hash = t.get("hash", "")
                    if basename == t_hash or basename == t_name or basename in t_name or t_name in basename:
                        cpath = t.get("content_path")
                        if cpath and os.path.exists(cpath):
                            return cpath
                        if cpath:
                            for d in download_dirs:
                                c = os.path.join(d, os.path.basename(cpath))
                                if os.path.exists(c):
                                    return c
        except Exception as e:
            logger.warning(f"Failed to lookup torrent from qbittorrent: {e}")

        return path

    def _get_path_size(self, path: str) -> int:
        """Calculate total size for a file or directory tree."""
        if os.path.isfile(path):
            return os.path.getsize(path)
        total = 0
        for root, _, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
        return total

    def start_resumable_upload(
        self, file_path: str = "", folder_id: str = "root", torrent_hash: Optional[str] = None
    ) -> str:
        """Start a resumable upload for a local file or directory. Returns upload_id."""
        resolved_path = self._normalize_file_path(file_path, torrent_hash=torrent_hash)
        if not os.path.exists(resolved_path):
            raise FileNotFoundError(
                f"File or directory not found: '{file_path or torrent_hash}'. "
                f"Make sure the file exists in the server download directory."
            )

        upload_id = str(uuid.uuid4())
        filename = os.path.basename(resolved_path.rstrip("/\\")) or "upload"
        total_bytes = self._get_path_size(resolved_path)

        upload_state = UploadState(
            upload_id=upload_id,
            filename=filename,
            file_path=resolved_path,
            folder_id=folder_id,
            status="uploading",
            total_bytes=total_bytes,
            torrent_hash=torrent_hash,
        )
        self._uploads[upload_id] = upload_state

        thread = threading.Thread(
            target=self._upload_worker,
            args=(upload_id,),
            daemon=True,
        )
        thread.start()
        return upload_id

    def _upload_single_file(
        self, service: Any, local_path: str, parent_id: str, state: UploadState, base_uploaded: int
    ) -> int:
        """Upload a single file using resumable upload and update progress."""
        file_size = os.path.getsize(local_path)
        filename = os.path.basename(local_path)
        media = MediaFileUpload(
            local_path,
            resumable=True,
            chunksize=5 * 1024 * 1024,  # 5 MB chunks
        )
        file_metadata = {
            "name": filename,
            "parents": [parent_id],
        }
        request = service.files().create(
            body=file_metadata, media_body=media, fields="id, name"
        )
        response = None
        while response is None:
            upload_status, response = request.next_chunk()
            if upload_status and state.total_bytes > 0:
                current_file_bytes = int(upload_status.progress() * file_size)
                state.bytes_uploaded = min(state.total_bytes, base_uploaded + current_file_bytes)
                state.progress_percent = round((state.bytes_uploaded / state.total_bytes) * 100, 2)
        if response and response.get("id"):
            state.drive_file_id = response.get("id")
        return file_size

    def _upload_directory(
        self, service: Any, dir_path: str, parent_id: str, state: UploadState
    ) -> None:
        """Upload a directory recursively into Google Drive."""
        root_folder_meta = {
            "name": os.path.basename(dir_path.rstrip("/\\")) or "Uploads",
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        drive_root = service.files().create(body=root_folder_meta, fields="id").execute()
        drive_root_id = drive_root["id"]
        state.drive_file_id = drive_root_id

        folder_map = {os.path.abspath(dir_path): drive_root_id}
        uploaded_accumulated = 0

        for current_root, dirs, files in os.walk(dir_path):
            abs_current = os.path.abspath(current_root)
            current_parent_drive_id = folder_map.get(abs_current, drive_root_id)

            # Create subfolders
            for d in dirs:
                sub_dir_path = os.path.join(abs_current, d)
                sub_meta = {
                    "name": d,
                    "mimeType": "application/vnd.google-apps.folder",
                    "parents": [current_parent_drive_id],
                }
                sub_folder = service.files().create(body=sub_meta, fields="id").execute()
                folder_map[sub_dir_path] = sub_folder["id"]

            # Upload files
            for f in files:
                file_full_path = os.path.join(current_root, f)
                if os.path.isfile(file_full_path):
                    uploaded_size = self._upload_single_file(
                        service, file_full_path, current_parent_drive_id, state, uploaded_accumulated
                    )
                    uploaded_accumulated += uploaded_size
                    state.bytes_uploaded = min(state.total_bytes, uploaded_accumulated)
                    if state.total_bytes > 0:
                        state.progress_percent = round((state.bytes_uploaded / state.total_bytes) * 100, 2)

    def _upload_worker(self, upload_id: str) -> None:
        """Background thread worker for resumable uploads."""
        state = self._uploads.get(upload_id)
        if not state:
            return

        try:
            service = self._build_service()
            if os.path.isdir(state.file_path):
                self._upload_directory(service, state.file_path, state.folder_id, state)
            else:
                self._upload_single_file(service, state.file_path, state.folder_id, state, 0)

            state.progress_percent = 100.0
            state.bytes_uploaded = state.total_bytes
            state.status = "completed"
            logger.info(f"Upload completed: {state.filename} (upload_id={upload_id})")
        except Exception as e:
            state.status = "failed"
            state.error = str(e)
            logger.error(f"Upload failed for {state.filename}: {e}", exc_info=True)

    def get_upload_progress(self, upload_id: str) -> Optional[Dict[str, Any]]:
        """Return upload progress for a given upload_id."""
        state = self._uploads.get(upload_id)
        if not state:
            return None
        return {
            "upload_id": state.upload_id,
            "filename": state.filename,
            "progress_percent": state.progress_percent,
            "status": state.status,
            "bytes_uploaded": state.bytes_uploaded,
            "total_bytes": state.total_bytes,
            "drive_file_id": state.drive_file_id,
            "torrent_hash": state.torrent_hash,
            "file_path": state.file_path,
        }

    def get_all_uploads(self) -> List[Dict[str, Any]]:
        """Return progress for all tracked uploads."""
        return [
            {
                "upload_id": s.upload_id,
                "filename": s.filename,
                "progress_percent": s.progress_percent,
                "status": s.status,
                "bytes_uploaded": s.bytes_uploaded,
                "total_bytes": s.total_bytes,
                "drive_file_id": s.drive_file_id,
                "torrent_hash": s.torrent_hash,
                "file_path": s.file_path,
            }
            for s in self._uploads.values()
        ]

    def clear_completed_uploads(self) -> int:
        """Removes completed or failed uploads from in-memory tracking."""
        to_delete = [
            uid for uid, s in self._uploads.items()
            if s.status in ("completed", "failed")
        ]
        for uid in to_delete:
            del self._uploads[uid]
        return len(to_delete)

    def _build_folder_path(
        self, service: Any, folder_id: str, root_id: Optional[str] = None
    ) -> List[Dict[str, str]]:
        """Build breadcrumb path from folder_id up to (but excluding) My Drive root."""
        if not folder_id or folder_id == "root" or (root_id and folder_id == root_id):
            return []

        path: List[Dict[str, str]] = []
        current_id: Optional[str] = folder_id
        visited = set()

        while current_id and current_id not in visited:
            if current_id == "root" or (root_id and current_id == root_id):
                break
            visited.add(current_id)
            try:
                file_meta = (
                    service.files()
                    .get(fileId=current_id, fields="id, name, parents")
                    .execute()
                )
                parents = file_meta.get("parents")
                if not parents and file_meta.get("name") == "My Drive":
                    self._root_folder_id = file_meta["id"]
                    break
                path.insert(0, {"id": file_meta["id"], "name": file_meta["name"]})
                current_id = parents[0] if parents else None
            except Exception:
                break

        return path

    def get_folder_path(self, folder_id: str) -> List[Dict[str, str]]:
        """Build breadcrumb path from folder_id up to root."""
        service = self._build_service()
        root_id = self._get_root_folder_id(service)
        return self._build_folder_path(service, folder_id, root_id)

    def download_file_url(self, file_id: str) -> str:
        """Generate webContentLink or export link for a file."""
        service = self._build_service()
        file_meta = (
            service.files()
            .get(fileId=file_id, fields="id, name, mimeType, webContentLink")
            .execute()
        )
        web_link = file_meta.get("webContentLink")
        if web_link:
            return web_link
        # For Google Docs types, return an export link
        mime = file_meta.get("mimeType", "")
        if mime.startswith("application/vnd.google-apps."):
            export_map = {
                "application/vnd.google-apps.document": "application/pdf",
                "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.google-apps.presentation": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            }
            export_mime = export_map.get(mime, "application/pdf")
            return f"https://www.googleapis.com/drive/v3/files/{file_id}/export?mimeType={export_mime}"
        return f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"

    def get_file_metadata(self, file_id: str) -> Dict[str, Any]:
        """Fetch metadata for a single Google Drive file or folder, including parent hierarchy."""
        service = self._build_service()
        root_id = self._get_root_folder_id(service)
        fields = "id, name, mimeType, size, modifiedTime, createdTime, md5Checksum, webContentLink, webViewLink, thumbnailLink, parents, iconLink"
        item = service.files().get(fileId=file_id, fields=fields).execute()
        raw_parents = item.get("parents", [])
        normalized_parents = [
            "root" if (root_id and p == root_id) else p for p in raw_parents
        ]
        raw_parent = normalized_parents[0] if normalized_parents else None
        if raw_parent and raw_parent != "root":
            breadcrumbs = self._build_folder_path(service, raw_parent, root_id)
            parent_id = breadcrumbs[-1]["id"] if breadcrumbs else "root"
        else:
            breadcrumbs = []
            parent_id = "root" if raw_parent == "root" else None

        return {
            "id": item["id"],
            "name": item["name"],
            "mimeType": item["mimeType"],
            "size": int(item["size"]) if "size" in item else None,
            "modifiedTime": item.get("modifiedTime"),
            "createdTime": item.get("createdTime"),
            "md5Checksum": item.get("md5Checksum"),
            "webContentLink": item.get("webContentLink"),
            "webViewLink": item.get("webViewLink"),
            "thumbnailLink": item.get("thumbnailLink"),
            "parents": normalized_parents,
            "parentId": parent_id,
            "breadcrumbs": breadcrumbs,
            "iconLink": item.get("iconLink"),
        }

    def get_access_token_info(self) -> Dict[str, Any]:
        """Return valid Google Drive access token, expiry, and OAuth credentials for edge workers."""
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Not authenticated with Google Drive.")

        info: Dict[str, Any] = {
            "access_token": creds.token,
            "expiry": creds.expiry.isoformat() if getattr(creds, "expiry", None) else None,
            "token_uri": getattr(creds, "token_uri", "https://oauth2.googleapis.com/token"),
        }
        if getattr(creds, "refresh_token", None):
            info["refresh_token"] = creds.refresh_token
        if getattr(creds, "client_id", None):
            info["client_id"] = creds.client_id
        if getattr(creds, "client_secret", None):
            info["client_secret"] = creds.client_secret

        # If client credentials missing on creds object, try to load from credentials file
        try:
            creds_path = self._get_credentials_path()
            if os.path.exists(creds_path):
                with open(creds_path, "r") as f:
                    cdata = json.load(f)
                client_info = cdata.get("web", cdata.get("installed", {}))
                if "client_id" in client_info and "client_id" not in info:
                    info["client_id"] = client_info["client_id"]
                if "client_secret" in client_info and "client_secret" not in info:
                    info["client_secret"] = client_info["client_secret"]
        except Exception as e:
            logger.debug(f"Failed to load extra client creds: {e}")

        return info

    def open_download_stream(self, file_id: str, range_header: Optional[str] = None):
        """Open a streaming connection to Google Drive API v3 alt=media with range header support."""
        import requests
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Not authenticated with Google Drive.")
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&supportsAllDrives=true"
        headers = {"Authorization": f"Bearer {creds.token}"}
        if range_header:
            headers["Range"] = range_header
        return requests.get(url, headers=headers, stream=True, timeout=60)

    def logout(self) -> None:
        """Delete token.json to log out."""
        self._root_folder_id = None
        if os.path.exists(TOKEN_FILE):
            try:
                os.remove(TOKEN_FILE)
            except OSError:
                with open(TOKEN_FILE, "w") as f:
                    f.write("{}")
            logger.info("Google Drive token removed (logged out).")

    # --- Default path settings (persisted to gdrive_settings.json) ---

    def get_default_path(self) -> Dict[str, Optional[str]]:
        """Get the saved default upload folder from gdrive_settings.json."""
        if not os.path.exists(GDRIVE_SETTINGS_FILE):
            return {"folder_id": None, "folder_name": None}
        try:
            with open(GDRIVE_SETTINGS_FILE, "r") as f:
                data = json.load(f)
            return {
                "folder_id": data.get("default_upload_folder_id"),
                "folder_name": data.get("default_upload_folder_name"),
            }
        except Exception:
            return {"folder_id": None, "folder_name": None}

    def set_default_path(self, folder_id: str, folder_name: str) -> None:
        """Save the default upload folder to gdrive_settings.json."""
        data: Dict[str, Any] = {}
        if os.path.exists(GDRIVE_SETTINGS_FILE):
            try:
                with open(GDRIVE_SETTINGS_FILE, "r") as f:
                    data = json.load(f)
            except Exception:
                data = {}
        data["default_upload_folder_id"] = folder_id
        data["default_upload_folder_name"] = folder_name
        with open(GDRIVE_SETTINGS_FILE, "w") as f:
            json.dump(data, f, indent=2)


gdrive_service = GDriveService()
