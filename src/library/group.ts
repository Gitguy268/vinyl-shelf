import { baseName, dirName, pickCover } from './files';
import type { Album, ImageInfo, SortKey, TrackInfo } from './types';

/** Tags a file has none of, guessed from its name and folders: `Artist/Album/01 - Title.mp3`. */
export function guessFromPath(path: string): {
  title: string;
  artist: string;
  album: string;
  trackNo: number | null;
  discNo: number | null;
} {
  const name = baseName(path).replace(/\.[^.]+$/, '');
  const parts = path.split('/').slice(0, -1);
  let album = parts.at(-1) ?? '';
  let artist = parts.length >= 2 ? (parts.at(-2) ?? '') : '';
  let discNo: number | null = null;
  // "CD1", "Disc 2", "Disk 02": the album is one folder up.
  const disc = /^(?:cd|dis[ck])\s*0*(\d{1,2})$/i.exec(album);
  if (disc && parts.length >= 2) {
    discNo = Number(disc[1]);
    album = parts.at(-2) ?? '';
    artist = parts.length >= 3 ? (parts.at(-3) ?? '') : '';
  }
  // "Artist - Album (1959)" or "Artist - Album" as one folder name.
  const dashed = /^(.+?)\s+[-–—]\s+(.+)$/.exec(album);
  if (dashed && !artist) {
    artist = dashed[1]!;
    album = dashed[2]!;
  }
  album = album.replace(/\s*[[(]\d{4}[\])]\s*$/, '').trim();
  let title = name.replace(/_/g, ' ').trim();
  let trackNo: number | null = null;
  // "1-03 Title" (disc-track), "03 - Title", "03. Title", "03 Title"
  const dt = /^(\d{1,2})[-.](\d{1,3})[\s._-]+(.+)$/.exec(title);
  const t = /^(\d{1,3})(?:\s*[-.)]\s*|\s+)(.+)$/.exec(title);
  if (dt) {
    discNo ??= Number(dt[1]);
    trackNo = Number(dt[2]);
    title = dt[3]!;
  } else if (t && Number(t[1]) < 200) {
    trackNo = Number(t[1]);
    title = t[2]!;
  }
  // "Artist - Title" left in the file name.
  const at = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
  if (at && (!artist || at[1]!.toLowerCase() === artist.toLowerCase())) {
    artist ||= at[1]!;
    title = at[2]!;
  }
  return {
    title: title.trim() || name,
    artist: artist.trim(),
    album: album.trim(),
    trackNo,
    discNo,
  };
}

const LIGATURES: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  þ: 'th',
};

/** Lower case, no accents, no punctuation, no leading "The": the key two spellings share. */
export function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[æœßøłđþ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '');
}

/** Sort form of a name: "The Beatles" files under B. */
export function sortName(s: string): string {
  return normalise(s) || '\uffff';
}

/** A short stable id from a string (FNV-1a, base 36). */
export function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const VARIOUS = 'Various Artists';
const DISC_FOLDER = /^(?:cd|dis[ck])\s*0*\d{1,2}$/i;

/** The album's folder: a track in `Album/CD2/` belongs to `Album`. */
export function albumFolder(path: string): string {
  const dir = dirName(path);
  return DISC_FOLDER.test(baseName(dir)) ? dirName(dir) : dir;
}

function mostCommon<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function trackOrder(a: TrackInfo, b: TrackInfo): number {
  return (
    (a.discNo ?? 1) - (b.discNo ?? 1) ||
    (a.trackNo ?? 9999) - (b.trackNo ?? 9999) ||
    a.path.localeCompare(b.path, undefined, { numeric: true })
  );
}

/**
 * Groups tracks into albums. Tracks with an album tag group by album artist and album, so a
 * compilation spread over artists stays one record; without a tag they group by folder.
 */
export function groupAlbums(
  tracks: readonly TrackInfo[],
  images: readonly ImageInfo[] = [],
): Album[] {
  const groups = new Map<string, TrackInfo[]>();
  for (const track of tracks) {
    const folder = albumFolder(track.path);
    const key = track.album
      ? `a:${normalise(track.albumArtist || (track.compilation ? VARIOUS : '')) || '?'}|${normalise(track.album)}|${track.albumArtist || track.compilation ? '' : folder}`
      : `f:${folder}`;
    const list = groups.get(key);
    if (list) list.push(track);
    else groups.set(key, [track]);
  }
  // Without an album-artist tag, tracks group per folder (the key), and a folder of more than two
  // artists is called Various Artists.
  const albums: Album[] = [];
  for (const [key, list] of groups) {
    list.sort(trackOrder);
    const folder = mostCommon(list.map((t) => albumFolder(t.path))) ?? '';
    const guess = guessFromPath(list[0]!.path);
    const title = mostCommon(list.map((t) => t.album).filter(Boolean)) ?? guess.album ?? '';
    const albumArtists = list.map((t) => t.albumArtist).filter(Boolean);
    const artists = new Set(list.map((t) => normalise(t.artist)).filter(Boolean));
    const artist =
      mostCommon(albumArtists) ??
      (list.some((t) => t.compilation) || artists.size > 2
        ? VARIOUS
        : (mostCommon(list.map((t) => t.artist).filter(Boolean)) ?? guess.artist));
    const years = list.map((t) => t.year).filter((y): y is number => y !== null && y > 0);
    const durations = list.map((t) => t.durationSec ?? 0);
    albums.push({
      id: hashId(key),
      title: title || folder.split('/').at(-1) || 'Unknown album',
      artist: artist || 'Unknown artist',
      year: years.length > 0 ? Math.min(...years) : null,
      genre: mostCommon(list.map((t) => t.genre).filter(Boolean)) ?? '',
      tracks: list,
      folder,
      coverPath: pickCover(folder, images),
      pictureTrack: list.find((t) => t.picture)?.path ?? list[0]!.path,
      durationSec: durations.reduce((s, d) => s + d, 0),
      addedAt: Math.max(...list.map((t) => t.mtime)),
    });
  }
  return albums;
}

export function sortAlbums(albums: readonly Album[], key: SortKey): Album[] {
  const byArtist = (a: Album, b: Album): number =>
    sortName(a.artist).localeCompare(sortName(b.artist)) ||
    (a.year ?? 9999) - (b.year ?? 9999) ||
    sortName(a.title).localeCompare(sortName(b.title));
  const cmp: Record<SortKey, (a: Album, b: Album) => number> = {
    artist: byArtist,
    title: (a, b) => sortName(a.title).localeCompare(sortName(b.title)) || byArtist(a, b),
    year: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || byArtist(a, b),
    genre: (a, b) => sortName(a.genre).localeCompare(sortName(b.genre)) || byArtist(a, b),
    added: (a, b) => b.addedAt - a.addedAt || byArtist(a, b),
  };
  return [...albums].sort(cmp[key]);
}

/** The divider card an album files under for a sort: a letter, a decade, a genre. */
export function dividerOf(album: Album, key: SortKey): string {
  switch (key) {
    case 'artist':
    case 'title': {
      const c = sortName(key === 'artist' ? album.artist : album.title)
        .charAt(0)
        .toUpperCase();
      return /[A-Z]/.test(c) ? c : '#';
    }
    case 'year':
      return album.year ? `${Math.floor(album.year / 10) * 10}s` : '?';
    case 'genre':
      return album.genre || 'Other';
    case 'added':
      return '';
  }
}

/** Albums a search matches: every word must appear in the artist, title, genre, year or a track title. */
export function searchAlbums(albums: readonly Album[], query: string): Set<string> {
  const words = normalise(query).split(' ').filter(Boolean);
  const hits = new Set<string>();
  if (words.length === 0) return hits;
  for (const album of albums) {
    const hay = normalise(
      [
        album.artist,
        album.title,
        album.genre,
        album.year ?? '',
        ...album.tracks.map((t) => `${t.title} ${t.artist}`),
      ].join(' '),
    );
    if (words.every((w) => hay.includes(w))) hits.add(album.id);
  }
  return hits;
}

/** Splits a record into sides of at most `sideSec`: an LP side holds up to about 25 minutes. */
export function packSides(durations: readonly number[], sideSec = 25 * 60): [number, number][] {
  if (durations.length === 0) return [];
  const total = durations.reduce((s, d) => s + d, 0);
  const sides = Math.max(1, Math.ceil(total / sideSec));
  const target = total / sides;
  const out: [number, number][] = [];
  let start = 0;
  let acc = 0;
  for (let i = 0; i < durations.length; i++) {
    acc += durations[i]!;
    const remainingSides = sides - out.length - 1;
    const remainingTracks = durations.length - i - 1;
    if (
      remainingSides > 0 &&
      remainingTracks >= remainingSides &&
      acc >= target - durations[i]! / 2
    ) {
      out.push([start, i]);
      start = i + 1;
      acc = 0;
    }
  }
  out.push([start, durations.length - 1]);
  return out;
}
