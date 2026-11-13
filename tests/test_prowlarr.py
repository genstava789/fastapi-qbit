import json
import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def isolated_prowlarr_settings(tmp_path, monkeypatch):
    settings_path = tmp_path / "prowlarr_settings.json"
    monkeypatch.setenv("PROWLARR_SETTINGS_FILE", str(settings_path))
    monkeypatch.setattr(settings, "PROWLARR_URL", None)
    monkeypatch.setattr(settings, "PROWLARR_API_KEY", None)
    return settings_path


@pytest.mark.anyio
async def test_prowlarr_config_lifecycle(isolated_prowlarr_settings):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Initially unconfigured
        res = await client.get("/api/v1/prowlarr/config")
        assert res.status_code == 200
        assert res.json() == {
            "configured": False,
            "url": None,
            "has_api_key": False,
            "api_key_masked": None,
            "message": None,
        }

        # Invalid URL rejected
        bad_url = await client.put(
            "/api/v1/prowlarr/config",
            json={"url": "ftp://prowlarr.local", "api_key": "abc123456789"},
        )
        assert bad_url.status_code == 422

        # Missing API key on initial setup rejected
        missing_key = await client.put(
            "/api/v1/prowlarr/config",
            json={"url": "http://localhost:9696/"},
        )
        assert missing_key.status_code == 400

        # Save initial config
        saved = await client.put(
            "/api/v1/prowlarr/config",
            json={"url": "https://prowlarr.example.com/", "api_key": "1234567890abcdef"},
        )
        assert saved.status_code == 200
        saved_data = saved.json()
        assert saved_data["configured"] is True
        assert saved_data["url"] == "https://prowlarr.example.com"
        assert saved_data["has_api_key"] is True
        assert saved_data["api_key_masked"] == "1234********cdef"

        persisted = json.loads(isolated_prowlarr_settings.read_text(encoding="utf-8"))
        assert persisted == {
            "url": "https://prowlarr.example.com",
            "api_key": "1234567890abcdef",
        }

        # Updating only URL keeps the saved API key
        updated = await client.put(
            "/api/v1/prowlarr/config",
            json={"url": "http://127.0.0.1:9696/"},
        )
        assert updated.status_code == 200
        assert updated.json()["url"] == "http://127.0.0.1:9696"
        assert updated.json()["api_key_masked"] == "1234********cdef"

        # Updating with masked key retains the actual saved key
        masked_update = await client.put(
            "/api/v1/prowlarr/config",
            json={"url": "http://127.0.0.1:9696/api/v1", "api_key": "1234********cdef"},
        )
        assert masked_update.status_code == 200
        assert masked_update.json()["url"] == "http://127.0.0.1:9696"
        persisted_masked = json.loads(isolated_prowlarr_settings.read_text(encoding="utf-8"))
        assert persisted_masked["api_key"] == "1234567890abcdef"

        # Clear config
        cleared = await client.delete("/api/v1/prowlarr/config")
        assert cleared.status_code == 200
        assert cleared.json()["configured"] is False
        assert not isolated_prowlarr_settings.exists()


