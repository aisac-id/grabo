/* Grabo — pembuat logo & ikon.
 * Satu sumber SVG, dirender ke PNG oleh Chrome supaya hasil akhirnya identik dengan yang dilihat di UI. */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.GRABO_PUPPETEER || 'puppeteer-core');

const OUT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BRAND = path.join(OUT, 'brand');
fs.mkdirSync(BRAND, { recursive: true });
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });

const GRAD = `<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FF2E88"/><stop offset=".55" stop-color="#8B5CFF"/><stop offset="1" stop-color="#00E5FF"/>
  </linearGradient>
  <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FF2E88"/><stop offset="1" stop-color="#8B5CFF"/>
  </linearGradient>
</defs>`;

/* Ikon aplikasi: capit penyambar + titik hasil. */
function iconSvg(size) {
  const thin = size <= 32;
  const border = thin ? 5 : 3.4;
  const claw = thin ? 7.5 : 5.4;
  const stem = thin ? 7.5 : 5.4;
  const dot = thin ? 5 : 3.6;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
${GRAD}
<rect x="${border / 2}" y="${border / 2}" width="${64 - border}" height="${64 - border}" rx="${thin ? 14 : 16}" fill="#0B0611" stroke="url(#g)" stroke-width="${border}"/>
<path d="M18 16v13a14 14 0 0 0 28 0V16" fill="none" stroke="url(#g)" stroke-width="${claw}" stroke-linecap="round"/>
<path d="M32 43v${thin ? 6 : 8}" stroke="#C6FF3D" stroke-width="${stem}" stroke-linecap="round"/>
<circle cx="32" cy="${thin ? 53 : 54}" r="${dot}" fill="#C6FF3D"/>
</svg>`;
}

/* Logo lengkap: ikon + kata "Grabo" + tagline. */
const WORDMARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 240" width="1520" height="480">
${GRAD}
<rect width="760" height="240" fill="#0B0611"/>
<g transform="translate(40,44) scale(2.35)">
  <rect x="1.7" y="1.7" width="60.6" height="60.6" rx="16" fill="#150C1E" stroke="url(#g)" stroke-width="3.4"/>
  <path d="M18 16v13a14 14 0 0 0 28 0V16" fill="none" stroke="url(#g)" stroke-width="5.4" stroke-linecap="round"/>
  <path d="M32 43v8" stroke="#C6FF3D" stroke-width="5.4" stroke-linecap="round"/>
  <circle cx="32" cy="54" r="3.6" fill="#C6FF3D"/>
</g>
<text x="222" y="140" font-family="Bricolage" font-size="104" font-weight="800" letter-spacing="-3" fill="url(#g)">Grabo</text>
<text x="226" y="182" font-family="JetBrains" font-size="21" letter-spacing="4.5" fill="#B49AC4">BULK MEDIA GRABBER</text>
<rect x="226" y="196" width="300" height="3" fill="url(#g)"/>
</svg>`;

const MONO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">
<rect x="2" y="2" width="60" height="60" rx="16" fill="none" stroke="#FDEFF7" stroke-width="3.4"/>
<path d="M18 16v13a14 14 0 0 0 28 0V16" fill="none" stroke="#FDEFF7" stroke-width="5.4" stroke-linecap="round"/>
<path d="M32 43v8" stroke="#FDEFF7" stroke-width="5.4" stroke-linecap="round"/>
<circle cx="32" cy="54" r="3.6" fill="#FDEFF7"/>
</svg>`;

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  const fontCss = `
    @font-face{font-family:'Bricolage';src:url('data:font/woff2;base64,${fs.readFileSync(path.join(OUT, 'fonts/bricolage.woff2')).toString('base64')}') format('woff2');font-weight:200 800;}
    @font-face{font-family:'JetBrains';src:url('data:font/woff2;base64,${fs.readFileSync(path.join(OUT, 'fonts/jetbrains.woff2')).toString('base64')}') format('woff2');font-weight:100 800;}
    html,body{margin:0;padding:0;background:transparent}
  `;

  for (const size of [16, 32, 48, 128, 512]) {
    const svg = iconSvg(size);
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<style>${fontCss}</style>${svg}`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(OUT, 'icons', 'icon' + size + '.png'), omitBackground: true });
    console.log('icon' + size + '.png');
  }

  fs.writeFileSync(path.join(BRAND, 'logomark.svg'), iconSvg(512));
  fs.writeFileSync(path.join(BRAND, 'logo.svg'), WORDMARK);
  fs.writeFileSync(path.join(BRAND, 'logomark-mono.svg'), MONO);

  await page.setViewport({ width: 1520, height: 480, deviceScaleFactor: 1 });
  await page.setContent(`<style>${fontCss}</style>${WORDMARK}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(BRAND, 'logo.png') });
  console.log('logo.png');

  await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
  await page.setContent(`<style>${fontCss}</style>${MONO}`, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(BRAND, 'logomark-mono.png'), omitBackground: true });
  console.log('logomark-mono.png');

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });