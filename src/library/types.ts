/** One audio file in the music folder, as the index remembers it. */
export interface TrackInfo {
  /** Path inside the chosen folder, with `/` separators, e.g. `Miles Davis/Kind of Blue/01 So What.flac`. */
  path: string;
  size: number;
  /** `File.lastModified` in ms. */
  mtime: number;
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string;
  durationSec: number | null;
  compilation: boolean;
  /** The file is known to carry cover art (set once a picture was read from it). */
  picture: boolean;
}

/** An image file that may be an album cover. */
export interface ImageInfo {
  path: string;
  size: number;
}

/** A record on the shelf: tracks grouped under one album. */
export interface Album {
  /** Stable across rescans: derived from album artist and title, or from the folder. */
  id: string;
  title: string;
  artist: string;
  year: number | null;
  genre: string;
  /** In disc, then track order. */
  tracks: TrackInfo[];
  /** The folder most of its tracks live in. */
  folder: string;
  /** A cover image in that folder, if one was found. */
  coverPath: string | null;
  /** The track to read embedded art from when there is no cover file. */
  pictureTrack: string | null;
  durationSec: number;
  /** Newest file time of its tracks: "recently added" order. */
  addedAt: number;
}

export type SortKey = 'artist' | 'title' | 'year' | 'genre' | 'added';
