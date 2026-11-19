import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { rng } from '../art/colour';
import { canvas, ctx2d } from '../art/draw';

/** Textures painted on canvases at start-up: nothing is downloaded. */

function value2(seed: number): (x: number, y: number) => number {
  const rand = rng(seed);
  const N = 256;
  const grid = new Float32Array(N * N).map(() => rand());
  const at = (x: number, y: number): number => grid[((y & (N - 1)) << 8) | (x & (N - 1))]!;
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f);
    f *= 2;
    amp *= 0.5;
  }
  return sum;
}

function texture(c: HTMLCanvasElement, repeat: boolean, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  return t;
}

type Shade = [number, number, number];

/**
 * Wood grain along x: long rings warped by noise, with pores. `light` and `dark` are the
 * earlywood and latewood colours.
 */
export function woodCanvas(
  w: number,
  h: number,
  light: Shade,
  dark: Shade,
  seed: number,
  rings = 18,
): HTMLCanvasElement {
  const c = canvas(w, h);
  const g = ctx2d(c);
  const img = g.createImageData(w, h);
  const n = value2(seed);
  const pores = rng(seed + 1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const warp = fbm(n, u * 3, v * 12) * 2.2;
      const ring = Math.sin((v * rings + warp) * Math.PI * 2) * 0.5 + 0.5;
      const late = Math.pow(ring, 3);
      const streak = fbm(n, u * 40, v * 2 + 50, 3) * 0.25;
      let t = Math.min(1, late * 0.75 + streak);
      if (pores() < 0.012) t = Math.min(1, t + 0.35);
      const i = (y * w + x) * 4;
      img.data[i] = light[0] + (dark[0] - light[0]) * t;
      img.data[i + 1] = light[1] + (dark[1] - light[1]) * t;
      img.data[i + 2] = light[2] + (dark[2] - light[2]) * t;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

export function oak(seed = 7): CanvasTexture {
  return texture(woodCanvas(1024, 256, [196, 158, 112], [150, 108, 66], seed, 9), true);
}

export function walnut(seed = 11): CanvasTexture {
  return texture(woodCanvas(512, 128, [104, 70, 46], [52, 32, 20], seed, 12), true);
}

/** Floorboards: planks of oak with seams and a few knots, as one tile. */
export function floorboards(): { map: CanvasTexture; bump: CanvasTexture } {
  const W = 2048;
  const H = 2048;
  const c = canvas(W, H);
  const g = ctx2d(c);
  const bump = canvas(W, H);
  const bg = ctx2d(bump);
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, W, H);
  const planks = 8;
  const ph = H / planks;
  const rand = rng(3);
  for (let p = 0; p < planks; p++) {
    const tone = 0.85 + rand() * 0.3;
    const plank = woodCanvas(
      1024,
      128,
      [Math.min(255, 182 * tone), 140 * tone, 96 * tone],
      [128 * tone, 88 * tone, 54 * tone],
      100 + p,
      6,
    );
    const offset = rand() * W;
    for (const dx of [-offset, W - offset]) g.drawImage(plank, dx, p * ph, W, ph);
    // seams: the long one, and a butt joint
    bg.fillStyle = '#202020';
    bg.fillRect(0, p * ph, W, 3);
    const joint = (offset + W * 0.55) % W;
    bg.fillRect(joint, p * ph, 3, ph);
    g.fillStyle = 'rgba(40,25,12,0.65)';
    g.fillRect(0, p * ph, W, 2);
    g.fillRect(joint, p * ph, 2, ph);
  }
  return { map: texture(c, true), bump: texture(bump, true, false) };
}

/** Lime plaster: soft unevenness for the wall's colour and bump. */
export function plaster(base: Shade): { map: CanvasTexture; bump: CanvasTexture } {
  const S = 512;
  const c = canvas(S, S);
  const b = canvas(S, S);
  const g = ctx2d(c);
  const gb = ctx2d(b);
  const img = g.createImageData(S, S);
  const bimg = gb.createImageData(S, S);
  const n = value2(21);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // Tileable: sample a torus of noise.
      const u = x / S;
      const v = y / S;
      const s =
        fbm(n, u * 16, v * 16, 5) * (1 - u) * (1 - v) +
        fbm(n, (u - 1) * 16 + 256, v * 16, 5) * u * (1 - v) +
        fbm(n, u * 16, (v - 1) * 16 + 256, 5) * (1 - u) * v +
        fbm(n, (u - 1) * 16 + 256, (v - 1) * 16 + 256, 5) * u * v;
      const i = (y * S + x) * 4;
      const k = 0.94 + s * 0.12;
      img.data[i] = base[0] * k;
      img.data[i + 1] = base[1] * k;
      img.data[i + 2] = base[2] * k;
      img.data[i + 3] = 255;
      const bv = 100 + s * 80;
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = bv;
      bimg.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  gb.putImageData(bimg, 0, 0);
  return { map: texture(c, true), bump: texture(b, true, false) };
}

/** A record's face: fine grooves, the lead-in and the run-out, and the label painted in the middle. */
export function recordFace(label: HTMLCanvasElement | null, labelColour: string): CanvasTexture {
  const S = 1024;
  const c = canvas(S, S);
  const g = ctx2d(c);
  const r = S / 2;
  g.fillStyle = '#0b0b0c';
  g.fillRect(0, 0, S, S);
  const rand = rng(5);
  // Grooves between 0.39 and 0.97 of the radius; gaps between tracks show as slightly shinier rings.
  for (let k = 0; k < 900; k++) {
    const rr = r * (0.39 + (k / 900) * 0.58);
    const shade = 14 + Math.floor(rand() * 10);
    g.strokeStyle = `rgb(${shade},${shade},${shade + 1})`;
    g.lineWidth = 0.6;
    g.beginPath();
    g.arc(r, r, rr, 0, Math.PI * 2);
    g.stroke();
  }
  for (const gap of [0.48, 0.57, 0.66, 0.76, 0.86]) {
    g.strokeStyle = 'rgba(70,70,74,0.8)';
    g.lineWidth = 2.2;
    g.beginPath();
    g.arc(r, r, r * gap, 0, Math.PI * 2);
    g.stroke();
  }
  // Label: a third of the record, as on an LP (100 mm of 302 mm).
  const lr = r * 0.331;
  g.save();
  g.beginPath();
  g.arc(r, r, lr, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = labelColour;
  g.fillRect(r - lr, r - lr, lr * 2, lr * 2);
  if (label) g.drawImage(label, r - lr, r - lr, lr * 2, lr * 2);
  g.restore();
  // Spindle hole.
  g.fillStyle = '#050505';
  g.beginPath();
  g.arc(r, r, S * 0.012, 0, Math.PI * 2);
  g.fill();
  return texture(c, false);
}

export function disposeAll(textures: readonly (Texture | null | undefined)[]): void {
  for (const t of textures) t?.dispose();
}
