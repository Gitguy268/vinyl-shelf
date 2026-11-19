import { prefs } from '../library/store';

export interface PlayerInfo {
  id: string;
  name: string;
  /** One line on what it is like. */
  blurb: string;
  url: string;
  /** Colours of its little badge. */
  badge: [string, string];
}

/** The vinyl players that take an album from the shelf (vinyl-shelf/1). */
export const PLAYERS: PlayerInfo[] = [
  {
    id: 'realistic',
    name: 'Realistic',
    blurb: 'A turntable that looks, moves and sounds like a real deck.',
    url: 'https://gitguy268.github.io/realistic-vinyl-player/',
    badge: ['#e8562a', '#1a1a1e'],
  },
  {
    id: 'ultra',
    name: 'Ultra-Realistic',
    blurb: 'A 3D Thorens TD 115 MK II with a modelled motor, arm and RIAA chain.',
    url: 'https://gitguy268.github.io/ultra-realistic-vinyl-player/',
    badge: ['#c9ccd1', '#2a2d33'],
  },
  {
    id: '8-bit-vinyl',
    name: '8-bit Vinyl',
    blurb: 'Pixel art in NES, Game Boy or C64 colours.',
    url: 'https://gitguy268.github.io/8-bit-vinyl-player/',
    badge: ['#9bbc0f', '#0f380f'],
  },
  {
    id: 'vinyl-player',
    name: 'Vinyl Player',
    blurb: 'The original: a spinning record, a tonearm and visualizers.',
    url: 'https://gitguy268.github.io/Vinyl-Player/',
    badge: ['#f2c14e', '#3a2a12'],
  },
  {
    id: '8bit-turntable',
    name: '8-bit Turntable',
    blurb: 'A chunky pixel record player.',
    url: 'https://gitguy268.github.io/8bit-player/vinyl-8bit.html',
    badge: ['#ff0044', '#0f0f1b'],
  },
  {
    id: '8bit-stage',
    name: 'Chiptune Stage',
    blurb: 'An 8-bit stage with a pixel visualizer.',
    url: 'https://gitguy268.github.io/8bit-player/',
    badge: ['#00e5ff', '#0f0f1b'],
  },
];

export const CUSTOM_ID = 'custom';

/** A player URL the listener typed: their own copy, or one served on this computer. */
export function customPlayer(): PlayerInfo | null {
  const url = prefs.get<string>('customPlayer', '');
  if (!url) return null;
  return { id: CUSTOM_ID, name: 'My player', blurb: url, url, badge: ['#8a7f72', '#211d19'] };
}

export function allPlayers(): PlayerInfo[] {
  const custom = customPlayer();
  return custom ? [...PLAYERS, custom] : PLAYERS;
}

export function chosenPlayer(): PlayerInfo {
  const id = prefs.get<string>('player', 'realistic');
  return allPlayers().find((p) => p.id === id) ?? PLAYERS[0]!;
}

/** Accepts only http(s) addresses, and file: ones when the shelf itself is a file. */
export function validPlayerUrl(text: string): string | null {
  try {
    const u = new URL(text.trim());
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    if (u.protocol === 'file:' && location.protocol === 'file:') return u.href;
  } catch {
    // not a URL
  }
  return null;
}
