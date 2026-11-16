import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.config import settings
from app.services.gdrive_service import gdrive_service
from bot.command.upload import (
    scan_local_items,
    build_upload_menu_data,
    process_upload_choice,
    upload_sessions,
)
from bot.command.copy import (
    build_copy_menu_data,
    process_copy_choice,
    copy_sessions,
)
from bot.command.start import start_help_command_handler


class MockUser:
    def __init__(self, uid=12345):
        self.id = uid
        self.first_name = "Tester"


class MockMessage:
    def __init__(self, text="", user_id=12345):
        self.from_user = MockUser(user_id)
        self.text = text
        self.replies = []
        self.edits = []

    async def reply_text(self, text, reply_markup=None, **kwargs):
        self.replies.append({"text": text, "markup": reply_markup})
        # Return mock message that can be edited
        return self

    async def edit_text(self, text, **kwargs):
        self.edits.append(text)


def test_scan_local_items(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))

    # Create dummy files and folders
    (base / "Subfolder A").mkdir()
    (base / "Subfolder B").mkdir()
    f1 = base / "video.mkv"
    f1.write_bytes(b"x" * 1024)
    f2 = base / "notes.txt"
    f2.write_bytes(b"y" * 50)

    items = scan_local_items(str(base))
    assert len(items) == 4
    # Folders first
    assert items[0]["name"] == "Subfolder A"
    assert items[0]["is_dir"] is True
    assert items[1]["name"] == "Subfolder B"
    assert items[1]["is_dir"] is True
    # Files after
    assert items[2]["name"] == "notes.txt"
    assert items[2]["is_dir"] is False
    assert items[3]["name"] == "video.mkv"
    assert items[3]["is_dir"] is False


def test_build_upload_menu_unauthenticated(monkeypatch):
    monkeypatch.setattr(gdrive_service, "is_authenticated", lambda: False)
    text, markup = build_upload_menu_data(12345)
    assert "Google Drive Belum Terhubung" in text
    assert markup is None


def test_build_upload_menu_authenticated(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))
    monkeypatch.setattr(gdrive_service, "is_authenticated", lambda: True)
    monkeypatch.setattr(gdrive_service, "get_default_path", lambda: {"folder_id": "test_fid", "folder_name": "Test Backup"})

    # Create 3 files
    (base / "file1.mkv").write_bytes(b"123")
    (base / "file2.mkv").write_bytes(b"456")
    (base / "folder1").mkdir()

    text, markup = build_upload_menu_data(12345, current_dir=str(base))
    assert "Di-upload ke Google Drive" in text
    assert "Test Backup" in text
    assert markup is not None
    # Check that numbered buttons 1, 2, 3 exist
    button_texts = [btn.text for row in markup.inline_keyboard for btn in row]
    assert "1" in button_texts
    assert "2" in button_texts
    assert "3" in button_texts


@pytest.mark.anyio
async def test_process_upload_choice_file(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    f = base / "movie.mkv"
    f.write_bytes(b"dummy")

    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))
    monkeypatch.setattr(gdrive_service, "is_authenticated", lambda: True)

    upload_mock = MagicMock(return_value="test_upload_id")
    monkeypatch.setattr(gdrive_service, "start_resumable_upload", upload_mock)

    # Setup session
    user_id = 999
    build_upload_menu_data(user_id, current_dir=str(base))

    msg = MockMessage()
    await process_upload_choice(None, msg, user_id, 1, is_callback=False)

    assert upload_mock.called
    assert len(msg.replies) >= 1
    assert "Memulai Upload" in msg.edits[0] or "Memulai Upload" in msg.replies[0]["text"]


def test_build_copy_menu_unauthenticated(monkeypatch):
    monkeypatch.setattr(gdrive_service, "is_authenticated", lambda: False)
    text, markup = build_copy_menu_data(12345)
    assert "Google Drive Belum Terhubung" in text
    assert markup is None


def test_build_copy_menu_authenticated(monkeypatch):
    monkeypatch.setattr(gdrive_service, "is_authenticated", lambda: True)
    mock_files = [
        {"id": "f_1", "name": "Folder Movies", "mime_type": "application/vnd.google-apps.folder", "size": 0},
        {"id": "f_2", "name": "Matrix.mkv", "mime_type": "video/x-matroska", "size": 1024 * 1024 * 500},
    ]
    monkeypatch.setattr(gdrive_service, "list_files", lambda **kwargs: {"files": mock_files})

    text, markup = build_copy_menu_data(12345, folder_id="root", folder_name="My Drive")
    assert "Di-copy ke Server" in text
    assert markup is not None
    button_texts = [btn.text for row in markup.inline_keyboard for btn in row]
    assert "1" in button_texts
    assert "2" in button_texts


@pytest.mark.anyio
async def test_process_copy_choice_file(monkeypatch):
    monkeypatch.setattr(gdrive_service, "is_authenticated", lambda: True)
    mock_files = [
        {"id": "f_matrix", "name": "Matrix.mkv", "mime_type": "video/x-matroska", "size": 500000},
    ]
    monkeypatch.setattr(gdrive_service, "list_files", lambda **kwargs: {"files": mock_files})

    dl_mock = MagicMock(return_value=["test_task_id"])
    monkeypatch.setattr(gdrive_service, "start_download_to_server", dl_mock)

    user_id = 888
    build_copy_menu_data(user_id, folder_id="root")

    msg = MockMessage()
    await process_copy_choice(None, msg, user_id, 1, is_callback=False)

    assert dl_mock.called
    assert len(msg.replies) >= 1
    assert "Memulai Copy" in msg.edits[0] or "Memulai Copy" in msg.replies[0]["text"]


@pytest.mark.anyio
async def test_start_help_mentions_upload_and_copy(monkeypatch):
    monkeypatch.setattr("bot.command.start.is_user_authorized", lambda uid: True)

    msg = MockMessage()
    await start_help_command_handler(None, msg)

    assert len(msg.replies) == 1
    text = msg.replies[0]["text"]
    assert "/upload" in text
    assert "/copy" in text
    markup = msg.replies[0]["markup"]
    button_texts = [btn.text for row in markup.inline_keyboard for btn in row]
    assert any("Upload" in b for b in button_texts)
    assert any("Copy" in b for b in button_texts)
