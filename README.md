# fastapi-qbit 🚀

API RESTful modern berbasis **FastAPI** dan library **qbittorrent-api** untuk mengelola download torrent secara remote, termasuk menambahkan magnet link secara langsung menggunakan `curl` atau antarmuka OpenAPI Swagger.

---

## 📌 Fitur Utama

- 🧲 **Add Magnet Links**: Tambahkan magnet link torrent langsung melalui HTTP POST request (cURL, script, webhook, atau UI).
- 📋 **List & Filter Torrents**: Lihat daftar semua torrent aktif, status progress, kecepatan download/upload, dan ETA.
- 🔍 **Detail & Monitoring**: Dapatkan metrik real-time setiap torrent berdasarkan torrent hash.
- ⏯️ **Pause & Resume**: Kendalikan download torrent secara instan.
- 🗑️ **Delete Torrent**: Hapus torrent dengan opsi menghapus file data atau metadata saja.
- 🩺 **Health Check**: Endpoint pemantauan konektivitas dengan daemon qBittorrent.
- 📖 **Interactive Swagger UI**: Dokumentasi interaktif otomatis di `/docs` dan ReDoc di `/redoc`.

---

## 🏗️ Struktur Proyek

```text
fastapi-qbit/
├── .env.example              # Template konfigurasi environment
├── .env                      # File environment aktif (diabaikan oleh git)
├── .gitignore                # Aturan file yang diabaikan Git
├── README.md                 # Dokumentasi proyek
├── requirements.txt          # Dependensi Python
├── run.sh                    # Script praktis menjalankan aplikasi & daemon
├── venv/                     # Python Virtual Environment
└── app/
    ├── __init__.py
    ├── main.py               # Entry point aplikasi FastAPI & lifespan
    ├── core/
    │   ├── __init__.py
    │   └── config.py         # Konfigurasi via Pydantic Settings
    ├── schemas/
    │   ├── __init__.py
    │   └── torrent.py        # Pydantic models & validasi data
    ├── services/
    │   ├── __init__.py
    │   └── qbit_service.py   # Wrapper komunikasi dengan qbittorrent-api
    └── api/
        ├── __init__.py
        └── v1/
            ├── __init__.py
            ├── api.py        # Pengelompokan router v1
            └── endpoints/
                ├── __init__.py
                ├── health.py # Endpoint pengecekan status server & qbittorrent
                └── torrents.py # Endpoint manajemen torrent & magnet
```

---

## ⚙️ Persyaratan Sistem

1. **Python 3.10+**
2. **qBittorrent / qbittorrent-nox** (WebUI aktif pada port `8080`)

---

## 🚀 Instalasi & Menjalankan

### 1. Clone atau Buka Folder Proyek
```bash
cd fastapi-qbit
```

### 2. Buat & Aktifkan Virtual Environment
```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Dependensi
```bash
pip install -r requirements.txt
```

### 4. Konfigurasi Environment (`.env`)
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```

Sesuaikan parameter di `.env`:
```ini
# Server Settings
PROJECT_NAME="FastAPI qBittorrent API"
SERVER_HOST="0.0.0.0"
SERVER_PORT=8000
API_V1_STR="/api/v1"

# qBittorrent WebUI Settings
QBIT_HOST="127.0.0.1"
QBIT_PORT=8080
QBIT_USERNAME="admin"
QBIT_PASSWORD=""
QBIT_VERIFY_WEBUI_CERTIFICATE=false

# Default Download Directory
DEFAULT_SAVE_PATH="/home/boxd/Downloads/"
```

### 5. Jalankan Aplikasi
Gunakan script otomatis `run.sh` yang otomatis memeriksa daemon `qbittorrent-nox`:
```bash
./run.sh
```

Atau jalankan secara manual:
```bash
./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 🌐 Dokumentasi API

Buka alamat berikut di browser:
- **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## 📡 Panduan Penggunaan cURL

### 1. Menambahkan Magnet Link
```bash
curl -X POST "http://localhost:8000/api/v1/torrents/add-magnet" \
     -H "Content-Type: application/json" \
     -d '{
       "magnet_url": "magnet:?xt=urn:btih:3b245504cf5f11bbdbe1201cea6a6bf45a004e6d&dn=ubuntu.iso",
       "is_paused": false
     }'
```

**Response:**
```json
{
  "success": true,
  "message": "Magnet link successfully queued for download.",
  "data": {
    "result": "Ok.",
    "category": null
  }
}
```

### 2. Melihat Daftar Semua Torrent
```bash
curl -X GET "http://localhost:8000/api/v1/torrents"
```

### 3. Filter Torrent Berdasarkan Status
```bash
curl -X GET "http://localhost:8000/api/v1/torrents?status_filter=downloading"
```

### 4. Melihat Detail Satu Torrent
```bash
curl -X GET "http://localhost:8000/api/v1/torrents/<TORRENT_HASH>"
```

### 5. Jeda / Pause Torrent
```bash
curl -X POST "http://localhost:8000/api/v1/torrents/<TORRENT_HASH>/pause"
```

### 6. Lanjutkan / Resume Torrent
```bash
curl -X POST "http://localhost:8000/api/v1/torrents/<TORRENT_HASH>/resume"
```

### 7. Hapus Torrent
```bash
# Hanya menghapus torrent dari daftar (data file tetap ada di disk)
curl -X DELETE "http://localhost:8000/api/v1/torrents/<TORRENT_HASH>"

# Menghapus torrent sekaligus menghapus file yang terunduh
curl -X DELETE "http://localhost:8000/api/v1/torrents/<TORRENT_HASH>?delete_files=true"
```

### 8. Pengecekan Health Server & Koneksi qBittorrent
```bash
curl -X GET "http://localhost:8000/api/v1/health"
```

---

## 📤 Push ke GitHub

Untuk menyimpan dan membagikan repository ini ke GitHub:

1. Buat repository baru di [GitHub](https://github.com/new) (misal: `fastapi-qbit`).
2. Jalankan perintah berikut di terminal server:
   ```bash
   cd /home/boxd/fastapi-qbit
   git init
   git add .
   git commit -m "feat: initial commit of fastapi-qbit with qbittorrent-api integration"
   git branch -M main
   git remote add origin https://github.com/<USERNAME>/fastapi-qbit.git
   git push -u origin main
   ```

