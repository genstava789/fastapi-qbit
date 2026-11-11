# qBit UI — Modern qBittorrent WebGUI Frontend

Frontend modern berbasis **React + TypeScript + Vite + Tailwind CSS v4** untuk mengelola backend [FastAPI qBittorrent API](../README.md), dioptimalkan untuk berjalan di **Cloudflare Workers Static Assets** (Free Tier).

- **Live Deployment**: https://qbit-ui.storage03.workers.dev
- **Default Backend**: `https://mild-leaf.nyc.boxd.sh/api/v1`

## Fitur

- **Multi-Instance**: Kelola dan berpindah antar beberapa instance `fastapi-qbit` dari sidebar (desktop) maupun slide-over drawer (mobile).
- **Torrent Management**: Tambah magnet/file `.torrent`, pause, resume, bulk actions (seleksi massal / long-press), detail modal, filter, sorting, context menu, export `.torrent`, dan hapus beserta file.
- **Prowlarr Search**: Cari indexer Prowlarr dan tambahkan magnet langsung ke instance aktif.
- **Cross-Seed**: Identifikasi otomatis torrent dengan ukuran file identik untuk peluang cross-seeding.
- **Network Agent**: Cek IP publik, speed test download, dan pengujian latensi ke API backend serta DNS edge.
- **File Browser**: Jelajahi struktur direktori file hasil unduhan dan kelola langsung.
- **Mobile-First Controls**: Bottom Navigation Bar, touch targets >= 44px, serta tema gelap Zinc matte berakses Indigo dengan font `Plus Jakarta Sans` & `JetBrains Mono`.

## Perintah Pengembangan

```bash
cd frontend
npm install          # Pasang dependensi
npm run dev          # Jalankan server pengembangan Vite
npm run lint         # Jalankan oxlint
npm test             # Jalankan unit test (Vitest)
npm run build        # Type-check & build produksi ke dist/
npm run cf:dev       # Preview lokal dengan Cloudflare Wrangler
npm run deploy       # Build & deploy ke Cloudflare Workers
```
