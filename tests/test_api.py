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
async def test_list_torrents(monkeypatch):
    from app.services.qbit_service import qbit_service

    monkeypatch.setattr(qbit_service, "list_torrents", lambda **kwargs: [])
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


@pytest.mark.anyio
async def test_system_stats_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/system/stats")
        assert response.status_code == 200
        data = response.json()
        assert "hostname" in data
        assert "os_name" in data
        assert "cpu_cores" in data and data["cpu_cores"] >= 1
        assert "ram_total_bytes" in data and data["ram_total_bytes"] > 0
        assert "disk_total_bytes" in data and data["disk_total_bytes"] > 0
        assert "uptime_seconds" in data


@pytest.mark.anyio
async def test_system_paths_traversal_protection(tmp_path, monkeypatch):
    from app.core.config import settings

    sub = tmp_path / "complete"
    sub.mkdir()
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(tmp_path))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Allowed root browse
        ok_resp = await client.get("/api/v1/system/paths")
        assert ok_resp.status_code == 200
        ok_data = ok_resp.json()
        assert any(d["name"] == "complete" for d in ok_data["directories"])

        # Traversal attempt outside DEFAULT_SAVE_PATH must be rejected
        bad_resp = await client.get("/api/v1/system/paths", params={"path": str(tmp_path.parent)})
        assert bad_resp.status_code == 403


@pytest.mark.anyio
async def test_add_magnet_reseed_params(monkeypatch):
    from app.services.qbit_service import qbit_service

    captured = {}

    def fake_add_magnet(**kwargs):
        captured.update(kwargs)
        return "Ok."

    monkeypatch.setattr(qbit_service, "add_magnet", fake_add_magnet)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/torrents/add-magnet",
            json={
                "magnet_url": "magnet:?xt=urn:btih:3b245504cf5f11bbdbe1201cea6a6bf45a004e6d",
                "save_path": "/downloads/complete",
                "skip_checking": True,
                "auto_tmm": False,
            },
        )
        assert response.status_code == 201
        assert response.json()["success"] is True
        assert captured["save_path"] == "/downloads/complete"
        assert captured["skip_checking"] is True
        assert captured["auto_tmm"] is False


@pytest.mark.anyio
async def test_add_file_reseed_params(monkeypatch):
    from app.services.qbit_service import qbit_service

    captured = {}

    def fake_add_torrent_file(**kwargs):
        captured.update(kwargs)
        return "Ok."

    monkeypatch.setattr(qbit_service, "add_torrent_file", fake_add_torrent_file)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/torrents/add-file",
            files={"file": ("ubuntu.torrent", b"d8:announce1:xe", "application/x-bittorrent")},
            data={
                "save_path": "/downloads/complete",
                "skip_checking": "true",
                "auto_tmm": "false",
            },
        )
        assert response.status_code == 201
        assert response.json()["success"] is True
        assert captured["save_path"] == "/downloads/complete"
        assert captured["skip_checking"] is True
        assert captured["auto_tmm"] is False


@pytest.mark.anyio
async def test_add_magnet_torrents_added_metadata_success(monkeypatch):
    import qbittorrentapi
    from app.services.qbit_service import qbit_service

    meta = qbittorrentapi.torrents.TorrentsAddedMetadata(
        {
            "added_torrent_ids": ["094a7f561ec0c6bafd4bee07842b610e3d475386"],
            "failure_count": 0,
            "pending_count": 0,
            "success_count": 1,
        }
    )
    monkeypatch.setattr(qbit_service, "add_magnet", lambda **kwargs: meta)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/torrents/add-magnet",
            json={
                "magnet_url": "magnet:?xt=urn:btih:094a7f561ec0c6bafd4bee07842b610e3d475386",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["success"] is True
        assert data["message"] == "Magnet link successfully queued for download."


@pytest.mark.anyio
async def test_add_magnet_torrents_added_metadata_failure(monkeypatch):
    import qbittorrentapi
    from app.services.qbit_service import qbit_service

    meta = qbittorrentapi.torrents.TorrentsAddedMetadata(
        {
            "added_torrent_ids": [],
            "failure_count": 1,
            "pending_count": 0,
            "success_count": 0,
        }
    )
    monkeypatch.setattr(qbit_service, "add_magnet", lambda **kwargs: meta)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/torrents/add-magnet",
            json={
                "magnet_url": "magnet:?xt=urn:btih:094a7f561ec0c6bafd4bee07842b610e3d475386",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["success"] is False
        assert "Could not add magnet link" in data["message"]


