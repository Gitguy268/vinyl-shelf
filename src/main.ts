import '@fontsource-variable/inter';
import './styles.css';
import { prefs } from './library/store';
import { App } from './ui/app';
import type { Quality } from './scene/world';

/** Starts the page: the 3D shelf where WebGL 2 works, the list everywhere. */
async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  // Spines and labels are painted in Inter: wait for it, briefly.
  await Promise.race([
    document.fonts.load('700 16px "Inter Variable"'),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = matchMedia('(max-width: 760px)').matches;
  const quality: Quality =
    (params.get('quality') as Quality | null) ??
    prefs.get<Quality>('quality', small || navigator.hardwareConcurrency <= 4 ? 'low' : 'high');
  let stage = null;
  if (!params.has('list') && document.createElement('canvas').getContext('webgl2')) {
    try {
      const { Stage } = await import('./scene/stage');
      stage = new Stage(canvas, quality === 'low' ? 'low' : 'high', {
        hover: (i, x, y) => app.hover(i, x, y),
        pick: (i) => app.pickIndex(i),
        heroClick: () => app.heroClick(),
      });
      stage.setReducedMotion(reduced);
    } catch {
      stage = null;
    }
  }
  const app = new App(stage);
  await app.start(params);
  if (params.has('debug')) Object.assign(window, { __shelf: { app, stage, library: app.library } });
}

void main();
