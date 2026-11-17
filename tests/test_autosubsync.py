import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.config import settings
from bot.modules.autosubsync_engine import (
    AutoSubSyncEngine,
    SyncResult,
    auto_sub_sync_engine,
)
from bot.modules.autosubsync import (
    autosubsync_sessions,
    build_autosubsync_menu_data,
    process_autosubsync_choice,
    scan_autosubsync_items,
    autosubsync_command_handler,
    autosubsync_toggle_engine_callback,
    autosubsync_back_vid_callback,
    autosubsync_back_sub_callback,
    autosubsync_cancel_callback,
    autosubsync_restart_callback,
    autosubsync_quick_pair_callback,
)


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


class MockCallbackQuery:
    def __init__(self, data="", user_id=12345, message=None):
        self.from_user = MockUser(user_id)
        self.data = data
        self.message = message or MockMessage(user_id=user_id)
        self.matches = []
        self.answers = []

    async def answer(self, text="", show_alert=False):
        self.answers.append({"text": text, "show_alert": show_alert})

    async def edit_message_text(self, text, reply_markup=None, **kwargs):
        return await self.message.edit_text(text, reply_markup=reply_markup, **kwargs)


def test_engine_format_checks():
    engine = AutoSubSyncEngine()
    assert engine.is_video("movie.mkv") is True
    assert engine.is_video("movie.mp4") is True
    assert engine.is_video("video.avi") is True
    assert engine.is_video("stream.ts") is True
    assert engine.is_video("clip.webm") is True
    assert engine.is_video("subtitle.srt") is False
    assert engine.is_video("image.png") is False

    assert engine.is_subtitle("subs.srt") is True
    assert engine.is_subtitle("dialogue.ass") is True
    assert engine.is_subtitle("lines.ssa") is True
    assert engine.is_subtitle("web.vtt") is True
    assert engine.is_subtitle("video.mkv") is False
    assert engine.is_subtitle("doc.pdf") is False


def test_effective_basename():
    engine = AutoSubSyncEngine()
    b1 = engine.effective_basename("Inception.2010.1080p.BluRay.x264.mkv")
    b2 = engine.effective_basename("Inception.2010.id.srt")
    assert "inception 2010" in b1
    assert "inception 2010" in b2

    b3 = engine.effective_basename("[ReleaseGroup] Attack.on.Titan.S04E28.1080p.mkv")
    assert "attack on titan" in b3
    assert "s04e28" in b3


def test_calculate_similarity():
    engine = AutoSubSyncEngine()
    sim_match = engine.calculate_similarity("Inception.2010.1080p.mkv", "Inception.2010.id.srt")
    assert sim_match >= 0.70

    sim_ep = engine.calculate_similarity("Series.S01E02.mkv", "Series.S01E02.srt")
    assert sim_ep >= 0.90

    sim_diff = engine.calculate_similarity("Inception.2010.mkv", "Interstellar.2014.srt")
    assert sim_diff < 0.60


def test_find_matching_pairs():
    engine = AutoSubSyncEngine()
    files = [
        "/downloads/Inception.2010.1080p.mkv",
        "/downloads/Inception.2010.indonesian.srt",
        "/downloads/Oppenheimer.2023.mp4",
        "/downloads/Oppenheimer.2023.english.ass",
        "/downloads/notes.txt",
    ]
    pairs = engine.find_matching_pairs(files)
    assert len(pairs) == 2
    assert any("Inception" in p["video"] and "Inception" in p["subtitle"] for p in pairs)
    assert any("Oppenheimer" in p["video"] and "Oppenheimer" in p["subtitle"] for p in pairs)


def test_determine_output_path(tmp_path):
    engine = AutoSubSyncEngine()
    sub = tmp_path / "test.srt"
    sub.write_text("1\n00:00:01,000 --> 00:00:02,000\nHello\n", encoding="utf-8")

    out = engine.determine_output_path(str(sub))
    assert out.endswith("test.synced.srt")
    assert os.path.dirname(out) == str(tmp_path)

    custom = tmp_path / "custom.srt"
    out_custom = engine.determine_output_path(str(sub), custom_output=str(custom))
    assert out_custom == str(custom.resolve())


