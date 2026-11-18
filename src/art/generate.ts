import { inkOn, mix, rng, seedOf } from './colour';
import { SANS, SERIF, canvas, ctx2d, fitFont, grain, wrap } from './draw';

/**
 * Covers for albums that have none: a printed-sleeve look in one of seven layouts, always the
 * same for the same album. Drawn from scratch; no artwork is copied.
 */

const PALETTES: [string, string, string, string][] = [
  ['#f2e8d5', '#d9442b', '#1f3a5f', '#1b1b1b'],
  ['#1d3557', '#e63946', '#f1faee', '#a8dadc'],
  ['#f4a259', '#5b8e7d', '#bc4b51', '#f4e285'],
  ['#0f0e0d', '#c5a880', '#8c3b26', '#e6e1d6'],
  ['#2b2d42', '#8d99ae', '#edf2f4', '#ef233c'],
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261'],
  ['#3d405b', '#e07a5f', '#f2cc8f', '#81b29a'],
  ['#f7f3e3', '#e0a458', '#2e4057', '#5e2b1f'],
  ['#101820', '#f2aa4c', '#e8e2d6', '#3c6e71'],
  ['#efe6dd', '#283044', '#d64933', '#7d9d9c'],
  ['#e8d8c3', '#1e1e24', '#92140c', '#ffcf99'],
  ['#14213d', '#fca311', '#e5e5e5', '#7f5539'],
];

type Style = 'bauhaus' | 'bands' | 'type' | 'sun' | 'block' | 'halftone' | 'rings';
const STYLES: Style[] = ['bauhaus', 'bands', 'type', 'sun', 'block', 'halftone', 'rings'];

export interface CoverText {
  id: string;
  title: string;
  artist: string;
  year: number | null;
}

