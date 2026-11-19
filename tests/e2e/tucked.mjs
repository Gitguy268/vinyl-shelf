// A tucked-away player keeps playing: hand over a two-track album, hide the deck panel, and
// check that the player moves on to track 2 by itself.
// usage: bash tests/protocol/site.sh && bash tests/e2e/fixtures.sh .scratch/music && npm run build && node tests/e2e/tucked.mjs [players]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '../protocol/serve.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SITE = path.join(ROOT, '.scratch/site');
const PORT = 4312;
const players = (
  process.argv[2] ?? 'realistic-vinyl-player/index.html,ultra-realistic-vinyl-player/index.html'
).split(',');
fs.mkdirSync(path.join(SITE, 'vinyl-shelf'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'dist/index.html'), path.join(SITE, 'vinyl-shelf/index.html'));
const srv = await serve(SITE, PORT);
let failed = 0;
const browser = await chromium.launch({
  args: [
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
for (const player of players) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${PORT}/vinyl-shelf/index.html?debug`);
  await page.waitForFunction(() => window.__shelf);
  await page.evaluate((u) => {
    localStorage.setItem('vinyl-shelf.customPlayer', JSON.stringify(u));
    localStorage.setItem('vinyl-shelf.player', JSON.stringify('custom'));
  }, `http://127.0.0.1:${PORT}/${player}`);
  await page.setInputFiles('#folder-input', path.join(ROOT, '.scratch/music'));
  await page.waitForFunction(
    () => window.__shelf.library.linked && window.__shelf.library.albums.length >= 6,
    null,
    { timeout: 60000 },
  );
  await page.evaluate(() => {
    window.__states = [];
    const app = window.__shelf.app;
    app.deck.handoff.events.on('state', (s) =>
      window.__states.push([s.track, s.playing, s.position]),
    );
  });
  await page.evaluate(() =>
    window.__shelf.app.pick(window.__shelf.library.albums.find((a) => a.title === 'Night Trains')),
  );
  await page.click('#play');
  await page.waitForFunction(() => window.__states.some((s) => s[1]), null, { timeout: 40000 });
  await page.click('#deck-hide');
  const tuckedAt = await page.evaluate(() => window.__states.length);
  // Each track is 3 s; ultra adds a lead-in and the arm's travel.
  await page.waitForTimeout(14000);
  const after = await page.evaluate((n) => window.__states.slice(n), tuckedAt);
  const reached = Math.max(-1, ...after.map((s) => s[0]));
  const ok = reached >= 1;
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${player}: tucked, reached track ${reached + 1}; last states ${JSON.stringify(after.slice(-3))}`,
  );
  await page.close();
}
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
