/** Canvas helpers shared by the covers, spines, labels and back covers. */

export const SANS =
  '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return g;
}

/** The largest font size (down to `min`) at which `text` fits `maxW`. */
export function fitFont(
  g: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxSize: number,
  font: (px: number) => string,
  min = 6,
): number {
  let px = maxSize;
  g.font = font(px);
  const w = g.measureText(text).width;
  if (w > maxW) px = Math.max(min, Math.floor((px * maxW) / w));
  g.font = font(px);
  return px;
}

/** Cuts `text` with an ellipsis so it fits `maxW` in the current font. */
export function ellipsize(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

/** Word-wraps `text` into at most `maxLines` lines of `maxW`. */
export function wrap(
  g: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width <= maxW || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(g, lines.slice(maxLines - 1).join(' '), maxW);
    return kept;
  }
  return lines.map((l) => ellipsize(g, l, maxW));
}

/** Fine print-like grain over the whole canvas. */
export function grain(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
  rand: () => number,
): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);
}

/** Draws `img` to fill a square, cropping the longer side. */
export function drawCover(
  g: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  size: number,
): void {
  const s = Math.min(img.width, img.height);
  g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, x, y, size, size);
}

export function toBlob(c: HTMLCanvasElement, type = 'image/jpeg', quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality),
  );
}
