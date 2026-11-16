import os
import tempfile
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.schemas.rclone import RcloneConfigResponse, RcloneUrlRequest
from app.services.rclone_service import (
    normalize_rclone_url,
    parse_rclone_remotes,
    validate_rclone_content,
    RcloneService,
)
from bot.utils import get_rclone_config_path, cmd_exec
from bot.command.shell import run_shell


SAMPLE_RCLONE_CONF = """
[gdrive]
type = drive
client_id = fake-client-id
client_secret = fake-client-secret
scope = drive
token = {"access_token":"ya29.fake","token_type":"Bearer","refresh_token":"1//fake","expiry":"2026-11-16T12:00:00Z"}

[onedrive]
type = onedrive
token = {"access_token":"fake"}
drive_id = fake-drive-id
drive_type = personal
"""


def test_normalize_rclone_url():
    # GitHub blob to raw
    gh_blob = "https://github.com/alice/dotfiles/blob/main/rclone/rclone.conf"
    assert normalize_rclone_url(gh_blob) == "https://raw.githubusercontent.com/alice/dotfiles/main/rclone/rclone.conf"

    # GitHub Gist normal to raw
    gist_url = "https://gist.github.com/bob/1234567890abcdef"
    assert normalize_rclone_url(gist_url) == "https://gist.githubusercontent.com/bob/1234567890abcdef/raw"

    # Already raw url
    raw_url = "https://raw.githubusercontent.com/alice/dotfiles/main/rclone.conf"
    assert normalize_rclone_url(raw_url) == raw_url


def test_parse_rclone_remotes():
    remotes, details = parse_rclone_remotes(SAMPLE_RCLONE_CONF)
    assert remotes == ["gdrive", "onedrive"]
    assert len(details) == 2
    assert details[0].name == "gdrive"
    assert details[0].type == "drive"
    assert details[1].name == "onedrive"
    assert details[1].type == "onedrive"


def test_validate_rclone_content():
    # Valid content
    validate_rclone_content(SAMPLE_RCLONE_CONF)

    # Empty content raises
    with pytest.raises(ValueError, match="kosong"):
        validate_rclone_content("   \n  ")

    # HTML page raises
    with pytest.raises(ValueError, match="HTML"):
        validate_rclone_content("<!DOCTYPE html><html><body>Error 404</body></html>")

    # Random text without sections raises
    with pytest.raises(ValueError, match="Format file tidak valid"):
        validate_rclone_content("Hello this is just some random text with no keys or sections")


def test_rclone_service_save_and_status(tmp_path, monkeypatch):
    test_conf_path = str(tmp_path / "test_rclone.conf")
    service = RcloneService()
    monkeypatch.setattr(service, "get_config_path", lambda: test_conf_path)

    # Initially not configured
    status = service.get_config_status()
    assert status.configured is False
    assert status.remotes == []

    # Save content
    status = service.save_from_file_content(SAMPLE_RCLONE_CONF)
    assert status.configured is True
    assert status.remotes == ["gdrive", "onedrive"]
    assert status.file_size > 0
    assert os.path.exists(test_conf_path)

    # Re-fetch status
    status2 = service.get_config_status()
    assert status2.configured is True
    assert status2.remotes == ["gdrive", "onedrive"]

    # Delete config
    del_status = service.delete_config()
    assert del_status.configured is False
    assert not os.path.exists(test_conf_path) or os.path.getsize(test_conf_path) == 0


@pytest.mark.anyio
async def test_rclone_service_save_from_url(tmp_path, monkeypatch):
    test_conf_path = str(tmp_path / "test_rclone.conf")
    service = RcloneService()
    monkeypatch.setattr(service, "get_config_path", lambda: test_conf_path)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = SAMPLE_RCLONE_CONF

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=mock_resp)):
        res = await service.save_from_url("https://gist.github.com/bob/1234567890abcdef")
        assert res.configured is True
        assert res.remotes == ["gdrive", "onedrive"]
        assert os.path.exists(test_conf_path)


def test_get_rclone_config_path(tmp_path, monkeypatch):
    conf_file = tmp_path / "rclone.conf"
    conf_file.write_text(SAMPLE_RCLONE_CONF, encoding="utf-8")

    monkeypatch.setenv("RCLONE_CONFIG", str(conf_file))
    found = get_rclone_config_path()
    assert found == str(conf_file)


@pytest.mark.anyio
async def test_bot_run_shell_rclone_injection(monkeypatch, tmp_path):
    conf_file = tmp_path / "rclone.conf"
    conf_file.write_text(SAMPLE_RCLONE_CONF, encoding="utf-8")

    monkeypatch.setattr("bot.command.shell.get_rclone_config_path", lambda: str(conf_file))
    monkeypatch.setattr("bot.command.shell.is_user_authorized", lambda uid: True)

    executed_commands = []

    async def mock_cmd_exec(cmd, shell=True, env=None):
        executed_commands.append(cmd)
        return "fake output", "", 0

    monkeypatch.setattr("bot.command.shell.cmd_exec", mock_cmd_exec)

    class MockUser:
        id = 123456

    class MockMessage:
        from_user = MockUser()
        text = "/shell rclone listremotes"
        caption = None
        async def reply_text(self, *args, **kwargs):
            pass

    msg = MockMessage()
    await run_shell(None, msg)

    assert len(executed_commands) == 1
    assert f'rclone --config "{conf_file}" listremotes' == executed_commands[0]


@pytest.mark.anyio
async def test_rclone_api_endpoints(monkeypatch, tmp_path):
    from httpx import ASGITransport, AsyncClient
    from app.main import app
    from app.services.rclone_service import rclone_service

    test_conf_path = str(tmp_path / "api_rclone.conf")
    monkeypatch.setattr(rclone_service, "get_config_path", lambda: test_conf_path)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. GET /config initially
        res = await client.get("/api/v1/rclone/config")
        assert res.status_code == 200
        data = res.json()
        assert data["configured"] is False

        # 2. POST /config/upload
        files = {"file": ("rclone.conf", SAMPLE_RCLONE_CONF.encode("utf-8"), "text/plain")}
        res = await client.post("/api/v1/rclone/config/upload", files=files)
        assert res.status_code == 200
        data = res.json()
        assert data["configured"] is True
        assert data["remotes"] == ["gdrive", "onedrive"]

        # 3. GET /config after upload
        res = await client.get("/api/v1/rclone/config")
        assert res.status_code == 200
        data = res.json()
        assert data["configured"] is True
        assert "gdrive" in data["remotes"]

        # 4. DELETE /config
        res = await client.delete("/api/v1/rclone/config")
        assert res.status_code == 200
        data = res.json()
        assert data["configured"] is False