@pytest.mark.anyio
async def test_prowlarr_test_connection(monkeypatch):
    captured = {}

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, headers=None, params=None):
            captured["url"] = url
            captured["headers"] = headers
            return httpx.Response(
                200,
                json={"version": "1.24.0.4765", "appName": "Prowlarr"},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Unconfigured test fails cleanly
        fail_res = await client.post("/api/v1/prowlarr/test")
        assert fail_res.status_code == 400

        # Explicit payload test succeeds without saving
        ok_res = await client.post(
            "/api/v1/prowlarr/test",
            json={"url": "https://prowlarr.local/", "api_key": "secret-key-9999"},
        )
        assert ok_res.status_code == 200
        assert ok_res.json() == {
            "connected": True,
            "version": "1.24.0.4765",
            "app_name": "Prowlarr",
            "message": "Connected to Prowlarr successfully.",
        }
        assert captured["url"] == "https://prowlarr.local/api/v1/system/status"
        assert captured["headers"] == {"X-Api-Key": "secret-key-9999"}

        # Testing with saved config and masked key passes saved real key
        await client.put(
            "/api/v1/prowlarr/config",
            json={"url": "https://prowlarr.saved.local", "api_key": "saved-actual-secret"},
        )
        masked_test_res = await client.post(
            "/api/v1/prowlarr/test",
            json={"url": "https://prowlarr.saved.local/api/v1", "api_key": "save********cret"},
        )
        assert masked_test_res.status_code == 200
        assert captured["url"] == "https://prowlarr.saved.local/api/v1/system/status"
        assert captured["headers"] == {"X-Api-Key": "saved-actual-secret"}


@pytest.mark.anyio
async def test_prowlarr_search(monkeypatch):
    captured = {}

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, headers=None, params=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["params"] = params
            return httpx.Response(
                200,
                json=[
                    {
                        "title": "Ubuntu 24.04 LTS ISO",
                        "size": 6123456789,
                        "seeders": 120,
                        "leechers": 5,
                        "magnetUrl": "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
                        "downloadUrl": "http://prowlarr.local/1/download?apikey=my-api-key",
                        "infoUrl": "https://indexer.example/item/1",
                        "indexer": "LinuxTracker",
                        "publishDate": "2026-11-12T10:00:00Z",
                        "categories": [{"id": 2000, "name": "Movies"}, {"id": 5000, "name": "TV"}],
                        "guid": "guid-1",
                    },
                    {
                        "title": "Debian Netinst",
                        "size": 700000000,
                        "seeders": 40,
                        "leechers": 2,
                        "downloadUrl": "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01",
                        "indexer": "DebianMirror",
                        "publishDate": "2026-11-11T09:00:00Z",
                        "categories": ["Software"],
                    },
                ],
                request=httpx.Request("GET", url),
            )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Search before configuring returns 400
        unconfigured = await client.get("/api/v1/prowlarr/search", params={"query": "ubuntu"})
        assert unconfigured.status_code == 400

        await client.put(
            "/api/v1/prowlarr/config",
            json={"url": "http://prowlarr.local:9696", "api_key": "my-api-key"},
        )

        monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)
        res = await client.get(
            "/api/v1/prowlarr/search",
            params={"query": "ubuntu", "type": "search", "categories": [2000, 5000], "limit": 25},
        )
        assert res.status_code == 200
        items = res.json()
        assert len(items) == 2
        assert items[0]["title"] == "Ubuntu 24.04 LTS ISO"
        assert items[0]["categories"] == ["Movies", "TV"]
        assert items[1]["magnetUrl"] == "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01"
        assert items[1]["categories"] == ["Software"]

        assert captured["url"] == "http://prowlarr.local:9696/api/v1/search"
        assert captured["headers"] == {"X-Api-Key": "my-api-key"}
        assert ("query", "ubuntu") in captured["params"]
        assert ("categories", "2000") in captured["params"]
        assert ("categories", "5000") in captured["params"]


@pytest.mark.anyio
async def test_prowlarr_add_magnet_and_torrent_download(monkeypatch):
    from app.services.qbit_service import qbit_service

    added_magnets = []
    added_files = []
    outbound_headers = []

    monkeypatch.setattr(
        qbit_service,
        "add_magnet",
        lambda **kwargs: added_magnets.append(kwargs) or "Ok.",
    )
    monkeypatch.setattr(
        qbit_service,
        "add_torrent_file",
        lambda **kwargs: added_files.append(kwargs) or "Ok.",
    )

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, headers=None, params=None):
            outbound_headers.append((url, dict(headers or {})))
            if url.endswith("/redirect-magnet"):
                return httpx.Response(
                    302,
                    headers={"Location": "magnet:?xt=urn:btih:1111222233334444555566667777888899990000"},
                    request=httpx.Request("GET", url),
                )
            return httpx.Response(
                200,
                content=b"d8:announce17:http://tracker/ee",
                request=httpx.Request("GET", url),
            )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.put(
            "/api/v1/prowlarr/config",
            json={"url": "http://prowlarr.local:9696", "api_key": "secret-key"},
        )

        # Direct magnet URI
        r1 = await client.post(
            "/api/v1/prowlarr/add",
            json={"magnet_url": "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
        )
        assert r1.status_code == 201
        assert r1.json()["success"] is True
        assert len(added_magnets) == 1

        monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

        # Redirect from Prowlarr downloadUrl to magnet URI
        r2 = await client.post(
            "/api/v1/prowlarr/add",
            json={"download_url": "http://prowlarr.local:9696/1/redirect-magnet"},
        )
        assert r2.status_code == 201
        assert r2.json()["success"] is True
        assert len(added_magnets) == 2

        # Direct .torrent bytes from external URL does NOT leak Prowlarr API key
        r3 = await client.post(
            "/api/v1/prowlarr/add",
            json={"download_url": "https://cdn.example.org/file.torrent"},
        )
        assert r3.status_code == 201
        assert r3.json()["success"] is True
        assert len(added_files) == 1
        assert added_files[0]["torrent_file_bytes"] == b"d8:announce17:http://tracker/ee"

        assert outbound_headers[0][1] == {"X-Api-Key": "secret-key"}
        assert outbound_headers[1][1] == {}

