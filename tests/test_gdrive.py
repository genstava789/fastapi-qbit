import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


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

