import { describe, expect, it } from 'vitest';
import { isAudioPath, isImagePath, pickCover } from '../../src/library/files';
import {
  albumFolder,
  dividerOf,
  groupAlbums,
  guessFromPath,
  normalise,
  packSides,
  searchAlbums,
  sortAlbums,
} from '../../src/library/group';
import { relink } from '../../src/library/relink';
import type { TrackInfo } from '../../src/library/types';

function track(path: string, tags: Partial<TrackInfo> = {}): TrackInfo {
  return {
    path,
    size: 1000,
    mtime: 1_700_000_000_000,
    title: '',
    artist: '',
    albumArtist: '',
    album: '',
    trackNo: null,
    discNo: null,
    year: null,
    genre: '',
    durationSec: 200,
    compilation: false,
    picture: false,
    ...tags,
  };
}

describe('files', () => {
  it('knows music and covers, and skips hidden and AppleDouble files', () => {
    expect(isAudioPath('A/B/01 So What.FLAC')).toBe(true);
    expect(isAudioPath('A/B/._01 So What.flac')).toBe(false);
    expect(isAudioPath('.Trash/x.mp3')).toBe(false);
    expect(isAudioPath('A/B/notes.txt')).toBe(false);
    expect(isImagePath('A/B/cover.JPG')).toBe(true);
  });

  it('picks the cover by name, then the only loose image', () => {
    const imgs = [
      { path: 'A/B/back.jpg', size: 900 },
      { path: 'A/B/Folder.jpg', size: 100 },
      { path: 'A/B/Scans/front.jpg', size: 5000 },
    ];
    expect(pickCover('A/B', imgs)).toBe('A/B/Folder.jpg');
    expect(pickCover('A/B', [{ path: 'A/B/Kind of Blue.jpg', size: 10 }])).toBe(
      'A/B/Kind of Blue.jpg',
    );
    expect(pickCover('A/B', [{ path: 'A/B/Scans/front.jpg', size: 10 }])).toBe(
      'A/B/Scans/front.jpg',
    );
    expect(pickCover('A/B', [{ path: 'A/C/cover.jpg', size: 10 }])).toBeNull();
    expect(pickCover('A', [{ path: 'A/CD1/cover.jpg', size: 10 }])).toBe('A/CD1/cover.jpg');
  });
});

describe('guessFromPath', () => {
  it('reads artist, album and track from folders and names', () => {
    expect(guessFromPath('Miles Davis/Kind of Blue (1959)/01 - So What.mp3')).toMatchObject({
      artist: 'Miles Davis',
      album: 'Kind of Blue',
      trackNo: 1,
      title: 'So What',
    });
    expect(guessFromPath('Pink Floyd - The Wall/CD2/1-03 Hey You.flac')).toMatchObject({
      artist: 'Pink Floyd',
      album: 'The Wall',
      discNo: 2,
      trackNo: 3,
      title: 'Hey You',
    });
    expect(guessFromPath('loose/Daft Punk - One More Time.mp3')).toMatchObject({
      title: 'One More Time',
    });
    expect(guessFromPath('1999.mp3').title).toBe('1999');
  });
});

describe('groupAlbums', () => {
  it('groups by album artist and album, in disc and track order', () => {
    const albums = groupAlbums([
      track('Jazz/KoB/02.flac', {
        album: 'Kind of Blue',
        artist: 'Miles Davis',
        trackNo: 2,
        title: 'Freddie',
      }),
      track('Jazz/KoB/01.flac', {
        album: 'Kind of Blue',
        artist: 'Miles Davis',
        trackNo: 1,
        title: 'So What',
        year: 1959,
      }),
      track('Rock/Wall/CD2/01.flac', {
        album: 'The Wall',
        albumArtist: 'Pink Floyd',
        discNo: 2,
        trackNo: 1,
      }),
      track('Rock/Wall/CD1/01.flac', {
        album: 'The Wall',
        albumArtist: 'Pink Floyd',
        discNo: 1,
        trackNo: 1,
      }),
    ]);
    expect(albums).toHaveLength(2);
    const kob = albums.find((a) => a.title === 'Kind of Blue')!;
    expect(kob.artist).toBe('Miles Davis');
    expect(kob.year).toBe(1959);
    expect(kob.tracks.map((t) => t.title)).toEqual(['So What', 'Freddie']);
    const wall = albums.find((a) => a.title === 'The Wall')!;
    expect(wall.folder).toBe('Rock/Wall');
    expect(wall.tracks.map((t) => t.discNo)).toEqual([1, 2]);
  });

  it('keeps a compilation together and calls it Various Artists', () => {
    const albums = groupAlbums(
      ['A', 'B', 'C'].map((a, i) =>
        track(`Comp/0${i}.mp3`, { album: 'Now 1', artist: a, compilation: true }),
      ),
    );
    expect(albums).toHaveLength(1);
    expect(albums[0]!.artist).toBe('Various Artists');
  });

  it('does not merge two untagged-artist albums of the same name in different folders', () => {
    const albums = groupAlbums([
      track('X/Greatest Hits/01.mp3', { album: 'Greatest Hits', artist: 'X' }),
      track('Y/Greatest Hits/01.mp3', { album: 'Greatest Hits', artist: 'Y' }),
    ]);
    expect(albums).toHaveLength(2);
  });

  it('falls back to folders when there are no tags, and finds the cover', () => {
    const albums = groupAlbums(
      [
        track('Nina Simone/Pastel Blues/01 Be My Husband.mp3'),
        track('Nina Simone/Pastel Blues/02 Ooh Child.mp3'),
      ],
      [{ path: 'Nina Simone/Pastel Blues/cover.jpg', size: 1 }],
    );
    expect(albums).toHaveLength(1);
    expect(albums[0]).toMatchObject({
      title: 'Pastel Blues',
      artist: 'Nina Simone',
      coverPath: 'Nina Simone/Pastel Blues/cover.jpg',
    });
  });

  it('gives an album the same id on every scan', () => {
    const a = groupAlbums([track('A/B/1.mp3', { album: 'B', artist: 'A' })]);
    const b = groupAlbums([track('A/B/1.mp3', { album: 'B', artist: 'A', size: 5 })]);
    expect(a[0]!.id).toBe(b[0]!.id);
  });

  it('knows a disc folder', () => {
    expect(albumFolder('A/Wall/Disc 2/01.flac')).toBe('A/Wall');
    expect(albumFolder('A/Wall/01.flac')).toBe('A/Wall');
  });
});

