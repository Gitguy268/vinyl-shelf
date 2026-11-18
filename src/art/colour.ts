/** Colour helpers: contrast, mixing, and the two colours a cover gives its spine. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number): string =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Black or cream ink, whichever reads better on `bg`. */
export function inkOn(bg: string): string {
  return contrast(bg, '#141210') >= contrast(bg, '#f4efe6') ? '#141210' : '#f4efe6';
}

function saturation([r, g, b]: RGB): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * The spine colours of a cover: its most common colour (vivid colours weigh a little more) and an
 * ink from the cover that reads on it, or black or cream.
 */
export function coverColours(pixels: Uint8ClampedArray): { colour: string; ink: string } {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const w = 1 + saturation([r, g, b]) * 1.5;
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n += w;
    bin.r += r * w;
    bin.g += g * w;
    bin.b += b * w;
    bins.set(key, bin);
  }
  const ranked = [...bins.values()].sort((a, b) => b.n - a.n);
  if (ranked.length === 0) return { colour: '#2a2622', ink: '#f4efe6' };
  const avg = (bin: { n: number; r: number; g: number; b: number }): string =>
    rgbToHex([bin.r / bin.n, bin.g / bin.n, bin.b / bin.n]);
  const colour = avg(ranked[0]!);
  const candidate = ranked
    .slice(1, 8)
    .map(avg)
    .find((c) => contrast(c, colour) >= 4.5);
  return { colour, ink: candidate ?? inkOn(colour) };
}

/** A small deterministic random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
