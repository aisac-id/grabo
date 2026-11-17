# Kit promosi & merek Grabo

Semua materi di folder ini dirender dari HTML/CSS oleh `tools/build-promo.js` dan
`tools/build-video.js`, memakai **tangkapan layar asli** hasil uji runtime ekstensi
(`tools/screenshots/`). Tidak ada mockup, tidak ada aset stok, tidak ada render pihak ketiga.

Buka `index.html` untuk galeri lengkapnya.

## Isi

| Berkas | Ukuran | Untuk apa |
| --- | --- | --- |
| `box-grabo.png` | 1500×1500 | kotak perangkat lunak 3D (CSS 3D, bukan render eksternal) |
| `poster-grabo.png` | 1400×1980 | poster utama, siap cetak |
| `hero-1920x1080.png` | 1920×1080 | hero situs / README |
| `features-1600x900.png` | 1600×900 | lembar empat langkah |
| `og-1200x630.png` | 1200×630 | Open Graph / kartu tautan |
| `banner-1500x500.png` | 1500×500 | banner header |
| `social-square-1080.png` | 1080×1080 | pos persegi |
| `story-1080x1920.png` | 1080×1920 | story / reel vertikal |
| `grabo-promo.mp4` | 1920×1080 · 24 s · 30 fps | video promo **dengan suara** |
| `grabo-preview.gif` | 520 px · 6 fps · 10 s | pratinjau ringan |
| `video-poster.jpg` | 1280×720 | poster video |
| `index.html` | — | galeri kit promosi |

## Video

Enam bingkai, masing-masing 4,6 detik dengan transisi silang 0,7 detik:

1. Judul — "Satu halaman. Semua medianya."
2. Panen 5 sumber (sidebar Ringkas)
3. Galeri & pilihan (45 media dipilih)
4. Antrian yang jujur (Studio)
5. Folder & manifes
6. Penutup + repositori

Gerak kamera adalah zoom lambat dengan sedikit geser bergantian arah. Bantalan suara
disintesis lokal (akord sinus + tremolo + lowpass), bukan musik pihak ketiga.

## Membuat ulang

```bash
node tools/test-grabo.js       # menghasilkan tools/screenshots/*.png yang dipakai di sini
node tools/build-promo.js      # 8 aset citra + 6 bingkai video
node tools/build-video.js      # video, poster, dan GIF (butuh ffmpeg)
```

`build-promo.js` juga membuat `brand/logo-transparent.png` dari `brand/logo.svg`
(rect latar dibuang) supaya logo bisa duduk di atas gradien tanpa kotak gelap.

## Merek

- **Logo**: `brand/logo.svg` (vektor), `brand/logo.png` (1520×480), `brand/logo-transparent.png`
- **Logomark**: `brand/logomark.svg`, `brand/logomark-mono.png`
- **Ikon ekstensi**: `icons/icon16.png` … `icons/icon512.png`
- **Palet**: magenta `#FF2E88`, ungu `#8B5CFF`, sian `#00E5FF`, spark `#C6FF3D`,
  bahaya `#FF4D5E`, peringatan `#FFB020`, ink `#0B0611`
- **Tipografi**: Bricolage Grotesque (judul), Plus Jakarta Sans (teks), JetBrains Mono (angka/label)
- **Motif**: ban berjalan dan tiket antrian berperforasi

## Lisensi

Semua materi di folder ini dirilis di bawah lisensi MIT proyek (`../LICENSE`),
kecuali font yang tetap berlisensi SIL OFL 1.1 (`../fonts/OFL.txt`).
Tangkapan layar menampilkan fixture sintetis dari `demo/`, bukan konten milik siapa pun.