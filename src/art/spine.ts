import { mix, seedOf } from './colour';
import { SANS, SERIF, ellipsize } from './draw';

export interface SpineText {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  colour: string;
  ink: string;
}

/** A catalogue number every album keeps: "VS-4187". */
export function catalogue(id: string): string {
  return `VS-${(seedOf(id) % 9000) + 1000}`;
}

/**
 * Paints one spine into a tall, narrow cell (`w` across the spine, `h` along it). Text runs from
 * top to bottom, as on most LPs: artist, title, and the year and catalogue number at the far end.
 */
export function paintSpine(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  s: SpineText,
): void {
  const seed = seedOf(s.id);
  g.save();
  g.fillStyle = s.colour;
  g.fillRect(x, y, w, h);
  // Cardboard: slightly darker edges where the sleeve folds.
  const fold = g.createLinearGradient(x, 0, x + w, 0);
  fold.addColorStop(0, 'rgba(0,0,0,0.22)');
  fold.addColorStop(0.18, 'rgba(0,0,0,0)');
  fold.addColorStop(0.82, 'rgba(0,0,0,0)');
  fold.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = fold;
  g.fillRect(x, y, w, h);
  // Some spines carry a band of colour at the top.
  const band = seed % 3 === 0;
  if (band) {
    g.fillStyle = mix(s.ink, s.colour, 0.25);
    g.fillRect(x, y, w, h * 0.06);
  }
  g.translate(x + w / 2, y);
  g.rotate(Math.PI / 2);
  // Now +x runs down the spine and +y runs across it, from right to left of the cell.
  const px = Math.max(5, w * 0.5);
  const start = h * (band ? 0.085 : 0.04);
  const end = h * 0.96;
  g.textBaseline = 'middle';
  g.fillStyle = s.ink;
  g.textAlign = 'right';
  g.font = `500 ${px * 0.78}px ${SANS}`;
  const tail = s.year ? `${s.year}   ${catalogue(s.id)}` : catalogue(s.id);
  const tailW = g.measureText(tail).width;
  g.globalAlpha = 0.75;
  g.fillText(tail, end, 0);
  g.globalAlpha = 1;
  g.textAlign = 'left';
  const serif = seed % 4 === 1;
  const artistFont = serif ? `700 ${px}px ${SERIF}` : `750 ${px}px ${SANS}`;
  const titleFont = serif ? `italic 400 ${px}px ${SERIF}` : `400 ${px}px ${SANS}`;
  const room = end - start - tailW - px * 1.5;
  g.font = artistFont;
  const artist = ellipsize(g, s.artist.toUpperCase(), room * 0.6);
  const artistW = g.measureText(artist).width;
  g.fillText(artist, start, 0);
  g.font = titleFont;
  const title = ellipsize(g, s.title, room - artistW - px);
  g.globalAlpha = 0.9;
  g.fillText(title, start + artistW + px * 0.9, 0);
  g.restore();
}
