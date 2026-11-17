# Berkontribusi pada Grabo

Terima kasih sudah mau ikut memperbaiki Grabo. Proyek ini sengaja tanpa langkah build: semua berkas
adalah JavaScript dan CSS murni yang langsung dimuat Chrome.

## Menyiapkan lingkungan

1. Fork dan clone repositori.
2. Buka `chrome://extensions`, aktifkan **Developer mode**, lalu **Load unpacked** ke folder repositori.
3. Jalankan server fixture (bukan server statis biasa — ia punya rute 403, flaky, dan Range):

   ```bash
   node tools/serve-demo.js
   # buka http://127.0.0.1:8731/index.html
   ```

4. Untuk membuat ulang aset fixture (butuh Python + Pillow + ffmpeg):

   ```bash
   python3 tools/make-demo.py
   ```

5. Setiap selesai mengubah berkas, klik **Reload** pada kartu ekstensi lalu muat ulang halaman uji.
   Mengubah `src/*` juga menuntut muat ulang halaman; mengubah `background.js` menuntut reload ekstensi.

## Menjalankan uji runtime

```bash
npm install puppeteer-core@23       # di folder kerja mana pun
node tools/test-grabo.js
```

Harness meluncurkan Chrome sungguhan dengan ekstensi termuat, memakai OPFS sebagai folder tujuan
(`writer.useInternal()` memakai API `FileSystemDirectoryHandle` yang identik dengan folder nyata),
lalu memeriksa dok, panen, filter, antrian, penulisan berkas, HLS/DASH, DRM, dan viewport ponsel.
Laporan mesin ada di `tools/test-report.json`, daftar pekerjaan di `tools/test-jobs.json`,
tangkapan layar di folder yang dicetak di akhir run.

Catatan pengujian yang penting: `Browser.setDownloadBehavior` lewat CDP meratakan nama berkas dan
tidak memancarkan `downloadWillBegin` untuk unduhan yang dimulai ekstensi. Karena itu bukti mode
`chrome.downloads` diambil dari `chrome.downloads.search` dan dari `job.out`, bukan dari nama di disk.

## Aturan main

- **Tanpa dependensi runtime baru.** Tidak ada bundler, framework, maupun CDN. Semua aset dibundel lokal.
- **Tanpa server, tanpa telemetry.** Jangan mengirim URL, hash, atau isi berkas ke mana pun.
  Satu-satunya permintaan jaringan keluar adalah mengambil media yang diminta pengguna dan
  AT Protocol publik Bluesky.
- **Tanpa kredensial.** Grabo menumpang sesi login yang sudah ada. Jangan menambahkan penyimpanan
  kata sandi, cookie, token, atau pemanggilan API privat situs.
- **DRM tetap dihormati.** Jangan menambahkan jalur untuk melewati `EXT-X-KEY`, `ContentProtection`,
  atau proteksi setara. Kalau ragu, tandai `protected` dan lewati.
- **Sidebar tetap ¼ layar dengan tab vertikal.** Tata letak ini identitas produk.
- **Setiap kontrol harus live.** Tidak ada tombol "simpan" untuk parameter panen atau antrian.
- **Antrian harus tetap jujur.** Jangan tandai pekerjaan `done` sebelum byte benar-benar tertulis;
  jangan hilangkan pekerjaan saat reload; jangan pernah menghitung ulang hash dari nama berkas.
- **Hormati jeda per-host.** Fitur baru tidak boleh melewati pacer.

## Gaya kode

- Dua spasi, titik koma, kutip tunggal, `const`/`let`.
- Komentar dan seluruh teks antarmuka dalam bahasa Indonesia.
- Hindari membangun ulang DOM saat parameter berubah; pakai CSS custom properties.
- Penulisan setelan harus lewat `setSettings()` di `background.js` (rantai tulis berurutan) supaya
  beberapa slider yang berubah dalam satu tick tidak saling menimpa.
- Mesin panen menerima setelan baru lewat `engine.setSettings()`; jangan menyimpan referensi
  setelan lama di modul lain.

## Sebelum mengirim pull request

- [ ] `node --check` lulus untuk setiap berkas yang diubah.
- [ ] `node tools/test-grabo.js` lulus tanpa penurunan jumlah pemeriksaan.
- [ ] Semua tab sidebar dan Studio bisa dibuka, digulir, dan kontrolnya berfungsi.
- [ ] Tidak ada error di konsol halaman, sidebar, maupun service worker.
- [ ] Tata letak diuji pada lebar 1600 px dan 390 px.
- [ ] Deskripsi PR menjelaskan masalah yang diperbaiki dan cara mengujinya.

## Melaporkan bug

Sertakan versi Chrome, URL atau cuplikan HTML yang memicu masalah, langkah reproduksi, isi tab **Log**
di Studio, dan tangkapan layar sidebar. Jangan sertakan cookie, token, atau media pribadi orang lain.

## Lisensi

Dengan berkontribusi, kamu setuju kontribusimu dirilis di bawah lisensi MIT proyek ini.