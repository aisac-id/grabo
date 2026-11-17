#!/usr/bin/env python3
"""Grabo — pembuat fixture demo lokal.
Semua media dibuat sendiri (bukan unduhan), jadi repo tetap bersih dan uji bisa diulang."""
import os, shutil, subprocess, math, random
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ROOT = os.path.join(REPO, 'demo')
A = os.path.join(ROOT, 'assets')
FF = os.environ.get('FFMPEG') or shutil.which('ffmpeg') or '/usr/local/lib/python3.12/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
FONT = os.path.join(REPO, 'fonts')

os.makedirs(A, exist_ok=True)
for sub in ['hls', 'hls-fmp4', 'secure', 'dash', 'dash-secure', 'lazy', 'alias', 'fold']:
    os.makedirs(os.path.join(A, sub), exist_ok=True)

PAL = [(255, 46, 136), (139, 92, 255), (0, 229, 255), (198, 255, 61), (255, 176, 32), (77, 163, 255)]


def grad(w, h, c1, c2, label, sub=''):
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=(
            int(c1[0] + (c2[0] - c1[0]) * t),
            int(c1[1] + (c2[1] - c1[1]) * t),
            int(c1[2] + (c2[2] - c1[2]) * t)))
    for i in range(0, w, 46):
        d.line([(i, 0), (i - h // 2, h)], fill=(255, 255, 255, 12), width=1)
    d.rectangle([0, 0, w - 1, h - 1], outline=(11, 6, 17), width=3)
    size = max(18, min(w, h) // 9)
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size)
        f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', max(11, size // 3))
    except Exception:
        f = f2 = ImageFont.load_default()
    d.text((18, 18), label, font=f, fill=(11, 6, 17))
    if sub:
        d.text((18, 24 + size), sub, font=f2, fill=(11, 6, 17))
    d.text((18, h - 18 - max(11, size // 3)), 'Grabo fixture · %dx%d' % (w, h), font=f2, fill=(11, 6, 17))
    return im


made = []
for i in range(1, 13):
    c1 = PAL[i % len(PAL)]
    c2 = PAL[(i + 3) % len(PAL)]
    p = os.path.join(A, 'big-%02d.jpg' % i)
    grad(1600, 1000, c1, c2, 'KARYA %02d' % i, 'versi penuh 1600x1000').save(p, quality=88)
    made.append(p)

for i in range(1, 5):
    p = os.path.join(A, 'portrait-%02d.png' % i)
    grad(900, 1400, PAL[(i + 1) % 6], PAL[(i + 4) % 6], 'POTRET %02d' % i).save(p)
    made.append(p)

for i in range(1, 4):
    p = os.path.join(A, 'tiny-avatar-%02d.png' % i)
    grad(48, 48, PAL[i % 6], PAL[(i + 2) % 6], '').save(p)
    made.append(p)

for i in range(1, 5):
    p = os.path.join(A, 'thumb-%02d.jpg' % i)
    grad(200, 120, PAL[(i + 2) % 6], PAL[i % 6], 'thumb').save(p, quality=70)
    made.append(p)

for i in range(1, 9):
    p = os.path.join(A, 'lazy', 'lazy-%02d.jpg' % i)
    grad(1200, 800, PAL[(i + 3) % 6], PAL[i % 6], 'MALAS %02d' % i, 'baru muncul setelah muat lebih').save(p, quality=85)
    made.append(p)

# Berkas nyata di balik rute flaky: server menolak 2 permintaan pertama, lalu melayaninya.
p = os.path.join(A, 'flaky-01.jpg')
grad(1200, 800, PAL[4], PAL[1], 'FLAKY 01', 'gagal 2x lalu berhasil').save(p, quality=85)
made.append(p)

# Isi identik, URL berbeda: harus dilewati oleh dedup hash.
shutil.copyfile(os.path.join(A, 'big-01.jpg'), os.path.join(A, 'alias', 'copy-of-big-01.jpg'))
shutil.copyfile(os.path.join(A, 'big-02.jpg'), os.path.join(A, 'alias', 'another-name-same-bytes.jpg'))

# Hanya ada di latar CSS: bukti sumber CSS berdiri sendiri.
p = os.path.join(A, 'css-only.jpg')
grad(1400, 900, PAL[2], PAL[0], 'LATAR CSS', 'hanya lewat background-image').save(p, quality=86)
made.append(p)

# Baru dibuat saat wadah terlihat: hanya panen dalam yang bisa menemukannya.
for i in range(1, 4):
    p = os.path.join(A, 'fold', 'fold-%02d.jpg' % i)
    grad(1200, 900, PAL[(i + 4) % 6], PAL[(i + 1) % 6], 'BAWAH LIPATAN %02d' % i, 'dibuat saat terlihat').save(p, quality=85)
    made.append(p)

with open(os.path.join(A, 'vector-mark.svg'), 'w') as f:
    f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="400" height="400">'
            '<rect width="200" height="200" fill="#0B0611"/>'
            '<path d="M56 50v40a44 44 0 0 0 88 0V50" fill="none" stroke="#FF2E88" stroke-width="16" stroke-linecap="round"/>'
            '<path d="M100 134v26" stroke="#C6FF3D" stroke-width="16" stroke-linecap="round"/>'
            '<circle cx="100" cy="170" r="11" fill="#C6FF3D"/></svg>')

# ---------- video ----------
WORK = os.path.join(HERE, '.work')
os.makedirs(WORK, exist_ok=True)
src = os.path.join(WORK, 'src.mp4')
if not os.path.exists(src):
    subprocess.run([FF, '-y', '-loglevel', 'error',
                    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=8',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
                    '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
                    '-force_key_frames', 'expr:gte(t,n_forced*2)',
                    '-c:a', 'aac', '-b:a', '96k', '-shortest', src], check=True)

shutil.copyfile(src, os.path.join(A, 'clip.mp4'))

lo = os.path.join(WORK, 'lo.mp4')
if not os.path.exists(lo):
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=320:180',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
                    '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
                    '-force_key_frames', 'expr:gte(t,n_forced*2)',
                    '-c:a', 'aac', '-b:a', '64k', lo], check=True)


def hls(inp, outdir, kind, init=None):
    args = [FF, '-y', '-loglevel', 'error', '-i', inp, '-c', 'copy',
            '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
            '-hls_segment_type', kind, '-hls_segment_filename', os.path.join(outdir, 'seg%03d.' + ('m4s' if kind == 'fmp4' else 'ts'))]
    if init:
        args += ['-hls_fmp4_init_filename', init]
    args += [os.path.join(outdir, 'index.m3u8')]
    subprocess.run(args, check=True)


hls(src, os.path.join(A, 'hls'), 'mpegts')
os.makedirs(os.path.join(A, 'hls', 'lo'), exist_ok=True)
hls(lo, os.path.join(A, 'hls', 'lo'), 'mpegts')
hls(src, os.path.join(A, 'hls-fmp4'), 'fmp4', 'init.mp4')

with open(os.path.join(A, 'hls', 'master.m3u8'), 'w') as f:
    f.write('#EXTM3U\n#EXT-X-VERSION:3\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.4d401f,mp4a.40.2"\nindex.m3u8\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=280000,RESOLUTION=320x180,CODECS="avc1.4d400d,mp4a.40.2"\nlo/index.m3u8\n')

with open(os.path.join(A, 'hls-fmp4', 'master.m3u8'), 'w') as f:
    f.write('#EXTM3U\n#EXT-X-VERSION:7\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360\nindex.m3u8\n')

# Playlist terenkripsi: wajib dilewati, bukan dibuka.
with open(os.path.join(A, 'secure', 'master.m3u8'), 'w') as f:
    f.write('#EXTM3U\n#EXT-X-VERSION:5\n'
            '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000000\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360\nindex.m3u8\n')
with open(os.path.join(A, 'secure', 'index.m3u8'), 'w') as f:
    f.write('#EXTM3U\n#EXT-X-VERSION:5\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n'
            '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n'
            '#EXTINF:2.0,\nseg000.ts\n#EXTINF:2.0,\nseg001.ts\n#EXT-X-ENDLIST\n')

subprocess.run([FF, '-y', '-loglevel', 'error', '-i', src, '-c', 'copy',
                '-f', 'dash', '-seg_duration', '2', '-use_template', '1', '-use_timeline', '1',
                '-init_seg_name', 'init-$RepresentationID$.m4s',
                '-media_seg_name', 'seg-$RepresentationID$-$Number%05d$.m4s',
                os.path.join(A, 'dash', 'manifest.mpd')], check=True)

shutil.copyfile(os.path.join(A, 'dash', 'manifest.mpd'), os.path.join(A, 'dash-secure', 'manifest.mpd'))
p = os.path.join(A, 'dash-secure', 'manifest.mpd')
s = open(p).read()
s = s.replace('<AdaptationSet', '<AdaptationSet', 1)
inject = ('<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" value="cenc"/>'
          )
i = s.find('>', s.find('<AdaptationSet')) + 1
s = s[:i] + inject + s[i:]
open(p, 'w').write(s)

print('fixture gambar:', len(made))
for d in ['hls', 'hls/lo', 'hls-fmp4', 'dash']:
    n = len(os.listdir(os.path.join(A, d)))
    print(d, '→', n, 'berkas')