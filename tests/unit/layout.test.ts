import { describe, expect, it } from 'vitest';
import { demoAlbums } from '../../src/library/demo';
import { sortAlbums } from '../../src/library/group';
import type { Album } from '../../src/library/types';
import { DIM, layoutShelf, shelfSize, thicknessOf } from '../../src/scene/layout';

function many(n: number): Album[] {
  const base = demoAlbums();
  return Array.from({ length: n }, (_, i) => ({
    ...base[i % base.length]!,
    id: `a${i}`,
    artist: `Artist ${String(i).padStart(4, '0')}`,
  }));
}

/** Corners of a slot's sleeve, in the xy plane. */
function corners(s: { x: number; y: number; lean: number; thickness: number }): [number, number][] {
  const c = Math.cos(s.lean);
  const n = Math.sin(s.lean);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    const dx = (u! * s.thickness) / 2;
    const dy = (v! * DIM.sleeve) / 2;
    return [s.x + dx * c - dy * n, s.y + dx * n + dy * c];
  });
}

describe('layoutShelf', () => {
  for (const n of [1, 30, 300, 2000]) {
    it(`places every one of ${n} albums inside its cube`, () => {
      const albums = sortAlbums(many(n), 'artist');
      const layout = layoutShelf(albums, 'artist');
      expect(layout.slotOf.every((i) => i >= 0)).toBe(true);
      expect(new Set(layout.slotOf).size).toBe(n);
      for (const slot of layout.slots) {
        const cube = layout.cubes[slot.cube]!;
        for (const [x, y] of corners(slot)) {
          expect(x).toBeGreaterThanOrEqual(cube.x - 1e-6);
          expect(x).toBeLessThanOrEqual(cube.x + DIM.cube + 1e-6);
          expect(y).toBeGreaterThanOrEqual(cube.y - 1e-6);
          expect(y).toBeLessThanOrEqual(cube.y + DIM.cube + 1e-6);
        }
      }
    });
  }

  it('grows the shelf with the library and keeps a spare cube on a small one', () => {
    expect(shelfSize(1)).toEqual({ rows: 2, cols: 2 });
    expect(shelfSize(5)).toEqual({ rows: 2, cols: 3 });
    expect(shelfSize(30)).toEqual({ rows: 4, cols: 8 });
    const small = layoutShelf(sortAlbums(many(30), 'artist'), 'artist');
    expect(small.spare.length).toBeGreaterThan(0);
    const big = layoutShelf(sortAlbums(many(2000), 'artist'), 'artist');
    expect(big.rows).toBe(4);
    expect(big.cols).toBeGreaterThanOrEqual(6);
  });

  it('puts a divider card before each new letter', () => {
    const albums = sortAlbums(demoAlbums(), 'artist');
    const layout = layoutShelf(albums, 'artist');
    const labels = layout.slots.filter((s) => s.album < 0).map((s) => s.label);
    expect(labels).toEqual([...new Set(labels)]);
    expect(labels[0]).toBe('A');
  });

  it('makes double albums thicker', () => {
    const single = { ...demoAlbums()[0]!, durationSec: 40 * 60 };
    const double = { ...single, durationSec: 80 * 60 };
    expect(thicknessOf(double)).toBeGreaterThan(thicknessOf(single) * 1.5);
  });
});
