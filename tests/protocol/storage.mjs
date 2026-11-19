// The hard rule: a shelf hand-off leaves the saved library exactly as it was.
// For each player: seed a library the normal way, dump the origin's storage, hand an album over
// through the stub shelf and play it, dump again, and require the two dumps to be identical.
// usage: bash tests/protocol/site.sh && node tests/protocol/storage.mjs [player paths...]
import { chromium, firefox } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { serve } from './serve.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../.scratch/site'),
  PORT = 4402,
  O = `http://127.0.0.1:${PORT}`;
fs.copyFileSync(path.join(HERE, 'storage-dump.html'), path.join(ROOT, 'storage-dump.html'));
const SEED = path.resolve(HERE, '../../.scratch/fixtures/seed.mp3');
const PLAYERS = {
  'realistic-vinyl-player/index.html': '#audioIn',
  '8-bit-vinyl-player/index.html': '#audioIn',
  'ultra-realistic-vinyl-player/index.html': '#file',
  'Vinyl-Player/index.html': '#audioIn',
  '8bit-player/vinyl-8bit.html': '#audioIn',
  '8bit-player/index.html': '#file',
};
const only = process.argv.slice(2);
const FRESH = process.env.FRESH === '1';
const srv = await serve(ROOT, PORT);
let failed = 0;
for (const engine of [chromium, firefox]) {
  const browser = await engine.launch(
    engine === chromium
      ? {
          args: [
            '--autoplay-policy=no-user-gesture-required',
            ...(process.platform === 'darwin'
              ? ['--use-angle=metal', '--ignore-gpu-blocklist']
              : []),
          ],
        }
      : { firefoxUserPrefs: { 'media.autoplay.default': 0 } },
  );
  for (const [player, input] of Object.entries(PLAYERS)) {
    if (only.length && !only.includes(player)) continue;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const dump = async () => {
      await page.goto(`${O}/storage-dump.html`);
      return page.evaluate(() => window.dump());
    };
    // 1. A normal visit with one imported track: the library the shelf must not touch.
    //    FRESH=1: no visit at all, so the shelf session must not create any storage.
    if (!FRESH) {
      await page.goto(`${O}/${player}`);
      await page.waitForTimeout(2500);
      await page.setInputFiles(input, SEED);
      await page.waitForTimeout(2500);
    }
    const before = await dump();
    // 2. The hand-off, played for a few seconds.
    await page.goto(
      `${O}/vinyl-shelf/tests/protocol/stub.html?player=${encodeURIComponent(`${O}/${player}`)}`,
    );
    await page.click('#play');
    let st = null;
    for (let i = 0; i < 60 && !(st && st.playing && st.position > 1); i++) {
      await page.waitForTimeout(500);
      st = await page.evaluate(() => window.shelfState);
    }
    await page.waitForTimeout(1500);
    const after = await dump();
    const a = JSON.stringify(before),
      b = JSON.stringify(after);
    const seeded =
      JSON.stringify(before.indexedDB).includes('"buffer"') ||
      JSON.stringify(before.indexedDB).includes('"blob"');
    const ok = a === b && (seeded || FRESH) && st?.playing;
    if (!ok) failed++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${engine.name()} ${player} played=${!!st?.playing} seeded=${seeded} identical=${a === b}`,
    );
    if (a !== b) {
      for (const k of new Set([
        ...Object.keys(before.localStorage),
        ...Object.keys(after.localStorage),
      ]))
        if (before.localStorage[k] !== after.localStorage[k])
          console.log(
            `   localStorage ${k}:\n     before ${String(before.localStorage[k]).slice(0, 300)}\n     after  ${String(after.localStorage[k]).slice(0, 300)}`,
          );
      if (JSON.stringify(before.indexedDB) !== JSON.stringify(after.indexedDB))
        console.log(
          '   indexedDB differs:',
          Object.keys(before.indexedDB),
          '->',
          Object.keys(after.indexedDB),
          JSON.stringify(after.indexedDB).slice(0, 400),
        );
    }
    await ctx.close();
  }
  await browser.close();
}
srv.close();
process.exit(failed ? 1 : 0);
