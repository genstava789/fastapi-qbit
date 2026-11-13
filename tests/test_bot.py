import pytest
from bot.utils import (
    escape_html,
    format_bytes,
    format_bytes_compact,
    format_duration_id,
    format_eta,
    format_speed,
    get_torrent_badge,
    is_user_authorized,
    make_progress_bar,
    make_square_progress_bar,
)
from bot.command.status import categorize_torrents, format_status_message, render_task_card


def test_bot_format_bytes():
    assert format_bytes(0) == "0 B"
    assert format_bytes(1024) == "1.00 KB"
    assert format_bytes(1048576) == "1.00 MB"
    assert format_bytes(1073741824) == "1.00 GB"
    assert format_bytes(None) == "0 B"
    assert format_bytes(-50) == "0 B"


def test_bot_format_bytes_compact():
    assert format_bytes_compact(0) == "0B"
    assert format_bytes_compact(1024) == "1KB"
    assert format_bytes_compact(int(23.38 * 1024 * 1024)) == "23.38MB"
    assert format_bytes_compact(int(64.66 * 1024 * 1024 * 1024)) == "64.66GB"
    assert format_bytes_compact(int(1.17 * 1024 * 1024 * 1024 * 1024)) == "1.17TB"


def test_bot_format_duration_id():
    assert format_duration_id(0) == "0d"
    assert format_duration_id(33) == "33d"
    assert format_duration_id(34 * 60 + 24) == "34m24d"
    assert format_duration_id(2 * 3600 + 30 * 60 + 28) == "2j30m28d"
    assert format_duration_id(11 * 3600 + 14 * 60 + 40) == "11j14m40d"
    assert format_duration_id(8640000) == "100h"


def test_bot_make_square_progress_bar():
    p0 = make_square_progress_bar(0)
    assert p0 == "┌┤□□□□□□□□□□│ 0%"

    p87 = make_square_progress_bar(87.5)
    assert p87 == "┌┤■■■■■■■■□□│ 87.5%"

    p2 = make_square_progress_bar(2.87)
    assert p2 == "┌┤□□□□□□□□□□│ 2.87%"

    p100 = make_square_progress_bar(100)
    assert p100 == "┌┤■■■■■■■■■■│ 100%"


def test_bot_get_torrent_badge():
    emoji, label = get_torrent_badge("downloading")
    assert emoji == "📥"
    assert label == "Downloading"

    emoji, label = get_torrent_badge("uploading")
    assert emoji == "📤"
    assert label == "Seeding"

    emoji, label = get_torrent_badge("stalledUP", upload_speed=0)
    assert emoji == "✅"
    assert label == "Completed"

    emoji, label = get_torrent_badge("stalledUP", upload_speed=1024)
    assert emoji == "📤"
    assert label == "Seeding"

    emoji, label = get_torrent_badge("stalledDL")
    assert emoji == "⏳"
    assert label == "Stalled"

    emoji, label = get_torrent_badge("pausedDL")
    assert emoji == "⏸️"
    assert label == "Paused"

    emoji, label = get_torrent_badge("error")
    assert emoji == "❌"
    assert label == "Error"


def test_bot_escape_html():
    raw = "Release <2026> & [Group] >"
    escaped = escape_html(raw)
    assert "&lt;" in escaped
    assert "&gt;" in escaped
    assert "&amp;" in escaped
    assert "<" not in escaped


def test_bot_is_user_authorized(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "TELEGRAM_AUTHORIZED_USERS", None)
    monkeypatch.setattr(settings, "OWNER_ID", None)
    assert is_user_authorized(12345) is True

    monkeypatch.setattr(settings, "TELEGRAM_AUTHORIZED_USERS", "111, 222, 333")
    assert is_user_authorized(111) is True
    assert is_user_authorized(222) is True
    assert is_user_authorized(999) is False

    monkeypatch.setattr(settings, "TELEGRAM_AUTHORIZED_USERS", None)
    monkeypatch.setattr(settings, "OWNER_ID", 1487943213)
    assert is_user_authorized(1487943213) is True
    assert is_user_authorized(9999) is False


