# Pemberitahuan pihak ketiga

## Font

| Berkas | Keluarga | Lisensi |
| --- | --- | --- |
| `fonts/bricolage.woff2` | Bricolage Grotesque — (c) Mathieu Triay / Bricolage Grotesque Project Authors | SIL OFL 1.1 |
| `fonts/jakarta.woff2` | Plus Jakarta Sans — (c) Tokotype / Plus Jakarta Sans Project Authors | SIL OFL 1.1 |
| `fonts/jetbrains.woff2` | JetBrains Mono — (c) JetBrains s.r.o. / JetBrains Mono Project Authors | SIL OFL 1.1 |

Teks lengkap lisensi font ada di `fonts/OFL.txt`.

## API platform

Grabo memakai API bawaan Chrome dan web, bukan pustaka pihak ketiga:
`chrome.downloads`, `chrome.webRequest` (observasional), `chrome.storage`, `chrome.scripting`,
`chrome.contextMenus`, File System Access API (`showDirectoryPicker`), Origin Private File System,
Web Crypto (`crypto.subtle.digest('SHA-256')`), dan Web Audio.

## Protokol & format

- **AT Protocol (Bluesky)** — endpoint publik `public.api.bsky.app`, tanpa autentikasi.
  Spesifikasi protokol terbuka; Grabo hanya membaca pos dan media yang tersedia publik.
- **HLS** — pemutar/manifes mengikuti format playlist Apple HTTP Live Streaming (RFC 8216).
  Implementasi parser di `src/hls.js` ditulis untuk proyek ini.
- **MPEG-DASH** — parser MPD ditulis untuk proyek ini; hanya representation tanpa `ContentProtection`.
- Nama situs yang disebut di adapter (Instagram, TikTok, Telegram, Discord, Dreamina, dan lainnya)
  adalah merek milik pemiliknya masing-masing. Penyebutan bersifat deskriptif; proyek ini tidak
  berafiliasi dengan situs mana pun.

## Aset uji

Seluruh gambar, klip, dan manifes di `demo/assets/` dibuat secara sintetis oleh `tools/make-demo.py`
(Pillow + ffmpeg) untuk proyek ini. Tidak ada media pihak ketiga yang dibundel.

Seluruh kode lain di repositori ini ditulis untuk proyek Grabo dan dirilis di bawah lisensi MIT (`LICENSE`).