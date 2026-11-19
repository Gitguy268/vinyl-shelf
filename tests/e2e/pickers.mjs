// The parts folder.mjs does not reach:
// 1. Chromium's File System Access path (Chrome, Edge, Dia): the fixture folder is written into the
//    origin private file system and handed out by a stubbed showDirectoryPicker. The handle must be
//    kept, the shelf must come back by itself on reload, and a "prompt" permission must lead to the
//    reconnect pill and one click back to playing.
// 2. Real clicks on the folder buttons in browsers without that API: a file chooser must open.
// 3. Playing in a new tab instead of beside the shelf.
// usage: npm run build && bash tests/e2e/fixtures.sh .scratch/music && node tests/e2e/pickers.mjs
import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '../protocol/serve.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const MUSIC = path.join(ROOT, '.scratch/music');
const SITE = path.join(ROOT, '.scratch/e2e-site');
const PORT = 4315;
fs.mkdirSync(path.join(SITE, 'vinyl-shelf'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'dist/index.html'), path.join(SITE, 'vinyl-shelf/index.html'));
const playerSrc = path.join(ROOT, '.scratch/site/realistic-vinyl-player/index.html');
const havePlayer = fs.existsSync(playerSrc);
if (havePlayer) {
  fs.mkdirSync(path.join(SITE, 'realistic-vinyl-player'), { recursive: true });
  fs.copyFileSync(playerSrc, path.join(SITE, 'realistic-vinyl-player/index.html'));
}
const srv = await serve(SITE, PORT);
const SHELF = `http://127.0.0.1:${PORT}/vinyl-shelf/index.html?debug`;
const PLAYER = `http://127.0.0.1:${PORT}/realistic-vinyl-player/index.html`;
const mac = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [];
const chromeArgs = [...mac, '--autoplay-policy=no-user-gesture-required'];

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/** Every fixture file, as [relative path, base64]: hidden and AppleDouble files included on purpose. */
function fixtureFiles() {
  const out = [];
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else out.push([r, fs.readFileSync(full).toString('base64')]);
    }
  };
  walk(MUSIC, '');
  return out;
}

async function usePlayer(page) {
  await page.evaluate((u) => {
    localStorage.setItem('vinyl-shelf.customPlayer', JSON.stringify(u));
    localStorage.setItem('vinyl-shelf.player', JSON.stringify('custom'));
  }, PLAYER);
}

async function playStatus(page) {
  let status = '';
  for (let i = 0; i < 40 && !/^Playing/.test(status); i++) {
    await page.waitForTimeout(500);
    status = (await page.textContent('#deck-status')) ?? '';
  }
  return status;
}

// ── 1. File System Access, with the folder kept ────────────────────
{
  console.log('\nchromium · File System Access');
  const browser = await chromium.launch({ args: chromeArgs });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Hand out the OPFS "music" folder as the picked folder.
  await ctx.addInitScript(() => {
    window.showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('music');
  });
  const page = await ctx.newPage();
  try {
    await page.goto(SHELF);
    await page.waitForFunction(() => window.__shelf);
    await usePlayer(page);
    await page.evaluate(async (files) => {
      const root = await navigator.storage.getDirectory();
      const music = await root.getDirectoryHandle('music', { create: true });
      for (const [rel, b64] of files) {
        const parts = rel.split('/');
        let dir = music;
        for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
        const fh = await dir.getFileHandle(parts.at(-1), { create: true });
        const w = await fh.createWritable();
        await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        await w.close();
      }
    }, fixtureFiles());
    await page.click('#welcome-folder');
    await page.waitForFunction(
      () =>
        window.__shelf.library.albums.length >= 6 &&
        window.__shelf.library.linked &&
        document.getElementById('progress').hidden,
      null,
      { timeout: 150000 },
    );
    const albums = await page.evaluate(() =>
      window.__shelf.library.albums.map((a) => [a.title, a.year, a.tracks[0].title]),
    );
    check(
      albums.length === 6,
      'six albums through the picker',
      JSON.stringify(albums.map((a) => a[0])),
    );
    check(
      JSON.stringify(albums.find((a) => a[0] === 'Blue Hours')) ===
        '["Blue Hours",1961,"Blue Hour Part 1"]',
      'tags read from handles',
    );
    const covers = await page.evaluate(async () => {
      const lib = window.__shelf.library;
      const out = {};
      for (const a of lib.albums) out[a.title] = (await lib.cover(a)).source;
      return out;
    });
    check(
      covers['Blue Hours'] === 'tag' && covers['Folder Album'] === 'file',
      'covers from tags and files',
      JSON.stringify(covers),
    );

    // Reload: the kept handle is still granted, so the shelf reconnects by itself.
    await page.reload();
    await page.waitForFunction(() => window.__shelf);
    await page
      .waitForFunction(() => window.__shelf.library.linked, null, { timeout: 30000 })
      .catch(() => undefined);
    const after = await page.evaluate(() => ({
      n: window.__shelf.library.albums.length,
      linked: window.__shelf.library.linked,
      pill: !document.getElementById('relink').hidden,
    }));
    check(
      after.n === 6 && after.linked && !after.pill,
      'reload reconnects the kept folder with no prompt',
      JSON.stringify(after),
    );
    if (havePlayer) {
      await page.evaluate(() =>
        window.__shelf.app.pick(window.__shelf.library.albums.find((a) => a.title === 'Low Sun')),
      );
      await page.click('#play');
      check(
        /^Playing: Low Sun 1/.test(await playStatus(page)),
        'plays straight after the reload',
        await page.textContent('#deck-status'),
      );
    }
  } catch (e) {
    check(false, 'run', String(e).split('\n')[0]);
  }
  await browser.close();
}

