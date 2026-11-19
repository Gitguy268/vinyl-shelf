// End to end with a real music folder (tests/e2e/fixtures.sh), against the built page.
// usage: npm run build && bash tests/e2e/fixtures.sh .scratch/music && node tests/e2e/folder.mjs [engines] [http,file]
// Checks values only real tag reading can give, covers from tags and files, no network on file://,
// then reload → restore from the index → re-pick → nothing re-read → play on a local player copy.
import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '../protocol/serve.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const MUSIC = path.join(ROOT, '.scratch/music');
const SITE = path.join(ROOT, '.scratch/e2e-site');
const PORT = 4311;
const [enginesArg = 'chromium,firefox,webkit', modesArg = 'http,file'] = process.argv.slice(2);

// One root for the shelf and a local copy of the realistic player (tests/protocol/site.sh).
fs.mkdirSync(path.join(SITE, 'vinyl-shelf'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'dist/index.html'), path.join(SITE, 'vinyl-shelf/index.html'));
const playerSrc = path.join(ROOT, '.scratch/site/realistic-vinyl-player/index.html');
const havePlayer = fs.existsSync(playerSrc);
if (havePlayer) {
  fs.mkdirSync(path.join(SITE, 'realistic-vinyl-player'), { recursive: true });
  fs.copyFileSync(playerSrc, path.join(SITE, 'realistic-vinyl-player/index.html'));
}
const srv = await serve(SITE, PORT);
const PLAYER = `http://127.0.0.1:${PORT}/realistic-vinyl-player/index.html`;

const expectAlbums = {
  'Blue Hours': {
    artist: 'Ada Fictional',
    year: 1961,
    genre: 'Jazz',
    first: 'Blue Hour Part 1',
    tracks: 3,
    cover: 'tag',
  },
  'Night Trains': {
    artist: 'The Sleeper Cars',
    year: 1974,
    genre: 'Rock',
    first: 'Platform 1',
    tracks: 2,
    cover: 'tag',
  },
  'Low Sun': {
    artist: 'Orchard Radio',
    year: 2009,
    genre: 'Folk',
    first: 'Low Sun 1',
    tracks: 2,
    cover: 'tag',
  },
  'Folder Album': {
    artist: 'Folder Artist',
    year: null,
    genre: '',
    first: 'Untagged Song 1',
    tracks: 2,
    cover: 'file',
  },
  'Double Feature': {
    artist: 'Cinema Twins',
    year: 1988,
    genre: '',
    first: 'Reel 1-1',
    tracks: 4,
    cover: 'made',
  },
  'Summer Mixtape': {
    artist: 'Various Artists',
    year: 2001,
    genre: '',
    first: 'Mix Song 1',
    tracks: 3,
    cover: 'made',
  },
};

const engines = { chromium, firefox, webkit };
const launch = {
  chromium: {
    args: [
      ...(process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : []),
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0 } },
  webkit: {},
};
let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

