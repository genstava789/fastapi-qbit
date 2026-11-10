#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Ensure qbittorrent-nox is running
if ! pgrep -x "qbittorrent-nox" > /dev/null; then
    echo "[+] Starting qbittorrent-nox daemon..."
    qbittorrent-nox -d
    sleep 2
fi

echo "[+] Starting FastAPI qBittorrent API server..."
exec ./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

