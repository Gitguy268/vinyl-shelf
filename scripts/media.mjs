// Makes the README pictures from the demo shelf: a screenshot, the link preview and a short
// animated demo. usage: npm run build && node scripts/media.mjs (needs ffmpeg)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '../tests/protocol/serve.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'docs/media');
const tmp = path.join(root, '.scratch/media');
fs.mkdirSync(out, { recursive: true });
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const srv = await serve(path.join(root, 'dist'), 4314);
const args = [
  ...(process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : []),
  '--autoplay-policy=no-user-gesture-required',
];
const browser = await chromium.launch({ args });
const url = 'http://127.0.0.1:4314/index.html?demo&debug&quality=high';
const ready = async (page) => {
  await page.goto(url);
  await page.waitForFunction(() => window.__shelf);
  await page.waitForTimeout(4500); // covers and spines
};

// 1. The shelf, at 2x.
{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await ready(page);
  await page.screenshot({ path: path.join(tmp, 'shelf.png') });
  await page.evaluate(() => window.__shelf.app.pickIndex(14));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(tmp, 'record.png') });
  await page.close();
}
// 2. Link preview, 1200 x 630.
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await ready(page);
  await page.screenshot({ path: path.join(root, 'public/og.png') });
  await page.close();
}
// 3. The demo: browse, pull a record, turn it over, play it.
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: tmp, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();
  await ready(page);
  const s = (js, ms) => page.evaluate(js).then(() => page.waitForTimeout(ms));
  await s(() => window.__shelf.stage.focusOn(40), 1400);
  await s(() => window.__shelf.stage.focusOn(46), 900);
  await s(() => window.__shelf.app.pickIndex(46), 2200);
  await s(() => window.__shelf.app.flip(), 1800);
  await s(() => window.__shelf.app.flip(), 1200);
  await s(() => window.__shelf.app.play(), 5500);
  await s(() => document.getElementById('deck-hide').click(), 2500);
  await ctx.close();
}
await browser.close();
srv.close();

const video = fs.readdirSync(tmp).find((f) => f.endsWith('.webm'));
const ff = (...a) =>
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
ff(
  '-i',
  path.join(tmp, 'shelf.png'),
  '-vf',
  'scale=1440:-1',
  '-quality',
  '86',
  path.join(out, 'shelf.webp'),
);
ff(
  '-i',
  path.join(tmp, 'record.png'),
  '-vf',
  'scale=1440:-1',
  '-quality',
  '86',
  path.join(out, 'record.webp'),
);
// Skip the page load; 12 frames a second at 800 px keeps the file small.
ff(
  '-ss',
  '4.6',
  '-i',
  path.join(tmp, video),
  '-vf',
  'fps=12,scale=800:-1:flags=lanczos',
  '-c:v',
  'libwebp_anim',
  '-loop',
  '0',
  '-quality',
  '70',
  '-compression_level',
  '6',
  path.join(out, 'demo.webp'),
);
for (const f of fs.readdirSync(out))
  console.log(f, Math.round(fs.statSync(path.join(out, f)).size / 1024), 'KB');