// ── 1b. The browser asks again: the pill, then one click ───────────
{
  console.log('\nchromium · File System Access, permission to be asked again');
  const browser = await chromium.launch({ args: chromeArgs });
  const dir = path.join(ROOT, '.scratch/pickers-profile');
  fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    args: chromeArgs,
    viewport: { width: 1280, height: 800 },
  });
  await browser.close();
  await ctx.addInitScript(() => {
    window.showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('music');
    if (sessionStorage.getItem('ask')) {
      FileSystemHandle.prototype.queryPermission = async () => 'prompt';
      FileSystemHandle.prototype.requestPermission = async () => {
        window.__asked = true;
        return 'granted';
      };
    }
  });
  const page = await ctx.newPage();
  try {
    await page.goto(SHELF);
    await page.waitForFunction(() => window.__shelf);
    await usePlayer(page);
    await page.evaluate(async (files) => {
      const music = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('music', { create: true });
      for (const [rel, b64] of files) {
        const parts = rel.split('/');
        let d = music;
        for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
        const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
        await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        await w.close();
      }
    }, fixtureFiles());
    await page.click('#welcome-folder');
    await page.waitForFunction(
      () => window.__shelf.library.linked && window.__shelf.library.albums.length >= 6,
      null,
      { timeout: 150000 },
    );
    await page.evaluate(() => sessionStorage.setItem('ask', '1'));
    await page.reload();
    await page.waitForFunction(() => window.__shelf && window.__shelf.library.albums.length >= 6);
    await page.waitForTimeout(800);
    check(
      await page.isVisible('#relink'),
      'the reconnect pill shows when the browser wants to ask',
    );
    await page.click('#relink-go');
    await page.waitForFunction(() => window.__shelf.library.linked, null, { timeout: 30000 });
    check(
      await page.evaluate(() => window.__asked === true),
      'one click asks the browser and reconnects',
    );
    if (havePlayer) {
      await page.evaluate(() =>
        window.__shelf.app.pick(
          window.__shelf.library.albums.find((a) => a.title === 'Night Trains'),
        ),
      );
      await page.click('#play');
      check(
        /^Playing: Platform 1/.test(await playStatus(page)),
        'then plays',
        await page.textContent('#deck-status'),
      );
    }
  } catch (e) {
    check(false, 'run', String(e).split('\n')[0]);
  }
  await ctx.close();
}

// ── 2. Real clicks open a file chooser where there is no folder API ──
const installed = { brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' };
for (const [name, launch] of [
  ['firefox', () => firefox.launch({ firefoxUserPrefs: { 'media.autoplay.default': 0 } })],
  ['webkit', () => webkit.launch()],
  ...(fs.existsSync(installed.brave)
    ? [['brave', () => chromium.launch({ executablePath: installed.brave, args: chromeArgs })]]
    : []),
]) {
  console.log(`\n${name} · clicks`);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await page.goto(SHELF);
    await page.waitForFunction(() => window.__shelf);
    await usePlayer(page);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.click('#welcome-folder'),
    ]);
    check(true, 'Open your music folder opens a file chooser');
    await chooser.setFiles(MUSIC);
    await page.waitForFunction(
      () => window.__shelf.library.albums.length >= 6 && document.getElementById('progress').hidden,
      null,
      { timeout: 150000 },
    );
    await page.reload();
    await page.waitForFunction(() => window.__shelf && window.__shelf.library.albums.length >= 6);
    await page.evaluate(() =>
      window.__shelf.app.pick(
        window.__shelf.library.albums.find((a) => a.title === 'Night Trains'),
      ),
    );
    await page.click('#play');
    await page.waitForSelector('#relink:not([hidden])', { timeout: 5000 });
    const [again] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.click('#relink-go'),
    ]);
    check(true, 'Connect folder opens a file chooser');
    await again.setFiles(MUSIC);
    if (havePlayer)
      check(
        /^Playing: Platform 1/.test(await playStatus(page)),
        'the waiting album plays after reconnecting',
        await page.textContent('#deck-status'),
      );

    // 3. The same album in a tab of its own.
    if (havePlayer && name !== 'webkit') {
      await page.evaluate(() => localStorage.setItem('vinyl-shelf.openTab', 'true'));
      await page.click('#deck-close');
      await page.evaluate(() =>
        window.__shelf.app.pick(window.__shelf.library.albums.find((a) => a.title === 'Low Sun')),
      );
      const [tab] = await Promise.all([
        ctx.waitForEvent('page', { timeout: 10000 }),
        page.click('#play'),
      ]);
      await tab.waitForURL(/realistic-vinyl-player/, { timeout: 15000 }).catch(() => undefined);
      check(
        /realistic-vinyl-player/.test(tab.url()),
        'Play opens the player in a new tab',
        tab.url(),
      );
      check(
        /^Playing: Low Sun 1/.test(await playStatus(page)),
        'the tab plays and reports back',
        await page.textContent('#deck-status'),
      );
    }
  } catch (e) {
    check(false, 'run', String(e).split('\n')[0]);
  }
  await browser.close();
}

srv.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
