import os
import shutil
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.config import settings
from bot.command.delete import (
    calculate_dir_size,
    is_safe_path,
    scan_local_items,
    build_delete_menu_data,
    process_delete_choice,
    delete_sessions,
    delete_exec_callback,
    delete_confirm_folder_callback,
    delete_command_handler,
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
        return self

    async def edit_text(self, text, reply_markup=None, **kwargs):
        self.edits.append({"text": text, "markup": reply_markup})
        return self

    async def edit_message_text(self, text, reply_markup=None, **kwargs):
        self.edits.append({"text": text, "markup": reply_markup})
        return self


class MockCallbackQuery:
    def __init__(self, data="", user_id=12345, matches=None):
        self.from_user = MockUser(user_id)
        self.data = data
        self.matches = matches or []
        self.message = MockMessage(user_id=user_id)
        self.answers = []

    async def answer(self, text="", show_alert=False):
        self.answers.append({"text": text, "show_alert": show_alert})

    async def edit_message_text(self, text, reply_markup=None, **kwargs):
        await self.message.edit_text(text, reply_markup=reply_markup, **kwargs)


def test_scan_local_items_and_query(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))

    (base / "Series Folder").mkdir()
    (base / "Anime Folder").mkdir()
    f1 = base / "ubuntu-desktop.iso"
    f1.write_bytes(b"x" * 2048)
    f2 = base / "dragonball.mkv"
    f2.write_bytes(b"y" * 1024)

    # Scan all
    items = scan_local_items(str(base))
    assert len(items) == 4
    # Folders first
    assert items[0]["name"] == "Anime Folder"
    assert items[0]["is_dir"] is True
    assert items[1]["name"] == "Series Folder"
    assert items[1]["is_dir"] is True
    # Files after
    assert items[2]["name"] == "dragonball.mkv"
    assert items[3]["name"] == "ubuntu-desktop.iso"

    # Scan with query filter
    filtered = scan_local_items(str(base), query="dragon")
    assert len(filtered) == 1
    assert filtered[0]["name"] == "dragonball.mkv"


def test_is_safe_path(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))

    safe_file = base / "movie.mkv"
    safe_file.write_bytes(b"123")
    safe_dir = base / "subfolder"
    safe_dir.mkdir()

    # Files and subdirectories inside base are safe
    assert is_safe_path(str(safe_file)) is True
    assert is_safe_path(str(safe_dir)) is True

    # Base root itself cannot be deleted
    assert is_safe_path(str(base)) is False

    # External path cannot be deleted
    outside_file = tmp_path / "system.conf"
    outside_file.write_bytes(b"root")
    assert is_safe_path(str(outside_file)) is False


def test_calculate_dir_size(tmp_path):
    d = tmp_path / "test_folder"
    d.mkdir()
    (d / "f1.txt").write_bytes(b"a" * 100)
    sub = d / "sub"
    sub.mkdir()
    (sub / "f2.txt").write_bytes(b"b" * 250)

    total = calculate_dir_size(str(d))
    assert total == 350


def test_build_delete_menu_data(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))

    (base / "file1.txt").write_bytes(b"1")
    (base / "file2.txt").write_bytes(b"2")
    (base / "my_folder").mkdir()

    text, markup = build_delete_menu_data(12345, current_dir=str(base))
    assert "Hapus File atau Folder" in text
    assert markup is not None
    # Check buttons 1, 2, 3 exist
    button_texts = [btn.text for row in markup.inline_keyboard for btn in row]
    assert "1" in button_texts
    assert "2" in button_texts
    assert "3" in button_texts
    assert "🔄 Refresh" in button_texts
    assert "❌ Batal" in button_texts


@pytest.mark.anyio
async def test_process_delete_choice_file(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))

    f1 = base / "target_sample.mkv"
    f1.write_bytes(b"dummy")

    # Set up session
    delete_sessions[12345] = {
        "current_dir": str(base),
        "items": [{
            "name": "target_sample.mkv",
            "path": str(f1),
            "is_dir": False,
            "size": 5,
            "formatted_size": "5 B",
        }],
        "page": 1,
        "total_pages": 1,
    }

    mock_msg = MockMessage(user_id=12345)
    await process_delete_choice(None, mock_msg, 12345, pick_idx=1, is_callback=False)

    assert len(mock_msg.replies) == 1
    reply = mock_msg.replies[0]
    assert "Konfirmasi Hapus File Lokal" in reply["text"]
    assert "target_sample.mkv" in reply["text"]
    buttons = [btn.text for row in reply["markup"].inline_keyboard for btn in row]
    assert "🗑️ Ya, Hapus File Sekarang" in buttons
    assert "❌ Batal" in buttons


