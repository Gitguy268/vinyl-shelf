import { rng, seedOf } from '../art/colour';
import { groupAlbums } from './group';
import type { Album, TrackInfo } from './types';

/**
 * The demo shelf: thirty made-up records (every name is invented) whose tracks are short tunes
 * synthesized on the spot when one is played. Nothing is fetched and nothing is stored.
 */
const RECORDS: [artist: string, title: string, year: number, genre: string][] = [
  ['Marigold Static', 'Low Tide Lanterns', 1978, 'Folk'],
  ['The Velvet Antennas', 'Slow Orbit', 1969, 'Psychedelic'],
  ['Oona Briar', 'Paper Weather', 2004, 'Singer-songwriter'],
  ['Harbor Ghost Orchestra', 'Night Ferry', 1959, 'Jazz'],
  ['Dmitri Kessel Trio', 'Blue Hour Sessions', 1962, 'Jazz'],
  ['Neon Cartography', 'Sunset Grid', 1985, 'Synth-pop'],
  ['Fern & Flint', 'Kitchen Radio', 1973, 'Soul'],
  ['Glass Pelican', 'Tremolo Bay', 1997, 'Indie'],
  ['Ada Okonkwo', 'After the Rain', 1976, 'Afrobeat'],
  ['The Small Hours', 'Cassette Summer', 2011, 'Indie pop'],
  ['Basalt', 'Iron Meadow', 1971, 'Rock'],
  ['Lumen Ward', 'Quiet Machines', 2019, 'Electronic'],
  ['Celeste Moreau', 'Rue des Lilas', 1966, 'Chanson'],
  ['Southpaw Social Club', 'Saturday Supply', 1979, 'Funk'],
  ['Juniper Ash', 'Wild Honey Hollow', 1988, 'Country'],
  ['Hikaru Arata', 'Harbour Lights Drive', 1981, 'City pop'],
  ['Mirror Lake Choir', 'Hymns for the Radio', 1957, 'Gospel'],
  ['Static Bloom', 'Overexposed', 1994, 'Shoegaze'],
  ['Ravi Sund & the Monsoons', 'Ghats', 1970, 'Raga rock'],
  ['Pale Atlas', 'Weather Stations', 2015, 'Ambient'],
  ['The Copper Kites', 'High Wire', 1964, 'Beat'],
  ['Mona Vega', 'Disco Telegraph', 1977, 'Disco'],
  ['Northbound Freight', 'Rail Songs', 1955, 'Blues'],
  ['Isla Fenwick', 'Small Rooms', 2008, 'Folk'],
  ['Concrete Gardens', 'Brutal Spring', 1983, 'Post-punk'],
  ['Solenne Arc', 'Cathedral Tape', 2021, 'Electronic'],
  ['Bossa Nuvem', 'Café Atlântico', 1963, 'Bossa nova'],
  ['Tin Lantern Brass Band', 'Second Line Sunday', 1999, 'Brass'],
  ['Various Artists', 'Late Night Radio, Vol. 2', 1990, 'Compilation'],
  ['Holloway Strings', 'Autumn Études', 1960, 'Classical'],
];

const WORDS_A = [
  'Lantern',
  'Harbour',
  'Velvet',
  'Paper',
  'Silver',
  'Winter',
  'Golden',
  'Midnight',
  'Copper',
  'Quiet',
  'Neon',
  'Salt',
  'Amber',
  'Glass',
  'Hollow',
  'Electric',
  'Wild',
  'Slow',
  'Blue',
  'Northern',
];
const WORDS_B = [
  'Light',
  'Waltz',
  'Motel',
  'Signal',
  'Avenue',
  'Garden',
  'Engine',
  'River',
  'Static',
  'Tide',
  'Radio',
  'Letters',
  'Weather',
  'Parade',
  'Orchard',
  'Telephone',
  'Horizon',
  'Ballroom',
  'Window',
  'Ferry',
];
const FORMS = [
  '{a} {b}',
  'The {b}',
  '{b} in {a}',
  '{a} {b} (Reprise)',
  'A {a} {b}',
  '{b} Song',
  'Last {b}',
  '{a}',
];

export const DEMO_PREFIX = 'demo/';