def test_bot_categorize_torrents():
    sample = [
        {"name": "t1", "state": "downloading", "progress": 40.0, "download_speed": 1000, "upload_speed": 0},
        {"name": "t2", "state": "uploading", "progress": 100.0, "download_speed": 0, "upload_speed": 5000},
        {"name": "t3", "state": "stalledDL", "progress": 10.0, "download_speed": 0, "upload_speed": 0},
        {"name": "t4", "state": "stalledUP", "progress": 100.0, "download_speed": 0, "upload_speed": 0},
        {"name": "t5", "state": "pausedDL", "progress": 5.0, "download_speed": 0, "upload_speed": 0},
    ]

    cats = categorize_torrents(sample)
    assert len(cats["downloading"]) == 1
    assert cats["downloading"][0]["name"] == "t1"

    assert len(cats["uploading"]) == 1
    assert cats["uploading"][0]["name"] == "t2"

    assert len(cats["stalled_dl"]) == 1
    assert cats["stalled_dl"][0]["name"] == "t3"

    assert len(cats["completed"]) == 1
    assert cats["completed"][0]["name"] == "t4"

    assert len(cats["paused"]) == 1
    assert cats["paused"][0]["name"] == "t5"


def test_bot_render_task_card():
    sample_item = {
        "name": "Dragon Ball & Dragon Ball Z Movies",
        "hash": "094a7f561ec0c6bafd4bee07842b610e3d475386",
        "state": "stalledDL",
        "progress": 0,
        "downloaded": 0,
        "total_size": 69427900000,
        "download_speed": 0,
        "upload_speed": 0,
        "eta": 8640000,
        "added_on": 1700000000,
    }
    card = render_task_card(sample_item, version="5.3.0", default_user="𝓩𝓾𝔂𝓜")
    assert "Dragon Ball & Dragon Ball Z Movies" in card
    assert "┌┤□□□□□□□□□□│ 0%" in card
    assert "├ ID: Kqng-" in card
    assert "├ Status: * (ノ_<。)" in card
    assert "├ Alat: qBittorrent 5.3.0" in card
    assert "├ Waktu:" in card
    assert "├ Proses: 0B / " in card
    assert "├ Kecepatan: 0B/s" in card
    assert "├ User: 𝓩𝓾𝔂𝓜" in card
    assert "└ * | *" in card


def test_bot_format_status_message_offline(monkeypatch):
    from app.services.qbit_service import qbit_service

    monkeypatch.setattr(qbit_service, "check_connection", lambda: (False, None))
    text, keyboard = format_status_message()
    assert "qBittorrent" in text
    assert "Status: * (ノ_<。)" in text
    assert keyboard is not None
    # All keyboard rows should have 1 button for full-width layout
    for row in keyboard.inline_keyboard:
        assert len(row) == 1


def test_bot_format_status_message_online(monkeypatch):
    from app.services.qbit_service import qbit_service

    monkeypatch.setattr(qbit_service, "check_connection", lambda: (True, "v5.3.0"))
    monkeypatch.setattr(
        qbit_service,
        "list_torrents",
        lambda **kwargs: [
            {
                "hash": "094a7f561ec0c6bafd4bee07842b610e3d475386",
                "name": "Ubuntu Desktop 24.04.iso",
                "state": "downloading",
                "progress": 55.5,
                "total_size": 2000000000,
                "downloaded": 1110000000,
                "uploaded": 0,
                "download_speed": 4500000,
                "upload_speed": 100000,
                "eta": 200,
                "num_seeds": 40,
                "num_complete": 40,
                "num_leechs": 10,
                "num_incomplete": 10,
                "added_on": 1700000000,
            },
            {
                "hash": "a75a30a1234567890abcdef1234567890abcdef1",
                "name": "Debian Seeding.iso",
                "state": "uploading",
                "progress": 100.0,
                "total_size": 1000000000,
                "downloaded": 1000000000,
                "uploaded": 2000000000,
                "download_speed": 0,
                "upload_speed": 850000,
                "eta": 8640000,
                "ratio": 2.0,
                "num_seeds": 15,
                "num_complete": 15,
                "num_leechs": 2,
                "num_incomplete": 2,
                "added_on": 1700000000,
            },
        ],
    )
    monkeypatch.setattr(
        qbit_service,
        "get_transfer_info",
        lambda: {
            "dl_info_speed": 4500000,
            "up_info_speed": 950000,
            "dl_info_data": 5000000000,
            "up_info_data": 3000000000,
        },
    )

    # Active view
    text, keyboard = format_status_message(filter_type="active", user_display_name="You Aren’t Gonna Need It, YaGNi")
    assert "Ubuntu Desktop 24.04.iso" in text
    assert "Debian Seeding.iso" in text
    assert "┌┤" in text
    assert "├ ID: Kqng-" in text
    assert "├ Alat: qBittorrent 5.3.0" in text
    assert "Sisa:" in text
    assert "Aktif:" in text
    assert "Masuk:" in text
    assert "Keluar:" in text
    assert "User: You Aren’t Gonna Need It, YaGNi" in text

    # Verify every row in inline keyboard has 1 button (filling full chat width)
    for row in keyboard.inline_keyboard:
        assert len(row) == 1