@pytest.mark.anyio
async def test_process_delete_choice_folder(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))

    folder = base / "test_folder"
    folder.mkdir()

    delete_sessions[12345] = {
        "current_dir": str(base),
        "items": [{
            "name": "test_folder",
            "path": str(folder),
            "is_dir": True,
            "size": 0,
            "formatted_size": "Folder",
        }],
        "page": 1,
        "total_pages": 1,
    }

    mock_msg = MockMessage(user_id=12345)
    await process_delete_choice(None, mock_msg, 12345, pick_idx=1, is_callback=False)

    assert len(mock_msg.replies) == 1
    reply = mock_msg.replies[0]
    assert "Folder Dipilih:" in reply["text"]
    buttons = [btn.text for row in reply["markup"].inline_keyboard for btn in row]
    assert "🗑️ Hapus Seluruh Folder Ini" in buttons
    assert "📂 Buka & Jelajahi Folder" in buttons


@pytest.mark.anyio
async def test_delete_exec_callback_file(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))
    monkeypatch.setattr("bot.command.delete.is_user_authorized", lambda uid: True)

    test_file = base / "delete_me.txt"
    test_file.write_bytes(b"important data to delete")
    assert test_file.exists()

    delete_sessions[12345] = {
        "current_dir": str(base),
        "items": [{
            "name": "delete_me.txt",
            "path": str(test_file),
            "is_dir": False,
            "size": 24,
        }],
        "page": 1,
        "total_pages": 1,
    }

    match_mock = MagicMock()
    match_mock.group.return_value = "0"
    cb = MockCallbackQuery(data="del_exec:0", user_id=12345, matches=[match_mock])

    await delete_exec_callback(None, cb)

    # File should be removed from disk
    assert not test_file.exists()
    assert len(cb.message.edits) == 1
    edit = cb.message.edits[0]
    assert "Berhasil Dihapus dari Server" in edit["text"]
    assert "delete_me.txt" in edit["text"]


@pytest.mark.anyio
async def test_delete_exec_callback_folder(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))
    monkeypatch.setattr("bot.command.delete.is_user_authorized", lambda uid: True)

    del_dir = base / "delete_folder"
    del_dir.mkdir()
    (del_dir / "inside.txt").write_bytes(b"inside")
    assert del_dir.exists()

    delete_sessions[12345] = {
        "current_dir": str(base),
        "items": [{
            "name": "delete_folder",
            "path": str(del_dir),
            "is_dir": True,
            "size": 0,
        }],
        "page": 1,
        "total_pages": 1,
    }

    match_mock = MagicMock()
    match_mock.group.return_value = "0"
    cb = MockCallbackQuery(data="del_exec:0", user_id=12345, matches=[match_mock])

    await delete_exec_callback(None, cb)

    # Folder should be removed from disk
    assert not del_dir.exists()
    assert len(cb.message.edits) == 1
    edit = cb.message.edits[0]
    assert "Berhasil Dihapus dari Server" in edit["text"]
    assert "delete_folder" in edit["text"]


@pytest.mark.anyio
async def test_delete_exec_path_traversal_blocked(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))
    monkeypatch.setattr("bot.command.delete.is_user_authorized", lambda uid: True)

    sensitive_file = tmp_path / "secret.env"
    sensitive_file.write_bytes(b"password")

    delete_sessions[12345] = {
        "current_dir": str(base),
        "items": [{
            "name": "secret.env",
            "path": str(sensitive_file),
            "is_dir": False,
            "size": 8,
        }],
        "page": 1,
        "total_pages": 1,
    }

    match_mock = MagicMock()
    match_mock.group.return_value = "0"
    cb = MockCallbackQuery(data="del_exec:0", user_id=12345, matches=[match_mock])

    await delete_exec_callback(None, cb)

    # Sensitive file must NOT be deleted
    assert sensitive_file.exists()
    assert any("terlarang" in a["text"] for a in cb.answers)


@pytest.mark.anyio
async def test_start_help_has_delete():
    monkeypatch_auth = patch("bot.command.start.is_user_authorized", return_value=True)
    with monkeypatch_auth:
        msg = MockMessage(user_id=12345)
        await start_help_command_handler(None, msg)

        assert len(msg.replies) == 1
        reply = msg.replies[0]
        assert "/delete" in reply["text"]
        button_texts = [btn.text for row in reply["markup"].inline_keyboard for btn in row]
        assert "🗑️ Hapus File Server" in button_texts