def test_scan_autosubsync_items(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))

    (base / "Subfolder").mkdir()
    (base / "Film.mkv").write_bytes(b"video" * 100)
    (base / "Film.srt").write_text("sub content", encoding="utf-8")
    (base / "Other.txt").write_text("text", encoding="utf-8")

    # Step 1: pick_video -> returns Subfolder and Film.mkv
    res1 = scan_autosubsync_items(str(base), step="pick_video")
    items1 = res1["items"]
    assert len(items1) == 2
    assert items1[0]["name"] == "Subfolder"
    assert items1[0]["is_dir"] is True
    assert items1[1]["name"] == "Film.mkv"
    assert items1[1]["is_dir"] is False

    # Check auto-pair detected
    assert len(res1["auto_pairs"]) == 1
    assert res1["auto_pairs"][0]["video_name"] == "Film.mkv"
    assert res1["auto_pairs"][0]["subtitle_name"] == "Film.srt"

    # Step 2: pick_sub -> returns Film.srt first, then Subfolder
    vid_item = {"name": "Film.mkv", "path": str(base / "Film.mkv")}
    res2 = scan_autosubsync_items(str(base), step="pick_sub", selected_video=vid_item)
    items2 = res2["items"]
    assert len(items2) == 2
    assert items2[0]["name"] == "Film.srt"
    assert items2[0]["similarity"] > 0.8


def test_build_autosubsync_menu_data(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))

    (base / "Movie.mp4").write_bytes(b"vid")
    (base / "Movie.srt").write_text("sub")

    user_id = 99901
    autosubsync_sessions.pop(user_id, None)

    # Step 1 menu
    text, markup = build_autosubsync_menu_data(user_id, current_dir=str(base), page=1)
    assert "Langkah 1/2" in text
    assert "Movie.mp4" in text
    assert markup is not None

    # Transition to Step 2
    session = autosubsync_sessions[user_id]
    session["step"] = "pick_sub"
    session["video_item"] = {
        "name": "Movie.mp4",
        "path": str(base / "Movie.mp4"),
        "is_dir": False,
        "formatted_size": "100 MB",
    }

    text2, markup2 = build_autosubsync_menu_data(user_id, current_dir=str(base), page=1)
    assert "Langkah 2/2" in text2
    assert "Movie.srt" in text2

    # Transition to Step 3 (confirm)
    session["step"] = "confirm"
    session["sub_item"] = {
        "name": "Movie.srt",
        "path": str(base / "Movie.srt"),
        "is_dir": False,
        "formatted_size": "20 KB",
    }
    text3, markup3 = build_autosubsync_menu_data(user_id, current_dir=str(base), page=1)
    assert "Konfirmasi AutoSubSync" in text3
    assert "Movie.synced.srt" in text3
    assert any("Mulai Sinkronisasi" in btn.text for row in markup3.inline_keyboard for btn in row)


@pytest.mark.anyio
async def test_process_autosubsync_choice(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))

    sub_dir = base / "SeriesFolder"
    sub_dir.mkdir()
    vid_file = base / "TestMovie.mkv"
    vid_file.write_bytes(b"x" * 100)
    sub_file = base / "TestMovie.srt"
    sub_file.write_text("sub")

    user_id = 99902
    autosubsync_sessions.pop(user_id, None)

    # Initialize wizard
    build_autosubsync_menu_data(user_id, current_dir=str(base), page=1)
    session = autosubsync_sessions[user_id]

    client = MagicMock()
    msg = MockMessage(user_id=user_id)

    # Pick #1 which is SeriesFolder -> should enter folder
    await process_autosubsync_choice(client, msg, user_id, pick_idx=1, is_callback=False)
    assert session["current_dir"] == str(sub_dir)

    # Reset back to base
    session["current_dir"] = str(base)
    session["step"] = "pick_video"
    build_autosubsync_menu_data(user_id, current_dir=str(base), page=1)

    # Pick #2 which is TestMovie.mkv -> should transition to pick_sub
    await process_autosubsync_choice(client, msg, user_id, pick_idx=2, is_callback=False)
    assert session["step"] == "pick_sub"
    assert session["video_item"]["name"] == "TestMovie.mkv"

    # Now in pick_sub, pick #1 which is TestMovie.srt -> should transition to confirm
    await process_autosubsync_choice(client, msg, user_id, pick_idx=1, is_callback=False)
    assert session["step"] == "confirm"
    assert session["sub_item"]["name"] == "TestMovie.srt"


@pytest.mark.anyio
async def test_autosubsync_sync_execution_mocked(tmp_path):
    engine = AutoSubSyncEngine()
    vid = tmp_path / "sample.mkv"
    vid.write_bytes(b"video data")
    sub = tmp_path / "sample.srt"
    sub.write_text("1\n00:00:01,000 --> 00:00:02,000\nHello\n", encoding="utf-8")
    out = tmp_path / "sample.synced.srt"

    # Mock _run_ffsubsync to simulate success
    async def mock_ffsubsync(v_path, s_path, o_path, progress_cb=None):
        out.write_text("1\n00:00:02,500 --> 00:00:03,500\nHello\n", encoding="utf-8")
        return True, 1.5, "offset: 1.5 seconds"

    with patch.object(engine, "_run_ffsubsync", side_effect=mock_ffsubsync):
        res = await engine.sync_subtitles(str(vid), str(sub), str(out), engine="ffsubsync")
        assert res.success is True
        assert res.offset_seconds == 1.5
        assert res.engine_used == "ffsubsync"
        assert res.file_size > 0
        assert os.path.isfile(str(out))


