import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def mock_gdrive_settings_file(tmp_path, monkeypatch):
    test_settings_file = str(tmp_path / "gdrive_settings.json")
    monkeypatch.setattr("app.services.gdrive_service.GDRIVE_SETTINGS_FILE", test_settings_file)



@pytest.mark.anyio
async def test_gdrive_auth_status():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/drive/auth/status")
        assert response.status_code == 200
        data = response.json()
        assert "authenticated" in data
        assert isinstance(data["authenticated"], bool)


@pytest.mark.anyio
async def test_gdrive_auth_url():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/drive/auth/url")
        assert response.status_code == 200
        data = response.json()
        assert "auth_url" in data
        assert "accounts.google.com" in data["auth_url"]


@pytest.mark.anyio
async def test_gdrive_default_path():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Set default path
        post_resp = await client.post(
            "/api/v1/drive/default-path",
            json={"folder_id": "test_folder_id", "folder_name": "Torrents Backup"},
        )
        assert post_resp.status_code == 200
        post_data = post_resp.json()
        assert post_data["folder_id"] == "test_folder_id"
        assert post_data["folder_name"] == "Torrents Backup"

        # Get default path
        get_resp = await client.get("/api/v1/drive/default-path")
        assert get_resp.status_code == 200
        get_data = get_resp.json()
        assert get_data["folder_id"] == "test_folder_id"
        assert get_data["folder_name"] == "Torrents Backup"


@pytest.mark.anyio
async def test_gdrive_uploads_list():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/drive/uploads")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


@pytest.mark.anyio
async def test_gdrive_upload_nonexistent_file():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/drive/upload",
            json={"file_path": "/nonexistent/path/torrent.iso", "folder_id": "root"},
        )
        # Should return 404 Not Found
        assert response.status_code == 404


@pytest.mark.anyio
async def test_gdrive_aliases():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Test fallback alias /api/v1/gdrive/uploads
        res1 = await client.get("/api/v1/gdrive/uploads")
        assert res1.status_code == 200

        # Test direct root mount /drive/uploads
        res2 = await client.get("/drive/uploads")
        assert res2.status_code == 200


@pytest.mark.anyio
async def test_gdrive_upload_missing_params():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/drive/upload",
            json={"folder_id": "root"},
        )
        assert response.status_code == 422


@pytest.mark.anyio
async def test_gdrive_list_files_includes_hierarchy_metadata(monkeypatch):
    from app.services.gdrive_service import gdrive_service

    class _FakeExec:
        def __init__(self, payload):
            self._payload = payload

        def execute(self):
            return self._payload

    class _FakeFilesResource:
        def get(self, fileId, fields):
            mapping = {
                "root": {"id": "root_actual_id", "name": "My Drive"},
                "sub_dl": {"id": "sub_dl", "name": "Download", "parents": ["root_actual_id"]},
                "file_1": {
                    "id": "file_1",
                    "name": "episode01.mkv",
                    "mimeType": "video/x-matroska",
                    "size": "1234",
                    "modifiedTime": "2026-11-12T10:00:00Z",
                    "parents": ["sub_dl"],
                },
            }
            return _FakeExec(mapping[fileId])

        def list(self, **kwargs):
            return _FakeExec({
                "files": [
                    {
                        "id": "file_1",
                        "name": "episode01.mkv",
                        "mimeType": "video/x-matroska",
                        "size": "1234",
                        "modifiedTime": "2026-11-12T10:00:00Z",
                        "parents": ["sub_dl"],
                    }
                ],
                "nextPageToken": None,
            })

    class _FakeService:
        def files(self):
            return _FakeFilesResource()

    gdrive_service._root_folder_id = None
    monkeypatch.setattr(gdrive_service, "_build_service", lambda: _FakeService())

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        sub_resp = await client.get("/api/v1/drive/files", params={"folder_id": "sub_dl"})
        assert sub_resp.status_code == 200
        sub_data = sub_resp.json()
        assert sub_data["currentFolderId"] == "sub_dl"
        assert sub_data["currentFolderName"] == "Download"
        assert sub_data["parentId"] == "root"
        assert sub_data["breadcrumbs"] == [{"id": "sub_dl", "name": "Download"}]

        root_resp = await client.get("/api/v1/drive/files", params={"folder_id": "root"})
        assert root_resp.status_code == 200
        root_data = root_resp.json()
        assert root_data["currentFolderId"] == "root"
        assert root_data["currentFolderName"] == "My Drive"
        assert root_data["parentId"] is None
        assert root_data["breadcrumbs"] == []

        meta_resp = await client.get("/api/v1/drive/files/file_1/meta")
        assert meta_resp.status_code == 200
        # Verify folder path excludes My Drive root
        path_resp = await client.get("/api/v1/drive/files/sub_dl/path")
        assert path_resp.status_code == 200
        assert path_resp.json() == [{"id": "sub_dl", "name": "Download"}]


@pytest.mark.anyio
async def test_gdrive_download_to_server():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Empty items validation
        empty_resp = await client.post(
            "/api/v1/drive/download-to-server",
            json={"items": []},
        )
        assert empty_resp.status_code == 422

        # Start download task
        start_resp = await client.post(
            "/api/v1/drive/download-to-server",
            json={
                "items": [
                    {
                        "file_id": "test_gdrive_file_id",
                        "name": "Test.Episode.S01E01.mkv",
                        "size": 1048576,
                        "mime_type": "video/x-matroska",
                    }
                ],
                "destination_path": "/tmp/test-downloads",
                "auto_attach_reseed": True,
            },
        )
        assert start_resp.status_code == 200
        data = start_resp.json()
        assert data["success"] is True
        assert len(data["task_ids"]) == 1
        task_id = data["task_ids"][0]

        # List downloads
        list_resp = await client.get("/api/v1/drive/downloads-to-server")
        assert list_resp.status_code == 200
        items = list_resp.json()
        assert any(item["task_id"] == task_id for item in items)

        # Get task progress
        prog_resp = await client.get(f"/api/v1/drive/downloads-to-server/{task_id}/progress")
        assert prog_resp.status_code == 200
        task_data = prog_resp.json()
        assert task_data["task_id"] == task_id
        assert task_data["filename"] == "Test.Episode.S01E01.mkv"
        assert task_data["auto_attach_reseed"] is True

        # Cancel / remove task
        cancel_resp = await client.delete(f"/api/v1/drive/downloads-to-server/{task_id}")
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["success"] is True

        # Clear completed
        clear_resp = await client.delete("/api/v1/drive/downloads-to-server/completed")
        assert clear_resp.status_code == 200
        assert "cleared_count" in clear_resp.json()



