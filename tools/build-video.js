/* Video promo Grabo: bingkai HTML asli + gerak kamera lembut + transisi silang + bantalan suara.
 * Semua bingkai berasal dari tangkapan layar ekstensi yang sungguhan. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EXT = path.resolve(__dirname, '..');
const OUT = path.join(EXT, 'promo');
const WORK = path.join(__dirname, '.work-promo');
const FF = process.env.FFMPEG || 'ffmpeg';

const FRAMES = ['v1-title.png', 'v2-harvest.png', 'v3-gallery.png', 'v4-queue.png', 'v5-out.png', 'v6-end.png'];
const DUR = 4.6;      /* detik per bingkai */
const XFADE = 0.7;    /* detik transisi silang */
const FPS = 30;

function run(args) {
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

/* gerak kamera: zoom masuk perlahan, sedikit geser, arah berbeda per bingkai */
function motion(i) {
  const dir = i % 2 === 0 ? 1 : -1;
  const z = i === FRAMES.length - 1 ? 'min(zoom+0.0004,1.06)' : 'min(zoom+0.00075,1.10)';
  const x = `iw/2-(iw/zoom/2)+${dir}*${i === 0 ? 0 : 18}*on/${FPS * DUR}`;
  const y = `ih/2-(ih/zoom/2)`;
  return `scale=3200:-1:flags=lanczos,zoompan=z='${z}':x='${x}':y='${y}':d=${Math.round(DUR * FPS)}:s=1920x1080:fps=${FPS},format=yuv420p`;
}

const clips = [];
FRAMES.forEach((f, i) => {
  const out = path.join(WORK, 'clip' + i + '.mp4');
  run(['-loop', '1', '-i', path.join(WORK, f), '-t', String(DUR),
    '-vf', motion(i), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-r', String(FPS), out]);
  clips.push(out);
  console.log('✓ klip', i + 1, f);
});

/* rantai xfade */
const inputs = [];
clips.forEach((c) => inputs.push('-i', c));
const total = DUR * clips.length - XFADE * (clips.length - 1);
let chain = '';
let prev = '0:v';
for (let i = 1; i < clips.length; i++) {
  const label = 'x' + i;
  const offset = (DUR * i - XFADE * i).toFixed(3);
  chain += `[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset}[${label}];`;
  prev = label;
}
chain += `[${prev}]fade=t=in:st=0:d=0.6,fade=t=out:st=${(total - 0.8).toFixed(3)}:d=0.8,format=yuv420p[vout]`;

const silent = path.join(WORK, 'silent.mp4');
run([...inputs, '-filter_complex', chain, '-map', '[vout]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-r', String(FPS), '-movflags', '+faststart', silent]);
console.log('✓ rangkaian video', total.toFixed(2) + 's');

/* bantalan suara: akord lembut + denyut halus, semua disintesis lokal */
const audio = path.join(WORK, 'bed.m4a');
const mix = `[s0][s1][s2][s3]amix=inputs=4:normalize=0,tremolo=f=0.28:d=0.35,lowpass=f=1400,` +
  `afade=t=in:st=0:d=1.6,afade=t=out:st=${(total - 2.2).toFixed(3)}:d=2.2,volume=1.6[aout]`;
run(['-f', 'lavfi', '-i', `sine=frequency=110:duration=${total}`,
  '-f', 'lavfi', '-i', `sine=frequency=164.81:duration=${total}`,
  '-f', 'lavfi', '-i', `sine=frequency=220:duration=${total}`,
  '-f', 'lavfi', '-i', `sine=frequency=329.63:duration=${total}`,
  '-filter_complex', `[0:a]volume=0.16[s0];[1:a]volume=0.13[s1];[2:a]volume=0.10[s2];[3:a]volume=0.07[s3];` + mix,
  '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', audio]);
console.log('✓ bantalan suara');

const final = path.join(OUT, 'grabo-promo.mp4');
run(['-i', silent, '-i', audio, '-map', '0:v', '-map', '1:a',
  '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', final]);

/* poster video dari bingkai judul */
run(['-i', path.join(WORK, 'v1-title.png'), '-vf', 'scale=1280:-1', '-q:v', '3', path.join(OUT, 'video-poster.jpg')]);

/* pratinjau GIF ringan untuk README */
run(['-i', final, '-vf', 'fps=6,scale=520:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
  '-t', '10', path.join(OUT, 'grabo-preview.gif')]);

const size = (f) => (fs.statSync(f).size / 1048576).toFixed(2) + ' MB';
console.log('selesai:', final, size(final), '| gif', size(path.join(OUT, 'grabo-preview.gif')));