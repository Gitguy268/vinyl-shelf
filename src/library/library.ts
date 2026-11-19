import { Emitter } from '../util/emitter';
import { coverFromBlob, madeCover } from './covers';
import { DEMO_PREFIX, demoAlbums, demoFile, demoTracks } from './demo';
import { groupAlbums } from './group';
import { relink } from './relink';
import { readDirectoryHandle, type FolderContents } from './scan';
import { Store, type CoverRecord } from './store';
import { didTimeOut, pool, readPicture, readTags } from './tags';
import type { Album, ImageInfo, TrackInfo } from './types';

export interface LibraryEvents extends Record<string, unknown> {
  /** The albums changed (scan, re-link, demo). */
  albums: Album[];
  /** Reading tags: done of total, or null when finished. */
  progress: { done: number; total: number; phase: 'listing' | 'reading' } | null;
  /** Whether the folder's files can be read right now. */
  linked: boolean;
  status: string;
  /** A cover became available. */
  cover: { id: string; cover: CoverRecord };
}

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
};

const CONCURRENCY = 4;

/** A cover that will not get better: a real one, or a made one after the folder was searched. */
export function isFinal(cover: CoverRecord, demo: boolean): boolean {
  return demo || cover.source !== 'made' || cover.checked === true;
}

/**
 * The music folder as the shelf sees it: an index of tags kept in IndexedDB, the files of this
 * visit (they cannot be kept between visits unless the browser lets the shelf keep the folder),
 * and the covers.
 */
export class Library {
  readonly events = new Emitter<LibraryEvents>();
  albums: Album[] = [];
  demo = false;
  folderName = '';
  private tracks = new Map<string, TrackInfo>();
  private images: ImageInfo[] = [];
  private files = new Map<string, File>();
  private root: PermissionHandle | null = null;
  private store: Store;
  private covers = new Map<string, Promise<CoverRecord>>();
  private busy: AbortController | null = null;

  constructor(store = new Store()) {
    this.store = store;
  }

  get linked(): boolean {
    return this.demo || this.files.size > 0;
  }

  get canKeepFolder(): boolean {
    return typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
  }

  /** The shelf of the last visit, from the index; reconnects the folder when the browser allows. */
  async restore(): Promise<boolean> {
    const { tracks, images } = await this.store.load();
    this.folderName = (await this.store.get<string>('folderName')) ?? '';
    if (tracks.length === 0) return false;
    this.tracks = new Map(tracks.map((t) => [t.path, t]));
    this.images = images;
    this.regroup();
    this.root = (await this.store.get<PermissionHandle>('root')) ?? null;
    if (this.root && (await this.root.queryPermission?.({ mode: 'read' })) === 'granted') {
      void this.rescan();
    }
    this.events.emit('linked', this.linked);
    return true;
  }

  /** Whether a click can bring the folder back without picking it (Chromium keeps the handle). */
  get canReconnect(): boolean {
    return this.root !== null && !this.linked;
  }

  /** Asks again for the kept folder; must run inside a click. */
  async reconnect(): Promise<boolean> {
    if (!this.root) return false;
    const state = (await this.root.requestPermission?.({ mode: 'read' })) ?? 'denied';
    if (state !== 'granted') return false;
    await this.rescan();
    return true;
  }

  /** The folder picker of the File System Access API; null where the browser has none. */
  async pickWithHandle(): Promise<boolean | null> {
    const picker = (
      window as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker;
    if (!picker) return null;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker({ id: 'vinyl-shelf', mode: 'read', startIn: 'music' });
    } catch {
      return false; // cancelled
    }
    this.root = handle as PermissionHandle;
    await this.store.set('root', handle);
    await this.rescan();
    return true;
  }

  private async rescan(): Promise<void> {
    if (!this.root) return;
    this.events.emit('progress', { done: 0, total: 0, phase: 'listing' });
    const contents = await readDirectoryHandle(this.root, (n) =>
      this.events.emit('progress', { done: n, total: 0, phase: 'listing' }),
    );
    await this.add(contents);
  }