describe('sorting, dividers and search', () => {
  const albums = groupAlbums([
    track('1/a.mp3', { album: 'Abbey Road', artist: 'The Beatles', year: 1969, genre: 'Rock' }),
    track('2/a.mp3', {
      album: 'Blue Train',
      artist: 'John Coltrane',
      year: 1957,
      genre: 'Jazz',
      title: 'Moment’s Notice',
    }),
    track('3/a.mp3', {
      album: 'Ágætis byrjun',
      artist: 'Sigur Rós',
      year: 1999,
      genre: 'Post-rock',
    }),
  ]);

  it('files "The Beatles" under B and sorts by year', () => {
    expect(sortAlbums(albums, 'artist').map((a) => a.artist)).toEqual([
      'The Beatles',
      'John Coltrane',
      'Sigur Rós',
    ]);
    expect(sortAlbums(albums, 'year').map((a) => a.year)).toEqual([1957, 1969, 1999]);
    expect(dividerOf(albums[0]!, 'artist')).toBe('B');
    expect(dividerOf(albums[0]!, 'year')).toBe('1960s');
  });

  it('matches words anywhere, without accents', () => {
    expect(normalise('Ágætis Byrjun!')).toBe('agaetis byrjun');
    const hit = (q: string): string[] =>
      [...searchAlbums(albums, q)].map((id) => albums.find((a) => a.id === id)!.title);
    expect(hit('sigur ros')).toEqual(['Ágætis byrjun']);
    expect(hit('coltrane notice')).toEqual(['Blue Train']);
    expect(hit('1969')).toEqual(['Abbey Road']);
    expect(hit('')).toEqual([]);
  });
});

describe('packSides', () => {
  it('cuts sides of up to 25 minutes, never an empty one', () => {
    expect(packSides([])).toEqual([]);
    expect(packSides([300, 300])).toEqual([[0, 1]]);
    const sides = packSides(Array(10).fill(270));
    expect(sides).toEqual([
      [0, 4],
      [5, 9],
    ]);
    for (const [a, b] of packSides([2000, 100, 100])) expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('relink', () => {
  const known = [
    { path: 'Jazz/KoB/01.flac', size: 10, mtime: 5000 },
    { path: 'Jazz/KoB/02.flac', size: 20, mtime: 5000 },
    { path: 'Rock/Wall/01.flac', size: 30, mtime: 5000 },
  ];

  it('keeps unchanged files and rereads changed ones', () => {
    const r = relink(known, [
      { path: 'Jazz/KoB/01.flac', size: 10, mtime: 6000, file: 'a' },
      { path: 'Jazz/KoB/02.flac', size: 21, mtime: 5000, file: 'b' },
      { path: 'Jazz/New/01.flac', size: 1, mtime: 1, file: 'c' },
    ]);
    expect(r.matched.map((m) => m.known)).toEqual(['Jazz/KoB/01.flac']);
    expect(r.fresh.map((f) => f.file)).toEqual(['b', 'c']);
    expect(r.missing).toEqual(['Rock/Wall/01.flac']);
  });

  it('copes with a parent or child folder being picked', () => {
    const up = relink(
      known,
      known.map((k) => ({ ...k, path: 'Music/' + k.path, file: k.path })),
    );
    expect(up.shift).toBe(1);
    expect(up.matched.map((m) => m.picked.path)).toEqual(known.map((k) => 'Music/' + k.path));
    const down = relink(
      known,
      known
        .filter((k) => k.path.startsWith('Jazz/'))
        .map((k) => ({ ...k, path: k.path.slice(5), file: k.path })),
    );
    expect(down.shift).toBe(-1);
    expect(down.matched).toHaveLength(2);
    expect(down.missing).toEqual(['Rock/Wall/01.flac']);
  });

  it('treats a different folder as new', () => {
    const r = relink(known, [{ path: 'Pop/x.mp3', size: 1, mtime: 1, file: 'x' }]);
    expect(r.matched).toHaveLength(0);
    expect(r.missing).toHaveLength(3);
  });
});
