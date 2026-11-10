import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_root_dashboard():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/")
        assert response.status_code == 200
        assert "fastapi-qbit" in response.text
        assert "qBittorrent Web UI" in response.text


@pytest.mark.anyio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "app_version" in data
        assert "qbittorrent_connected" in data


@pytest.mark.anyio
async def test_list_torrents():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/torrents")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


@pytest.mark.anyio
async def test_add_magnet_validation_error():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/torrents/add-magnet",
            json={"magnet_url": "https://example.com/not-a-magnet"},
        )
        assert response.status_code == 422


@pytest.mark.anyio
async def test_add_file_validation_error():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        files = {"file": ("test.txt", b"plain text content", "text/plain")}
        response = await client.post("/api/v1/torrents/add-file", files=files)
        assert response.status_code == 400
        assert "must have a .torrent extension" in response.json()["detail"]


@pytest.mark.anyio
async def test_webtorrent_redirect():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/webtorrent", follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"] == "/webtorrent/"

