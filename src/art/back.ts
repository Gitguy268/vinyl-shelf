import { inkOn, mix, rng, seedOf } from './colour';
import { SANS, SERIF, canvas, ctx2d, drawCover, ellipsize, fitFont, grain } from './draw';
import { catalogue } from './spine';

export interface BackTrack {
  title: string;
  durationSec: number | null;
}

export interface BackText {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  genre: string;
  colour: string;
  ink: string;
  /** Tracks per side, side A first. */
  sides: BackTrack[][];
}

export function time(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** The back of the sleeve: the tracklist by side, as printed on an LP. */
export function backCover(album: BackText, size = 1024): HTMLCanvasElement {
  const cv = canvas(size, size);
  const g = ctx2d(cv);
  const s = size;
  const paper = mix(album.colour, '#f3ede2', 0.82);
  const ink = inkOn(paper);
  const accent = mix(album.colour, ink, 0.15);
  g.fillStyle = paper;
  g.fillRect(0, 0, s, s);
  const pad = s * 0.08;
  g.fillStyle = accent;
  g.fillRect(pad, pad, s - pad * 2, s * 0.006);
  g.fillStyle = ink;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  fitFont(g, album.artist.toUpperCase(), s - pad * 2, s * 0.05, (px) => `800 ${px}px ${SANS}`);
  g.fillText(album.artist.toUpperCase(), pad, pad + s * 0.07);
  fitFont(g, album.title, s - pad * 2, s * 0.045, (px) => `italic 400 ${px}px ${SERIF}`);
  g.fillText(album.title, pad, pad + s * 0.125);

  const sides = album.sides.length > 0 ? album.sides : [[]];
  const cols = sides.length > 1 ? 2 : 1;
  const colW = (s - pad * 2 - (cols - 1) * s * 0.05) / cols;
  const top = pad + s * 0.2;
  const lines = Math.max(...sides.map((side) => side.length));
  const perCol = Math.ceil(sides.length / cols);
  const rows = perCol * (lines + 2);
  const lh = Math.min(s * 0.034, (s - top - pad * 2.2) / Math.max(rows, 1));
  const px = lh * 0.72;
  sides.forEach((side, i) => {
    const col = Math.floor(i / perCol);
    const x = pad + col * (colW + s * 0.05);
    let y = top + (i % perCol) * (lines + 2) * lh;
    const letter = String.fromCharCode(65 + i);
    g.fillStyle = accent;
    g.font = `800 ${px * 0.9}px ${SANS}`;
    g.fillText(`SIDE ${letter}`, x, y);
    y += lh * 1.2;
    side.forEach((t, n) => {
      g.fillStyle = ink;
      g.font = `600 ${px}px ${SANS}`;
      const no = `${letter}${n + 1}`;
      g.fillText(no, x, y);
      const d = time(t.durationSec);
      g.textAlign = 'right';
      g.font = `400 ${px}px ${SANS}`;
      g.globalAlpha = 0.7;
      g.fillText(d, x + colW, y);
      g.globalAlpha = 1;
      g.textAlign = 'left';
      g.font = `400 ${px}px ${SANS}`;
      g.fillText(ellipsize(g, t.title, colW - px * 5.5), x + px * 2.4, y);
      y += lh;
    });
  });
  // Footer: catalogue number, speed, the small print.
  g.fillStyle = accent;
  g.fillRect(pad, s - pad - s * 0.05, s - pad * 2, s * 0.003);
  g.fillStyle = ink;
  g.globalAlpha = 0.75;
  g.font = `600 ${s * 0.022}px ${SANS}`;
  const meta = [
    catalogue(album.id),
    '33⅓ RPM',
    'STEREO',
    album.genre,
    album.year ? String(album.year) : '',
  ]
    .filter(Boolean)
    .join('   ·   ');
  g.fillText(meta, pad, s - pad);
  g.textAlign = 'right';
  g.fillText('VINYL SHELF', s - pad, s - pad);
  g.globalAlpha = 1;
  grain(g, s, s, 10, rng(seedOf(album.id)));
  return cv;
}

/**
 * The record's label: the cover in a circle, as many pressings print it, with a ring of text and
 * the spindle hole. `size` is the label's diameter in pixels.
 */
export function labelArt(
  album: { id: string; title: string; artist: string; colour: string; ink: string },
  cover: CanvasImageSource & { width: number; height: number },
  size = 512,
): HTMLCanvasElement {
  const cv = canvas(size, size);
  const g = ctx2d(cv);
  const r = size / 2;
  g.save();
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = album.colour;
  g.fillRect(0, 0, size, size);
  g.globalAlpha = 0.92;
  drawCover(g, cover, size * 0.12, size * 0.12, size * 0.76);
  g.globalAlpha = 1;
  // The rim: a band in the spine colour with the title around it.
  g.lineWidth = size * 0.11;
  g.strokeStyle = album.colour;
  g.beginPath();
  g.arc(r, r, r - g.lineWidth / 2, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = album.ink;
  g.font = `700 ${size * 0.045}px ${SANS}`;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  const text = `${album.artist.toUpperCase()}  ·  ${album.title.toUpperCase()}  ·  33⅓  ·  `;
  const ringR = r - size * 0.055;
  const step = Math.min(0.11, (Math.PI * 1.7) / Math.max(text.length, 1));
  let angle = -Math.PI / 2 - (step * text.length) / 2;
  for (const ch of text) {
    g.save();
    g.translate(r + Math.cos(angle) * ringR, r + Math.sin(angle) * ringR);
    g.rotate(angle + Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
    angle += step;
  }
  g.restore();
  return cv;
}
