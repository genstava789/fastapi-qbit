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


class GDriveService:
    def __init__(self) -> None:
        self._uploads: Dict[str, UploadState] = {}

    def _get_redirect_uri(self, explicit_uri: Optional[str] = None) -> str:
        """Resolve redirect URI from param, env var, credentials.json, or fallback."""
        if explicit_uri:
            return explicit_uri
        env_uri = os.getenv("GDRIVE_REDIRECT_URI")
        if env_uri:
            return env_uri
        try:
            if os.path.exists(CREDENTIALS_FILE):
                with open(CREDENTIALS_FILE, "r") as f:
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
        flow = Flow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
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
        """List files/folders in a Drive folder."""
        service = self._build_service()
        query = f"'{folder_id}' in parents and trashed = false"
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
        return {
            "files": results.get("files", []),
            "nextPageToken": results.get("nextPageToken"),
        }

    def get_storage_quota(self) -> Dict[str, Any]:
        """Return storage quota information from Drive about()."""
        service = self._build_service()
        about = service.about().get(fields="storageQuota").execute()
        quota = about.get("storageQuota", {})
        return {
            "limit": int(quota.get("limit", 0)),
            "usage": int(quota.get("usage", 0)),
            "usageInDrive": int(quota.get("usageInDrive", 0)),
            "usageInTrash": int(quota.get("usageInTrash", 0)),
        }

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

    def _normalize_file_path(self, path: str) -> str:
        """Resolve path inside container if host path was passed."""
        if os.path.exists(path):
            return path
        basename = os.path.basename(path.rstrip("/\\"))
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
        self, file_path: str, folder_id: str = "root"
    ) -> str:
        """Start a resumable upload for a local file or directory. Returns upload_id."""
        resolved_path = self._normalize_file_path(file_path)
        if not os.path.exists(resolved_path):
            raise FileNotFoundError(f"File or directory not found: {file_path}")

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
            }
            for s in self._uploads.values()
        ]

    def get_folder_path(self, folder_id: str) -> List[Dict[str, str]]:
        """Build breadcrumb path from folder_id up to root."""
        service = self._build_service()
        path: List[Dict[str, str]] = []
        current_id = folder_id

        while current_id:
            try:
                file_meta = (
                    service.files()
                    .get(fileId=current_id, fields="id, name, parents")
                    .execute()
                )
                path.insert(0, {"id": file_meta["id"], "name": file_meta["name"]})
                parents = file_meta.get("parents")
                current_id = parents[0] if parents else None
            except Exception:
                break

        return path

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

    def logout(self) -> None:
        """Delete token.json to log out."""
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