export function generatedCover(album: CoverText, size = 512): HTMLCanvasElement {
  const seed = seedOf(album.id + album.title);
  const rand = rng(seed);
  const [bg, a, b, c] = PALETTES[seed % PALETTES.length]!;
  const style = STYLES[(seed >>> 8) % STYLES.length]!;
  const cv = canvas(size, size);
  const g = ctx2d(cv);
  const s = size;
  g.fillStyle = bg;
  g.fillRect(0, 0, s, s);
  const ink = inkOn(bg);
  const pad = s * 0.07;
  const title = album.title.toUpperCase();
  const artist = album.artist;

  const caption = (y: number, colour = ink, align: CanvasTextAlign = 'left'): void => {
    g.fillStyle = colour;
    g.textAlign = align;
    g.textBaseline = 'alphabetic';
    const x = align === 'left' ? pad : align === 'right' ? s - pad : s / 2;
    fitFont(g, title, s - pad * 2, s * 0.06, (px) => `800 ${px}px ${SANS}`);
    g.fillText(title, x, y);
    fitFont(g, artist, s - pad * 2, s * 0.04, (px) => `500 ${px}px ${SANS}`);
    g.globalAlpha = 0.8;
    g.fillText(artist, x, y + s * 0.055);
    g.globalAlpha = 1;
  };

  switch (style) {
    case 'bauhaus': {
      const cells = 3;
      const cell = (s - pad * 2) / cells;
      const colours = [a, b, c, mix(a, bg, 0.5)];
      for (let i = 0; i < cells; i++)
        for (let j = 0; j < cells - 1; j++) {
          const x = pad + i * cell;
          const y = pad + j * cell;
          g.fillStyle = colours[Math.floor(rand() * colours.length)]!;
          const kind = Math.floor(rand() * 4);
          g.beginPath();
          if (kind === 0) g.arc(x + cell / 2, y + cell / 2, cell * 0.46, 0, Math.PI * 2);
          else if (kind === 1) {
            g.moveTo(x, y + cell);
            g.arc(x, y + cell, cell * 0.95, -Math.PI / 2, 0);
          } else if (kind === 2) g.rect(x + cell * 0.04, y + cell * 0.04, cell * 0.92, cell * 0.92);
          else {
            g.moveTo(x, y);
            g.lineTo(x + cell, y);
            g.lineTo(x, y + cell);
          }
          g.fill();
        }
      caption(s - pad - s * 0.075);
      break;
    }
    case 'bands': {
      const n = 4 + Math.floor(rand() * 4);
      const tilt = (rand() - 0.5) * 0.6;
      g.save();
      g.translate(s / 2, s / 2);
      g.rotate(tilt);
      for (let i = 0; i < n; i++) {
        g.fillStyle = [a, b, c][i % 3]!;
        const h = (s * 1.6) / n;
        g.fillRect(-s, -s * 0.8 + i * h, s * 2, h * (0.45 + rand() * 0.4));
      }
      g.restore();
      g.fillStyle = bg;
      g.fillRect(pad, s - pad - s * 0.17, s - pad * 2, s * 0.17);
      caption(s - pad - s * 0.085);
      break;
    }
    case 'type': {
      g.fillStyle = a;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      const px = s * 0.2;
      g.font = `900 ${px}px ${SANS}`;
      const lines = wrap(g, title, s - pad * 2, 4);
      const lh = px * 0.92;
      lines.forEach((line, i) => {
        fitFont(g, line, s - pad * 2, px, (v) => `900 ${v}px ${SANS}`, px * 0.4);
        g.fillStyle = i % 2 ? b : a;
        g.fillText(line, pad, pad + i * lh);
      });
      g.fillStyle = ink;
      g.textBaseline = 'alphabetic';
      fitFont(g, artist, s - pad * 2, s * 0.05, (v) => `600 ${v}px ${SANS}`);
      g.fillText(artist, pad, s - pad);
      if (album.year) {
        g.textAlign = 'right';
        g.font = `500 ${s * 0.035}px ${SANS}`;
        g.fillText(String(album.year), s - pad, s - pad);
      }
      break;
    }
    case 'sun': {
      const sky = g.createLinearGradient(0, 0, 0, s);
      sky.addColorStop(0, mix(b, '#000000', 0.35));
      sky.addColorStop(0.62, a);
      sky.addColorStop(1, c);
      g.fillStyle = sky;
      g.fillRect(0, 0, s, s);
      const horizon = s * 0.62;
      g.fillStyle = mix(c, '#ffffff', 0.25);
      g.beginPath();
      g.arc(s / 2, horizon, s * (0.2 + rand() * 0.08), Math.PI, 0);
      g.fill();
      g.fillStyle = mix(b, '#000000', 0.5);
      for (let i = 0; i < 9; i++) {
        const y = horizon + (i * i * s) / 180;
        g.fillRect(0, y, s, Math.max(1, s * 0.004 * (i + 1)));
      }
      g.fillStyle = mix(b, '#000000', 0.45);
      g.fillRect(0, horizon + s * 0.25, s, s);
      caption(s - pad, '#f8f1e7', 'center');
      break;
    }
    case 'block': {
      g.fillStyle = a;
      g.fillRect(0, 0, s, s * 0.58);
      g.fillStyle = inkOn(a);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      const name = artist.toUpperCase();
      const px = fitFont(g, name, s - pad * 2, s * 0.24, (v) => `900 ${v}px ${SANS}`);
      g.fillText(name, pad - px * 0.04, s * 0.58 - pad * 0.6);
      g.fillStyle = b;
      g.fillRect(pad, s * 0.64, s * 0.22, s * 0.012);
      g.fillStyle = ink;
      g.font = `italic 400 ${s * 0.06}px ${SERIF}`;
      wrap(g, album.title, s - pad * 2, 2).forEach((line, i) =>
        g.fillText(line, pad, s * 0.74 + i * s * 0.07),
      );
      if (album.year) {
        g.font = `600 ${s * 0.03}px ${SANS}`;
        g.fillText(String(album.year), pad, s - pad);
      }
      break;
    }
    case 'halftone': {
      const step = s / 28;
      const angle = rand() * Math.PI * 2;
      const cx = s * (0.3 + rand() * 0.4);
      const cy = s * (0.3 + rand() * 0.3);
      g.fillStyle = a;
      for (let y = step / 2; y < s; y += step)
        for (let x = step / 2; x < s; x += step) {
          const d = Math.hypot(x - cx, y - cy) / s;
          const wave =
            0.5 + 0.5 * Math.sin((x * Math.cos(angle) + y * Math.sin(angle)) / (s * 0.08));
          const r = step * 0.48 * Math.max(0, 1 - d * 1.6) * (0.5 + 0.5 * wave);
          if (r < 0.4) continue;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      caption(s - pad - s * 0.06);
      break;
    }
    case 'rings': {
      const cx = s * (0.35 + rand() * 0.3);
      const cy = s * (0.3 + rand() * 0.25);
      const rings = 8 + Math.floor(rand() * 8);
      for (let i = rings; i > 0; i--) {
        g.fillStyle = [a, b, c, bg][i % 4]!;
        g.beginPath();
        g.arc(cx, cy, (i / rings) * s * 0.55, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = bg;
      g.fillRect(0, s * 0.78, s, s * 0.22);
      caption(s - pad - s * 0.03);
      break;
    }
  }
  // Paper: grain, and a little wear along the edges.
  grain(g, s, s, 18, rand);
  const edge = g.createRadialGradient(s / 2, s / 2, s * 0.45, s / 2, s / 2, s * 0.75);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(40,25,10,0.18)');
  g.fillStyle = edge;
  g.fillRect(0, 0, s, s);
  return cv;
}
