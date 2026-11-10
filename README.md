# fastapi-qbit 🚀

API RESTful modern berbasis **FastAPI** dan library **qbittorrent-api** untuk mengelola download torrent secara remote, termasuk menambahkan magnet link dan file `.torrent` secara langsung melalui cURL atau antarmuka OpenAPI Swagger.

---

## 📌 Fitur Utama

- 🧲 **Add Magnet Links**: Tambahkan magnet link torrent langsung melalui HTTP POST request (cURL, script, webhook, atau UI).
- 📁 **Upload .torrent Files**: Upload file `.torrent` langsung melalui endpoint `multipart/form-data`.
- 💾 **Export .torrent Files**: Unduh kembali file `.torrent` yang sedang aktif di-seed atau di-download.
- 📋 **List & Filter Torrents**: Lihat daftar semua torrent aktif, status progress, kecepatan download/upload, dan ETA.
- 🔍 **Detail & Monitoring**: Dapatkan metrik real-time setiap torrent berdasarkan torrent hash.
- ⏯️ **Pause & Resume**: Kendalikan download torrent secara instan.
- 🗑️ **Delete Torrent**: Hapus torrent dengan opsi menghapus file data atau metadata saja.
- 🌐 **WebTorrent Reverse Proxy**: Akses antarmuka Web UI bawaan qBittorrent langsung melalui route `/webtorrent/`.
- 🩺 **Health Check**: Endpoint pemantauan konektivitas dengan daemon qBittorrent.
- 📖 **Interactive Swagger UI**: Dokumentasi interaktif otomatis di `/docs` dan ReDoc di `/redoc`.
- 🧪 **Automated Testing**: Suite pengujian unit dan integrasi otomatis berbasis `pytest` dan `httpx`.
- 🐳 **Docker & Docker Compose**: Dukungan kontainerisasi penuh siap pakai.

---

## 🏗️ Struktur Proyek

```text
fastapi-qbit/
├── .github/
│   └── workflows/
│       └── ci.yml            # GitHub Actions CI workflow
├── .env.example              # Template konfigurasi environment
├── .env                      # File environment aktif lokal (diabaikan Git)
├── .gitignore                # Aturan file yang diabaikan Git
├── Dockerfile                # Image container Python 3.12 slim
├── docker-compose.yml        # Orkestrasi qBittorrent + FastAPI
├── README.md                 # Dokumentasi proyek
├── requirements.txt          # Dependensi Python
├── run.sh                    # Script eksekusi aplikasi & daemon
├── tests/
│   ├── __init__.py
│   └── test_api.py           # Unit & integration test suite
└── app/
    ├── __init__.py
    ├── main.py               # Entry point FastAPI, CORS, Lifespan, & Dashboard
    ├── core/
    │   ├── __init__.py
    │   └── config.py         # Konfigurasi via Pydantic BaseSettings
    ├── schemas/
    │   ├── __init__.py
    │   └── torrent.py        # Pydantic models & request validation
    ├── services/
    │   ├── __init__.py
    │   └── qbit_service.py   # Wrapper komunikasi qbittorrent-api
    └── api/
        ├── __init__.py
        ├── webtorrent_proxy.py # Reverse proxy untuk qBittorrent Web UI
        └── v1/
            ├── __init__.py
            ├── api.py        # Router v1
            └── endpoints/
                ├── __init__.py
                ├── health.py # Endpoint health status
                └── torrents.py # Endpoint torrent & magnet operations
```

---

## ⚙️ Persyaratan Sistem

1. **Python 3.10+**
2. **qBittorrent / qbittorrent-nox** (WebUI aktif pada port `8080`)

---

## 🚀 Instalasi & Menjalankan

### Opsi 1: Menjalankan Langsung di Host

1. Buat virtual environment & install dependensi:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. Buat konfigurasi `.env`:
   ```bash
   cp .env.example .env
   ```

3. Jalankan server:
   ```bash
   ./run.sh
   ```

### Opsi 2: Menggunakan Docker Compose
```bash
docker compose up -d
```

---

## 🧪 Menjalankan Automated Tests

Jalankan test suite menggunakan pytest:
```bash
pytest -v
```

---

## 🌐 Dokumentasi & Akses Web UI

- **Swagger UI (Interactive API Docs)**: `http://localhost:8000/docs`
- **ReDoc Documentation**: `http://localhost:8000/redoc`
- **qBittorrent Web UI**: `http://localhost:8000/webtorrent/`

---

## 📡 Panduan Penggunaan cURL

### 1. Menambahkan Magnet Link
```bash
curl -X POST "http://localhost:8000/api/v1/torrents/add-magnet" \
     -H "Content-Type: application/json" \
     -d '{
       "magnet_url": "magnet:?xt=urn:btih:e705a269bacda613c60b3a60bad67b1a1bd9eef2&dn=ubuntu.iso",
       "is_paused": false
     }'
```

### 2. Mengunggah File `.torrent`
```bash
curl -X POST "http://localhost:8000/api/v1/torrents/add-file" \
     -F "file=@/path/to/ubuntu.torrent" \
     -F "is_paused=false"
```

### 3. Mengunduh Kembali File `.torrent`
```bash
curl -O "http://localhost:8000/api/v1/torrents/<TORRENT_HASH>/export"
```

### 4. Melihat Daftar Torrent
```bash
curl -s "http://localhost:8000/api/v1/torrents"
```

### 5. Pause & Resume Torrent
```bash
curl -X POST "http://localhost:8000/api/v1/torrents/<TORRENT_HASH>/pause"
curl -X POST "http://localhost:8000/api/v1/torrents/<TORRENT_HASH>/resume"
```

### 6. Menghapus Torrent
```bash
curl -X DELETE "http://localhost:8000/api/v1/torrents/<TORRENT_HASH>?delete_files=true"
```
