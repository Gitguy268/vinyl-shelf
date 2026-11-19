import { rng, seedOf } from '../art/colour';
import { dividerOf } from '../library/group';
import type { Album, SortKey } from '../library/types';

/**
 * Where everything stands on the shelf, in metres. The shelf is a cube unit (oak, like the
 * common 4 × 4 kind): x runs along it, y up, z out of the wall towards you. Records stand on
 * edge with their spines towards you.
 */
export const DIM = {
  /** Inside of one cube. */
  cube: 0.335,
  /** Outer frame and inner boards. */
  frame: 0.039,
  board: 0.016,
  depth: 0.39,
  /** An LP sleeve. */
  sleeve: 0.315,
  /** Space kept free in a cube so the last record can be pulled out. */
  slack: 0.012,
  /** Height of the plinth under the bottom row. */
  foot: 0.0,
};

export interface Slot {
  /** Index into the albums, or -1 for a divider card. */
  album: number;
  /** The divider's text. */
  label: string;
  /** Centre of the sleeve. */
  x: number;
  y: number;
  z: number;
  /** Lean about the z axis, radians (negative leans to the right). */
  lean: number;
  /** A small turn about y, so a row does not look machine-made. */
  yaw: number;
  thickness: number;
  cube: number;
}

export interface ShelfLayout {
  rows: number;
  cols: number;
  width: number;
  height: number;
  slots: Slot[];
  /** Left edge (x) and bottom (y) of each cube's inside. */
  cubes: { x: number; y: number }[];
  /** Index of the first slot of each album, by album index. */
  slotOf: number[];
}

/** How thick a record's sleeve is: a single LP, or a gatefold of two or three. */
export function thicknessOf(album: Album): number {
  const minutes = album.durationSec / 60;
  const discs =
    minutes > 105 || album.tracks.length > 30
      ? 3
      : minutes > 52 || album.tracks.length > 15
        ? 2
        : 1;
  const jitter = (seedOf(album.id) % 100) / 100;
  return [0.0034, 0.0062, 0.009][discs - 1]! + jitter * 0.0006;
}

const DIVIDER = 0.0016;

/** Records per cube the shelf aims for: full enough to look loved, loose enough to lean. */
export const PER_CUBE = 52;

export function shelfSize(count: number): { rows: number; cols: number } {
  const cubes = Math.max(4, Math.ceil(count / PER_CUBE));
  const rows = cubes <= 4 ? 2 : 4;
  return { rows, cols: Math.max(2, Math.ceil(cubes / rows)) };
}

/**
 * Fills the cubes column by column, top row first (the way people fill a shelf at eye level),
 * left to right inside a cube. A cube that is not full leans its records to the right.
 */
export function layoutShelf(albums: readonly Album[], sort: SortKey, dividers = true): ShelfLayout {
  const items: { album: number; label: string; t: number }[] = [];
  let last = '';
  albums.forEach((album, i) => {
    const d = dividers ? dividerOf(album, sort) : '';
    if (d && d !== last) items.push({ album: -1, label: d, t: DIVIDER });
    last = d;
    items.push({ album: i, label: '', t: thicknessOf(album) });
  });
  const total = items.reduce((s, it) => s + it.t, 0);
  const size = shelfSize(albums.length);
  const room = DIM.cube - DIM.slack;
  // Cut the run of items into cubes, spread evenly so the last ones are not left empty. When a
  // full library needs more cubes than planned (thick box sets), the shelf gets another column.
  let cols = size.cols;
  const rows = size.rows;
  let groups: (typeof items)[];
  for (;;) {
    const nCubes = rows * cols;
    const perCube = Math.min(room, Math.max(total / nCubes, room * 0.35));
    groups = [];
    let cur: typeof items = [];
    let fill = 0;
    for (const it of items) {
      const full = fill + it.t > room || (fill >= perCube && groups.length < nCubes - 1);
      if (full && cur.length > 0) {
        groups.push(cur);
        cur = [];
        fill = 0;
      }
      cur.push(it);
      fill += it.t;
    }
    if (cur.length > 0) groups.push(cur);
    if (groups.length <= nCubes) break;
    cols++;
  }
  const width = cols * DIM.cube + (cols - 1) * DIM.board + 2 * DIM.frame;
  const height = rows * DIM.cube + (rows - 1) * DIM.board + 2 * DIM.frame + DIM.foot;
  const cubes: { x: number; y: number }[] = [];
  for (let c = 0; c < cols; c++)
    for (let r = rows - 1; r >= 0; r--)
      cubes.push({
        x: -width / 2 + DIM.frame + c * (DIM.cube + DIM.board),
        y: DIM.foot + DIM.frame + r * (DIM.cube + DIM.board),
      });
  const slots: Slot[] = [];
  const slotOf: number[] = new Array(albums.length).fill(-1);
  groups.forEach((group, g) => {
    const cube = cubes[Math.min(g, cubes.length - 1)]!;
    const T = group.reduce((s, it) => s + it.t, 0);
    const free = Math.max(0, DIM.cube - T - 0.002);
    // Lean: the tops slide right until the free space is used, never more than about 24 degrees.
    const h = DIM.sleeve;
    // The widest point is the last record's top corner: T / cos(a) + h sin(a) must fit the cube.
    const span = (a: number): number => 0.001 + T / Math.cos(a) + h * Math.sin(a);
    let lo = 0;
    let hi = free > 0.004 ? Math.min(Math.asin(Math.min(1, free / h)), 0.42) : 0;
    for (let i = 0; i < 24 && span(hi) > DIM.cube - 0.001; i++) {
      const mid = (lo + hi) / 2;
      if (span(mid) > DIM.cube - 0.001) hi = mid;
      else lo = mid;
    }
    const lean = -(span(hi) > DIM.cube - 0.001 ? lo : hi);
    const cos = Math.cos(lean);
    const sin = Math.sin(lean);
    // A record tipping right rests on its bottom-right corner; the corners step by t / cos(lean).
    let xr = cube.x + 0.001;
    const rand = rng(seedOf(`${g}:${group[0]?.album ?? 0}`));
    for (const it of group) {
      xr += it.t / cos;
      const cx = xr - (it.t / 2) * cos - (h / 2) * sin;
      const cy = cube.y - (it.t / 2) * sin + (h / 2) * cos;
      const slot: Slot = {
        album: it.album,
        label: it.label,
        x: cx,
        y: cy,
        z:
          -DIM.depth / 2 + DIM.sleeve / 2 + 0.03 + (it.album < 0 ? -0.004 : (rand() - 0.5) * 0.008),
        lean,
        yaw: it.album < 0 ? 0 : (rand() - 0.5) * 0.012,
        thickness: it.t,
        cube: Math.min(g, cubes.length - 1),
      };
      if (it.album >= 0) slotOf[it.album] = slots.length;
      slots.push(slot);
    }
  });
  return { rows, cols, width, height, slots, cubes, slotOf };
}
