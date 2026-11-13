import pytest
from bot.utils import (
    escape_html,
    format_bytes,
    format_eta,
    format_speed,
    get_torrent_badge,
    is_user_authorized,
    make_progress_bar,
)
from bot.command.status import categorize_torrents, format_status_message


def test_bot_format_bytes():
    assert format_bytes(0) == "0 B"
    assert format_bytes(1024) == "1.00 KB"
    assert format_bytes(1048576) == "1.00 MB"
    assert format_bytes(1073741824) == "1.00 GB"
    assert format_bytes(None) == "0 B"
    assert format_bytes(-50) == "0 B"


def test_bot_format_speed():
    assert format_speed(0) == "0 B/s"
    assert format_speed(2097152) == "2.00 MB/s"


def test_bot_format_eta():
    assert format_eta(0) == "∞"
    assert format_eta(-1) == "∞"
    assert format_eta(8640000) == "∞"
    assert format_eta(45) == "45s"
    assert format_eta(125) == "2m 5s"
    assert format_eta(3665) == "1h 1m"


def test_bot_make_progress_bar():
    bar_0 = make_progress_bar(0, 10)
    assert bar_0 == "[░░░░░░░░░░] 0.0%"

    bar_50 = make_progress_bar(50, 10)
    assert bar_50 == "[█████░░░░░] 50.0%"

    bar_100 = make_progress_bar(100, 10)
    assert bar_100 == "[██████████] 100.0%"

    bar_clamp = make_progress_bar(150, 10)
    assert bar_clamp == "[██████████] 100.0%"


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

    # When no authorized users configured: everyone allowed
    monkeypatch.setattr(settings, "TELEGRAM_AUTHORIZED_USERS", None)
    assert is_user_authorized(12345) is True

    # When authorized users are configured
    monkeypatch.setattr(settings, "TELEGRAM_AUTHORIZED_USERS", "111, 222, 333")
    assert is_user_authorized(111) is True
    assert is_user_authorized(222) is True
    assert is_user_authorized(999) is False


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


def test_bot_format_status_message_offline(monkeypatch):
    from app.services.qbit_service import qbit_service

    monkeypatch.setattr(qbit_service, "check_connection", lambda: (False, None))
    text, keyboard = format_status_message()
    assert "Offline" in text
    assert "qBittorrent" in text
    assert keyboard is not None


def test_bot_format_status_message_online(monkeypatch):
    from app.services.qbit_service import qbit_service

    monkeypatch.setattr(qbit_service, "check_connection", lambda: (True, "v5.3.0"))
    monkeypatch.setattr(
        qbit_service,
        "list_torrents",
        lambda **kwargs: [
            {
                "hash": "h1",
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
            },
            {
                "hash": "h2",
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
    text, keyboard = format_status_message(filter_type="active")
    assert "Ubuntu Desktop 24.04.iso" in text
    assert "Debian Seeding.iso" in text
    assert "4.29 MB/s" in text or "MB/s" in text
    assert "Online" in text
    assert "v5.3.0" in text

    # DL filter view
    dl_text, _ = format_status_message(filter_type="dl")
    assert "Daftar Unduhan" in dl_text
    assert "Ubuntu Desktop 24.04.iso" in dl_text

    # UP filter view
    up_text, _ = format_status_message(filter_type="up")
    assert "Daftar Seeding" in up_text
    assert "Debian Seeding.iso" in up_text

    # All filter view
    all_text, _ = format_status_message(filter_type="all")
    assert "Semua Torrent" in all_text
