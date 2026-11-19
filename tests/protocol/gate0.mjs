// Gate 0: can a click in a shelf page start an album in a framed player, from every kind of parent?
// usage: bash tests/protocol/site.sh && node tests/protocol/gate0.mjs <player path under .scratch/site/ or a live URL> [engines]
import { chromium, firefox, webkit } from 'playwright';
import path from 'node:path';
import { serve } from './serve.mjs';
const [playerPath, enginesArg = 'chromium,firefox,webkit'] = process.argv.slice(2);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../.scratch/site'),
  PORT = 4401;
const srv = await serve(ROOT, PORT);
const stubPath = 'vinyl-shelf/tests/protocol/stub.html';
const parents = {
  'same-origin': `http://127.0.0.1:${PORT}/${stubPath}`,
  'cross-origin': `http://localhost:${PORT}/${stubPath}`,
  file: `file://${ROOT}/${stubPath}`,
};
const player = /^https?:/.test(playerPath) ? playerPath : `http://127.0.0.1:${PORT}/${playerPath}`;
const engines = { chromium, firefox, webkit };
const launchOpts = {
  chromium: {
    args: [
      '--autoplay-policy=document-user-activation-required',
      ...(process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : []),
    ],
  },
  firefox: {
    firefoxUserPrefs: { 'media.autoplay.default': 1, 'media.autoplay.blocking_policy': 0 },
  },
  webkit: {},
};
const results = [];
const ok = (st) =>
  !!(st && st.playing && st.position > 1.5 && (st.sound === undefined || st.sound === 'running'));
for (const name of enginesArg.split(',')) {
  const exe = {
    brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    dia: '/Applications/Dia.app/Contents/MacOS/Dia',
  }[name];
  const browser = exe
    ? await chromium.launch({
        executablePath: exe,
        headless: !process.env.HEADED,
        args: ['--autoplay-policy=document-user-activation-required'],
      })
    : await engines[name].launch(launchOpts[name]);
  for (const [kind, parent] of Object.entries(parents)) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      if (!location.search.includes('shelf')) return;
      window.__shelfErrors = [];
      addEventListener('error', (e) => window.__shelfErrors.push('error ' + e.message));
      addEventListener('unhandledrejection', (e) =>
        window.__shelfErrors.push(
          'reject ' + String(e.reason && (e.reason.stack || e.reason)).slice(0, 300),
        ),
      );
    });
    const page = await ctx.newPage();
    let row = { engine: name, parent: kind };
    try {
      await page.goto(`${parent}?debug&player=${encodeURIComponent(player)}`);
      await page.click('#play');
      const deadline = Date.now() + 45000;
      let st = null;
      const frame = () =>
        page.frames().find((f) => f !== page.mainFrame() && f.url().includes(playerPath));
      while (Date.now() < deadline) {
        st = await page.evaluate(() => window.shelfState);
        if (ok(st)) break;
        if (st && st.blocked && !row.tapped) {
          row.tapped = true;
          await frame().click('#shelfTap, #shelf-tap');
        }
        await page.waitForTimeout(500);
      }
      const inner = frame()
        ? await frame()
            .evaluate(() => {
              const d = window.__deck,
                errors = window.__shelfErrors;
              if (!d) return { deck: false, errors };
              if (d.player)
                return {
                  ctx: d.deck.engine.context?.state ?? 'none',
                  pos: d.deck.engine.currentTime,
                  tracks: d.player.queue.ids.length,
                  errors,
                };
              return {
                ctx: d.State.audioCtx ? d.State.audioCtx.state : 'none',
                pos: d.Engine.pos(),
                tracks: d.State.playlist.length,
                errors,
              };
            })
            .catch((e) => ({ err: String(e).slice(0, 120) }))
        : { frame: false };
      row = {
        ...row,
        pass: ok(st),
        state: st && { playing: st.playing, pos: st.position, sound: st.sound, title: st.title },
        inner,
        log: await page.evaluate(() => (window.shelfLog || []).slice(0, 5).join(' | ')),
      };
    } catch (e) {
      row.fail = String(e).slice(0, 200);
    }
    results.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
  await browser.close();
}
srv.close();
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} played`);
process.exit(passed === results.length ? 0 : 1);
