# Fixture demo Grabo

Halaman uji lokal yang sengaja berisi kasus sulit. Semua aset dibuat sintetis oleh
`tools/make-demo.py` (Pillow + ffmpeg) — tidak ada media pihak ketiga di repositori ini.

## Menjalankan

```bash
node tools/serve-demo.js
# http://127.0.0.1:8731/index.html
```

Server ini bukan server statis biasa. Ia punya:

| Rute | Perilaku |
| --- | --- |
| `Range:` | membalas `206` + `Content-Range`, dan `416` untuk rentang tak sah |
| `assets/expired-token.jpg` | selalu `403` — uji gagal cepat tanpa retry |
| `assets/flaky-01.jpg` | `503` pada 2 permintaan pertama, lalu `200` — uji coba ulang |
| `/__stats` | penghitung permintaan, kegagalan, dan log permintaan (untuk harness) |
| `/__reset` | mengosongkan penghitung |

## Halaman

- **`index.html`** — 11 bagian: gambar besar, potret, thumbnail & ikon kecil (harus disaring),
  `srcset` beresolusi ganda, atribut lazy, latar CSS saja, kanvas, video `blob:`, playlist
  HLS TS / HLS fMP4 / DASH / HLS terenkripsi / DASH terproteksi, duplikat isi dengan URL berbeda,
  URL 403 & flaky, tombol "muat lebih", dan tiga gambar yang baru dibuat skrip saat wadahnya
  terlihat (`IntersectionObserver`) — tidak ada jejaknya di DOM sebelum digulir.
- **`profil.html`** — pola kisi profil (gaya galeri akun) untuk uji panen berantai.
- **`galeri.html`** — pola galeri dengan tombol muat lebih.

Playlist dimuat otomatis saat halaman dibuka, seperti pemutar sungguhan, sehingga sumber
jaringan benar-benar punya bukti untuk dipanen.

## Membuat ulang aset

```bash
python3 tools/make-demo.py     # butuh Pillow; ffmpeg diambil dari PATH atau $FFMPEG
```

Hasil: 38 gambar raster + 1 SVG, klip mp4, HLS TS (master + varian + 4 segmen),
HLS varian rendah (5), HLS fMP4 (7), DASH (12), plus varian terenkripsi untuk menguji penandaan `protected`.