for (const name of enginesArg.split(',')) {
  for (const mode of modesArg.split(',')) {
    console.log(`\n${name} · ${mode}`);
    // `brave` and `dia`: the browsers installed on this Mac, driven as Chromium.
    const installed = {
      brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      dia: '/Applications/Dia.app/Contents/MacOS/Dia',
    }[name];
    const browser = installed
      ? await chromium.launch({
          executablePath: installed,
          args: ['--autoplay-policy=no-user-gesture-required'],
        })
      : await engines[name].launch(launch[name]);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    const outside = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      const u = r.url();
      if (
        mode === 'file' &&
        /^https?:/.test(u) &&
        !u.startsWith(`http://127.0.0.1:${PORT}/realistic`)
      )
        outside.push(u);
    });
    const url =
      mode === 'http'
        ? `http://127.0.0.1:${PORT}/vinyl-shelf/index.html?debug`
        : `file://${path.join(SITE, 'vinyl-shelf/index.html')}?debug`;
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.__shelf, null, { timeout: 30000 });
      check(await page.isVisible('#welcome'), 'first visit shows the welcome');
      // Every play in this test goes to the local copy of the player.
      await page.evaluate((u) => {
        localStorage.setItem('vinyl-shelf.customPlayer', JSON.stringify(u));
        localStorage.setItem('vinyl-shelf.player', JSON.stringify('custom'));
      }, PLAYER);
      await page.setInputFiles('#folder-input', MUSIC);
      await page.waitForFunction(
        () =>
          window.__shelf.library.albums.length >= 6 && document.getElementById('progress').hidden,
        null,
        { timeout: 60000 },
      );
      const albums = await page.evaluate(() =>
        window.__shelf.library.albums.map((a) => ({
          title: a.title,
          artist: a.artist,
          year: a.year,
          genre: a.genre,
          tracks: a.tracks.map((t) => t.title),
          discs: a.tracks.map((t) => t.discNo),
          coverPath: a.coverPath,
        })),
      );
      check(
        albums.length === 6,
        'six albums, hidden and AppleDouble files skipped',
        albums.map((a) => a.title).join(', '),
      );
      for (const [title, want] of Object.entries(expectAlbums)) {
        const a = albums.find((x) => x.title === title);
        if (!a) {
          check(false, `album "${title}" found`);
          continue;
        }
        const ok =
          a.artist === want.artist &&
          a.year === want.year &&
          a.genre === want.genre &&
          a.tracks[0] === want.first &&
          a.tracks.length === want.tracks;
        check(ok, `"${title}" tags`, ok ? '' : JSON.stringify(a));
      }
      const df = albums.find((a) => a.title === 'Double Feature');
      check(
        JSON.stringify(df?.discs) === '[1,1,2,2]',
        'two discs in order',
        JSON.stringify(df?.discs),
      );
      check(
        albums.find((a) => a.title === 'Folder Album')?.coverPath ===
          'Folder Artist/Folder Album/cover.jpg',
        'cover.jpg found',
      );
      const covers = await page.evaluate(async () => {
        const lib = window.__shelf.library;
        const out = {};
        for (const a of lib.albums) out[a.title] = (await lib.cover(a)).source;
        return out;
      });
      for (const [title, want] of Object.entries(expectAlbums))
        check(covers[title] === want.cover, `"${title}" cover from ${want.cover}`, covers[title]);

      // Reload: the shelf comes back from the index, not linked to the files any more.
      await page.reload();
      await page.waitForFunction(() => window.__shelf, null, { timeout: 30000 });
      await page.waitForTimeout(800);
      const restored = await page.evaluate(() => ({
        n: window.__shelf.library.albums.length,
        linked: window.__shelf.library.linked,
      }));
      const idb = restored.n === 6;
      check(
        idb || mode === 'file',
        'reload restores the shelf from IndexedDB',
        JSON.stringify(restored),
      );
      if (idb) {
        check(
          !restored.linked,
          'not linked to the files after a reload (they must be picked again)',
        );
        // Play without the files: the reconnect pill asks for the folder.
        await page.evaluate(async () => {
          const app = window.__shelf.app;
          await app.pick(window.__shelf.library.albums.find((a) => a.title === 'Blue Hours'));
          await app.play(false);
        });
        check(await page.isVisible('#relink'), 'playing asks for the folder again');
        // Re-pick: every file matches the index, so no tag is read.
        await page.evaluate(() => {
          window.__totals = [];
          window.__shelf.library.events.on(
            'progress',
            (p) => p && p.phase === 'reading' && window.__totals.push(p.total),
          );
        });
        await page.setInputFiles('#folder-input', MUSIC);
        await page.waitForFunction(() => window.__shelf.library.linked, null, { timeout: 30000 });
        const totals = await page.evaluate(() => window.__totals);
        check(
          totals.length > 0 && totals.every((t) => t === 0),
          're-picking reads no tags',
          JSON.stringify(totals),
        );
      } else {
        console.log(
          '  note no IndexedDB for this file:// page: the shelf starts empty after a reload (as designed)',
        );
        await page.setInputFiles('#folder-input', MUSIC);
        await page.waitForFunction(
          () => window.__shelf.library.albums.length >= 6 && window.__shelf.library.linked,
          null,
          { timeout: 60000 },
        );
      }

      // Play on a local copy of the realistic player.
      if (havePlayer) {
        await page.evaluate((u) => {
          localStorage.setItem('vinyl-shelf.customPlayer', JSON.stringify(u));
          localStorage.setItem('vinyl-shelf.player', JSON.stringify('custom'));
        }, PLAYER);
        await page.evaluate(async () => {
          const app = window.__shelf.app;
          const album = window.__shelf.library.albums.find((a) => a.title === 'Night Trains');
          await app.putBack();
          await app.pick(album);
        });
        await page.click('#play');
        let status = '';
        for (let i = 0; i < 40 && !/^Playing/.test(status); i++) {
          await page.waitForTimeout(500);
          status = await page.textContent('#deck-status');
          if (i === 6 && (await page.isVisible('#deck-hint'))) {
            const frame = page.frames().find((f) => f.url().includes('realistic-vinyl-player'));
            await frame?.click('#shelfTap').catch(() => undefined);
          }
        }
        check(
          /^Playing: Platform 1/.test(status),
          'plays on the local player, with the tag title',
          status,
        );
      }
      check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
      if (mode === 'file')
        check(
          outside.length === 0,
          'no network requests from the file:// page',
          outside.slice(0, 3).join(' '),
        );
    } catch (e) {
      check(false, 'run', String(e).split('\n')[0]);
    }
    await browser.close();
  }
}
srv.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
