import { guessFromPath } from './group';
import type { TrackInfo } from './types';

/** music-metadata loads on first use: a shelf from the cache never needs it. */
type MM = typeof import('music-metadata');
let mm: Promise<MM> | null = null;
const load = (): Promise<MM> => (mm ??= import('music-metadata'));

const TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\0/g, '').trim() : '');

/**
 * The tags of one file; whatever is missing comes from its path. A file that will not parse still
 * gets a track. Cover art is skipped here (memory): readPicture reads it for one track per album.
 */
export async function readTags(file: File, path: string): Promise<TrackInfo> {
  const guess = guessFromPath(path);
  const base: TrackInfo = {
    path,
    size: file.size,
    mtime: file.lastModified,
    title: guess.title,
    artist: guess.artist,
    albumArtist: '',
    album: guess.album,
    trackNo: guess.trackNo,
    discNo: guess.discNo,
    year: null,
    genre: '',
    durationSec: null,
    compilation: false,
    picture: false,
  };
  try {
    const { parseBlob } = await load();
    const meta = await withTimeout(
      parseBlob(file, { skipCovers: true, skipPostHeaders: true }),
      TIMEOUT_MS,
    );
    const c = meta.common;
    const year = c.year ?? (c.date ? Number.parseInt(c.date, 10) : NaN);
    return {
      ...base,
      title: clean(c.title) || base.title,
      artist: clean(c.artist) || clean(c.artists?.[0]) || base.artist,
      albumArtist: clean(c.albumartist),
      // An untagged album must not fall back to the folder guess here: group.ts does that per folder.
      album: clean(c.album),
      trackNo: c.track?.no ?? base.trackNo,
      discNo: c.disk?.no ?? base.discNo,
      year: Number.isFinite(year) && year > 0 ? year : null,
      genre: clean(c.genre?.[0]),
      durationSec:
        meta.format.duration && Number.isFinite(meta.format.duration) ? meta.format.duration : null,
      compilation: c.compilation === true,
    };
  } catch {
    return { ...base, album: '' };
  }
}

/** The cover art inside a file, if it has any. */
export async function readPicture(file: File): Promise<Blob | null> {
  try {
    const { parseBlob, selectCover } = await load();
    const meta = await withTimeout(parseBlob(file, { skipPostHeaders: true }), TIMEOUT_MS);
    const pic = selectCover(meta.common.picture);
    if (!pic) return null;
    const bytes = new Uint8Array(pic.data.byteLength);
    bytes.set(pic.data);
    return new Blob([bytes], { type: pic.format || 'image/jpeg' });
  } catch {
    return null;
  }
}

/** Runs `job` over `items` with at most `limit` at a time, reporting each one done. */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  job: (item: T) => Promise<R>,
  onDone?: (done: number, result: R) => void,
  signal?: AbortSignal,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !signal?.aborted) {
      const i = next++;
      out[i] = await job(items[i]!);
      onDone?.(++done, out[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