/** BPM and root note per genre: the synth plays something in the right mood. */
export function moodOf(genre: string): { bpm: number; root: number; swing: boolean } {
  const g = genre.toLowerCase();
  if (/jazz|blues|bossa|soul|gospel|chanson/.test(g)) return { bpm: 92, root: 110, swing: true };
  if (/disco|funk|afro|synth|electronic|city/.test(g)) return { bpm: 118, root: 98, swing: false };
  if (/ambient|classical|folk|singer|country/.test(g))
    return { bpm: 76, root: 130.8, swing: false };
  return { bpm: 104, root: 116.5, swing: false };
}

export function demoTracks(): TrackInfo[] {
  const out: TrackInfo[] = [];
  RECORDS.forEach(([artist, album, year, genre], i) => {
    const rand = rng(seedOf(album));
    const count = 5 + Math.floor(rand() * 5);
    const folder = `${DEMO_PREFIX}${artist}/${album}`;
    const various = artist === 'Various Artists';
    for (let n = 1; n <= count; n++) {
      const form = FORMS[Math.floor(rand() * FORMS.length)]!;
      const title = form
        .replace('{a}', WORDS_A[Math.floor(rand() * WORDS_A.length)]!)
        .replace('{b}', WORDS_B[Math.floor(rand() * WORDS_B.length)]!);
      const seconds = 28 + Math.floor(rand() * 30);
      out.push({
        path: `${folder}/${String(n).padStart(2, '0')} ${title}.wav`,
        size: seconds * 22050 * 2 + 44,
        mtime: Date.UTC(2026, 0, 1) + i * 86_400_000,
        title,
        artist: various ? RECORDS[(i + n * 7) % RECORDS.length]![0] : artist,
        albumArtist: artist,
        album,
        trackNo: n,
        discNo: 1,
        year,
        genre,
        durationSec: seconds,
        compilation: various,
        picture: false,
      });
    }
  });
  return out;
}

export function demoAlbums(): Album[] {
  return groupAlbums(demoTracks());
}

/** One demo track as a WAV file: kick, bass, an arpeggio and hats in the album's mood. */
export function demoFile(track: TrackInfo): File {
  const sr = 22050;
  const seconds = track.durationSec ?? 30;
  const n = Math.floor(seconds * sr);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, n * 2, true);
  const mood = moodOf(track.genre);
  const rand = rng(seedOf(track.path));
  const bpm = mood.bpm * (0.92 + rand() * 0.16);
  const root = mood.root * 2 ** (Math.floor(rand() * 5) / 12);
  const beat = 60 / bpm;
  const scale = [0, 3, 5, 7, 10, 12, 15, 17];
  const prog = [
    [0, 0, 5, 3],
    [0, 5, 3, 4],
    [0, 3, 5, 7],
  ][Math.floor(rand() * 3)]!;
  const hz = (s: number): number => root * 2 ** (s / 12);
  const TAU = Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let b = t / beat;
    if (mood.swing) b += 0.08 * Math.sin(b * Math.PI);
    const bar = Math.floor(b / 4);
    const tb = (b % 1) * beat;
    const chord = prog[bar % prog.length]!;
    const step = Math.floor(b * 2);
    const ts = (((b * 2) % 1) * beat) / 2;
    const fade = Math.min(1, t / 0.6, (seconds - t) / 1.5);
    const kick =
      Math.sin(TAU * (48 * tb + (60 * (1 - Math.exp(-tb * 30))) / 30)) * Math.exp(-tb * 9) * 0.5;
    const bass = Math.sin(TAU * hz(chord - 12) * t) * 0.2 * (0.6 + 0.4 * Math.exp(-tb * 4));
    const note = hz(chord + scale[(step * 3 + bar) % scale.length]!);
    const arp =
      (Math.sin(TAU * note * t) + 0.3 * Math.sin(TAU * note * 2 * t)) * Math.exp(-ts * 6) * 0.18;
    const hat = (rand() * 2 - 1) * Math.exp(-(((b * 2 + 1) % 2) * beat) * 30) * 0.06;
    const x = (kick + bass + arp + hat) * fade;
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 28000, true);
  }
  const name = track.path.slice(track.path.lastIndexOf('/') + 1);
  return new File([new Uint8Array(buf)], name, { type: 'audio/wav', lastModified: track.mtime });
}