  /** A folder from the folder input or a drop. Same folder as before: only new or changed files are read. */
  async add(contents: FolderContents): Promise<void> {
    this.busy?.abort();
    const busy = (this.busy = new AbortController());
    this.leaveDemo();
    const picked = contents.audio.map((f) => ({
      path: f.path,
      size: f.file.size,
      mtime: f.file.lastModified,
      file: f.file,
    }));
    const r = relink([...this.tracks.values()], picked);
    const files = new Map<string, File>();
    const total = r.fresh.length;
    this.events.emit('progress', { done: 0, total, phase: 'reading' });
    // The index follows the picked folder's paths; unchanged files keep their tags.
    const known = new Map<string, TrackInfo>();
    for (const { known: was, picked: p } of r.matched) {
      known.set(p.path, { ...this.tracks.get(was)!, path: p.path });
      files.set(p.path, p.file);
    }
    let lastEmit = 0;
    await pool(
      r.fresh,
      CONCURRENCY,
      (p) => readTags(p.file, p.path),
      (done, track) => {
        known.set(track.path, track);
        this.events.emit('progress', { done, total, phase: 'reading' });
        // The shelf fills in as tags arrive, every second and a half (a rebuild costs a frame).
        const now = performance.now();
        if (now - lastEmit > 1500 && done < total) {
          lastEmit = now;
          this.tracks = new Map(known);
          this.regroup();
        }
      },
      busy.signal,
    );
    if (busy.signal.aborted) return;
    // Files the parser ran out of time on (a slow machine, a busy page, a stalled stream): once
    // more, one at a time, from memory.
    for (const p of r.fresh) {
      const track = known.get(p.path);
      if (!track || !didTimeOut(track) || busy.signal.aborted) continue;
      known.set(p.path, await readTags(p.file, p.path, 60_000, p.file.size < 512 * 1024 * 1024));
    }
    if (busy.signal.aborted) return;
    for (const p of r.fresh) files.set(p.path, p.file);
    this.tracks = known;
    this.files = files;
    for (const img of contents.images) this.files.set(img.path, img.file);
    this.images = contents.images.map((img) => ({ path: img.path, size: img.file.size }));
    this.folderName = contents.name;
    // Keep the index before saying the scan is done: a reload right after must find it.
    await this.store.saveIndex([...this.tracks.values()], this.images);
    await this.store.set('folderName', this.folderName);
    this.busy = null;
    this.events.emit('progress', null);
    this.regroup();
    this.events.emit('linked', this.linked);
    await this.pruneCovers();
    const n = this.albums.length;
    this.events.emit('status', `${n} ${n === 1 ? 'album' : 'albums'} on the shelf.`);
  }

  cancel(): void {
    this.busy?.abort();
    this.busy = null;
    this.events.emit('progress', null);
  }

  showDemo(): void {
    this.demo = true;
    this.albums = demoAlbums();
    this.events.emit('albums', this.albums);
    this.events.emit('linked', true);
  }

  private leaveDemo(): void {
    if (!this.demo) return;
    this.demo = false;
    this.covers.clear();
  }

  /** Forget the folder and its index. */
  async forget(): Promise<void> {
    await this.store.clear();
    this.tracks.clear();
    this.files.clear();
    this.images = [];
    this.root = null;
    this.covers.clear();
    this.folderName = '';
    this.regroup();
    this.events.emit('linked', false);
  }

  private regroup(): void {
    this.albums = groupAlbums([...this.tracks.values()], this.images);
    this.events.emit('albums', this.albums);
  }

  /** The audio files of an album, in order; null while the folder is not connected. */
  async filesOf(album: Album): Promise<File[] | null> {
    if (this.demo || album.folder.startsWith(DEMO_PREFIX)) {
      const known = new Map(demoTracks().map((t) => [t.path, t]));
      return album.tracks.map((t) => demoFile(known.get(t.path) ?? t));
    }
    const out: File[] = [];
    for (const t of album.tracks) {
      const f = this.files.get(t.path) ?? (await this.fromRoot(t.path));
      if (!f) return null;
      out.push(f);
    }
    return out;
  }

  private async fromRoot(path: string): Promise<File | null> {
    if (!this.root || (await this.root.queryPermission?.({ mode: 'read' })) !== 'granted')
      return null;
    try {
      let dir: FileSystemDirectoryHandle = this.root;
      const parts = path.split('/');
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      return await (await dir.getFileHandle(parts.at(-1)!)).getFile();
    } catch {
      return null;
    }
  }

  /** The album's cover: kept, read from the folder or the tags, or made. Never fails. */
  cover(album: Album): Promise<CoverRecord> {
    let p = this.covers.get(album.id);
    if (!p) {
      p = this.findCover(album);
      this.covers.set(album.id, p);
      void p.then((cover) => {
        // A cover made while the files could not be looked at is a stand-in: ask again later.
        if (!isFinal(cover, this.demo)) this.covers.delete(album.id);
        this.events.emit('cover', { id: album.id, cover });
      });
    }
    return p;
  }

  /** A cover only if it is ready or kept; does not read files. */
  async keptCover(album: Album): Promise<CoverRecord | undefined> {
    if (this.demo) return undefined;
    return this.store.cover(album.id);
  }

  private async findCover(album: Album): Promise<CoverRecord> {
    if (this.busy) return madeCover(album);
    if (!this.demo) {
      const kept = await this.store.cover(album.id);
      // A made cover is replaced once the folder offers a real one.
      if (kept && (kept.source !== 'made' || kept.checked || !this.linked)) return kept;
      let found: CoverRecord | null = null;
      if (album.coverPath) {
        const f = this.files.get(album.coverPath) ?? (await this.fromRoot(album.coverPath));
        if (f) found = await coverFromBlob(f, 'file');
      }
      if (!found && album.pictureTrack) {
        const f = this.files.get(album.pictureTrack) ?? (await this.fromRoot(album.pictureTrack));
        const pic = f ? await readPicture(f) : null;
        if (pic) found = await coverFromBlob(pic, 'tag');
      }
      if (found || this.linked) {
        const cover = found ?? { ...(await madeCover(album)), checked: true };
        await this.store.saveCover(album.id, cover);
        return cover;
      }
      if (kept) return kept;
    }
    return madeCover(album);
  }

  private async pruneCovers(): Promise<void> {
    const ids = new Set(this.albums.map((a) => a.id));
    const stale = (await this.store.coverIds()).filter((id) => !ids.has(id));
    await this.store.dropCovers(stale);
  }
}
