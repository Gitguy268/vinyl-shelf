import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ImageInfo, TrackInfo } from './types';

/** A cover as the shelf keeps it: a small square picture and the colours of its spine. */
export interface CoverRecord {
  blob: Blob;
  /** Spine background and ink, picked from the picture. */
  colour: string;
  ink: string;
  source: 'file' | 'tag' | 'made';
  /** A made cover for which the folder was searched and had nothing. */
  checked?: boolean;
}

interface ShelfDB extends DBSchema {
  tracks: { key: string; value: TrackInfo };
  images: { key: string; value: ImageInfo };
  covers: { key: string; value: CoverRecord };
  meta: { key: string; value: unknown };
}

/**
 * The index of the music folder, in IndexedDB `vinyl-shelf`. Only what the shelf needs to draw
 * itself is kept: tags, sizes and small covers. The music stays in the folder.
 */
export class Store {
  private db: Promise<IDBPDatabase<ShelfDB> | null>;

  constructor(name = 'vinyl-shelf') {
    this.db = openDB<ShelfDB>(name, 1, {
      upgrade(db) {
        db.createObjectStore('tracks', { keyPath: 'path' });
        db.createObjectStore('images', { keyPath: 'path' });
        db.createObjectStore('covers');
        db.createObjectStore('meta');
      },
    }).catch(() => null); // private windows and some file:// pages have no IndexedDB: the shelf still works
  }

  async available(): Promise<boolean> {
    return (await this.db) !== null;
  }

  async load(): Promise<{ tracks: TrackInfo[]; images: ImageInfo[] }> {
    const db = await this.db;
    if (!db) return { tracks: [], images: [] };
    const [tracks, images] = await Promise.all([db.getAll('tracks'), db.getAll('images')]);
    return { tracks, images };
  }

  /** Replaces the index with a new scan's tracks and images (removed files go). */
  async saveIndex(tracks: readonly TrackInfo[], images: readonly ImageInfo[]): Promise<void> {
    const db = await this.db;
    if (!db) return;
    const tx = db.transaction(['tracks', 'images'], 'readwrite');
    await Promise.all([tx.objectStore('tracks').clear(), tx.objectStore('images').clear()]);
    for (const t of tracks) void tx.objectStore('tracks').put(t);
    for (const i of images) void tx.objectStore('images').put(i);
    await tx.done;
  }

  async cover(id: string): Promise<CoverRecord | undefined> {
    const db = await this.db;
    return db ? db.get('covers', id).catch(() => undefined) : undefined;
  }

  async saveCover(id: string, cover: CoverRecord): Promise<void> {
    const db = await this.db;
    await db?.put('covers', cover, id).catch(() => undefined);
  }

  async coverIds(): Promise<string[]> {
    const db = await this.db;
    return db ? db.getAllKeys('covers') : [];
  }

  async dropCovers(ids: readonly string[]): Promise<void> {
    const db = await this.db;
    if (!db || ids.length === 0) return;
    const tx = db.transaction('covers', 'readwrite');
    for (const id of ids) void tx.store.delete(id);
    await tx.done;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.db;
    return db ? ((await db.get('meta', key).catch(() => undefined)) as T | undefined) : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const db = await this.db;
    await db?.put('meta', value, key).catch(() => undefined);
  }

  /** Forget the folder: index, covers and the folder handle. */
  async clear(): Promise<void> {
    const db = await this.db;
    if (!db) return;
    const tx = db.transaction(['tracks', 'images', 'covers', 'meta'], 'readwrite');
    await Promise.all(
      ['tracks', 'images', 'covers', 'meta'].map((s) => tx.objectStore(s as 'meta').clear()),
    );
    await tx.done;
  }
}

/** Small preferences in localStorage, all under `vinyl-shelf.` (file:// pages share one localStorage). */
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`vinyl-shelf.${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`vinyl-shelf.${key}`, JSON.stringify(value));
    } catch {
      // Storage may be off; the setting lasts for this visit.
    }
  },
};