@pytest.mark.anyio
async def test_autosubsync_sync_fallback_mocked(tmp_path):
    engine = AutoSubSyncEngine()
    vid = tmp_path / "sample2.mkv"
    vid.write_bytes(b"video data")
    sub = tmp_path / "sample2.srt"
    sub.write_text("1\n00:00:01,000 --> 00:00:02,000\nHello\n", encoding="utf-8")
    out = tmp_path / "sample2.synced.srt"

    # Mock _run_ffsubsync to fail and _run_autosubsync to succeed
    async def mock_ff_fail(v_path, s_path, o_path, progress_cb=None):
        return False, None, "ffsubsync error"

    async def mock_auto_success(v_path, s_path, o_path, progress_cb=None):
        out.write_text("1\n00:00:03,000 --> 00:00:04,000\nHello\n", encoding="utf-8")
        return True, 2.0, "autosubsync offset: 2.0"

    with patch.object(engine, "_run_ffsubsync", side_effect=mock_ff_fail), \
         patch.object(engine, "_run_autosubsync", side_effect=mock_auto_success):
        res = await engine.sync_subtitles(str(vid), str(sub), str(out), engine="auto")
        assert res.success is True
        assert res.engine_used == "autosubsync"
        assert res.offset_seconds == 2.0


@pytest.mark.anyio
async def test_autosubsync_callbacks_navigation(tmp_path, monkeypatch):
    base = tmp_path / "downloads"
    base.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "DEFAULT_SAVE_PATH", str(base))

    user_id = 99903
    autosubsync_sessions[user_id] = {
        "current_dir": str(base),
        "step": "confirm",
        "page": 1,
        "video_item": {"name": "video.mkv", "path": str(base / "video.mkv"), "formatted_size": "1 GB"},
        "sub_item": {"name": "sub.srt", "path": str(base / "sub.srt"), "formatted_size": "50 KB"},
        "engine": "ffsubsync",
        "timestamp": 1234567,
        "items": [],
    }

    client = MagicMock()
    cb = MockCallbackQuery(user_id=user_id)

    # Test toggle engine
    await autosubsync_toggle_engine_callback(client, cb)
    assert autosubsync_sessions[user_id]["engine"] == "autosubsync"
    await autosubsync_toggle_engine_callback(client, cb)
    assert autosubsync_sessions[user_id]["engine"] == "ffsubsync"

    # Test back to subtitle
    await autosubsync_back_sub_callback(client, cb)
    assert autosubsync_sessions[user_id]["step"] == "pick_sub"

    # Test back to video
    await autosubsync_back_vid_callback(client, cb)
    assert autosubsync_sessions[user_id]["step"] == "pick_video"

    # Test cancel
    await autosubsync_cancel_callback(client, cb)
    assert user_id not in autosubsync_sessions


@pytest.mark.anyio
async def test_autosubsync_command_handler(monkeypatch):
    user_id = 99904
    monkeypatch.setattr("bot.modules.autosubsync.is_user_authorized", lambda uid: True)

    client = MagicMock()
    msg = MockMessage(text="/autosubsync", user_id=user_id)

    task = await autosubsync_command_handler(client, msg)
    if task:
        await task

    assert len(msg.replies) == 1
    assert "Langkah 1/2" in msg.replies[0]["text"]
    assert user_id in autosubsync_sessions


@pytest.mark.anyio
async def test_autosubsync_command_unauthorized(monkeypatch):
    user_id = 99905
    monkeypatch.setattr("bot.modules.autosubsync.is_user_authorized", lambda uid: False)

    client = MagicMock()
    msg = MockMessage(text="/autosubsync", user_id=user_id)

    task = await autosubsync_command_handler(client, msg)
    if task:
        await task

    assert len(msg.replies) == 1
    assert "Akses Ditolak" in msg.replies[0]["text"]


@pytest.mark.anyio
async def test_number_choice_message_handler_autosubsync(monkeypatch):
    from bot.command.upload import number_choice_message_handler

    user_id = 99906
    monkeypatch.setattr("bot.command.upload.is_user_authorized", lambda uid: True)

    called_with = []

    async def mock_process(client, message, uid, idx, is_callback=False):
        called_with.append((uid, idx, is_callback))

    monkeypatch.setattr("bot.modules.autosubsync.process_autosubsync_choice", mock_process)

    autosubsync_sessions[user_id] = {
        "timestamp": 9999999999,  # Very recent
        "items": [{"name": "item1"}],
    }

    client = MagicMock()
    msg = MockMessage(text="2", user_id=user_id)

    task = await number_choice_message_handler(client, msg)
    if task:
        await task

    assert len(called_with) == 1
    assert called_with[0] == (user_id, 2, False)

