import { backCover, labelArt, time } from '../art/back';
import { placeholderColours } from '../art/generate';
import type { SpineText } from '../art/spine';
import { packSides, searchAlbums, sortAlbums } from '../library/group';
import { Library, isFinal } from '../library/library';
import { readDrop, readFileList } from '../library/scan';
import { prefs, type CoverRecord } from '../library/store';
import type { Album, SortKey } from '../library/types';
import type { Light } from '../scene/room';
import type { Stage } from '../scene/stage';
import { thicknessOf } from '../scene/layout';
import { Deck } from './deck';
import { announce, byId, el, plural } from './dom';
import type { HandoffTrack } from './handoff';
import { ListView } from './list';
import {
  CUSTOM_ID,
  PLAYERS,
  allPlayers,
  chosenPlayer,
  validPlayerUrl,
  type PlayerInfo,
} from './players';

const COVER_WORKERS = 3;

/** The page: library, shelf, panels and keys, and how they talk to each other. */
export class App {
  readonly library = new Library();
  readonly deck = new Deck();
  stage: Stage | null;
  private list: ListView;
  private albums: Album[] = [];
  private sort: SortKey = prefs.get<SortKey>('sort', 'artist');
  private dividers = prefs.get('dividers', true);
  private colours = new Map<string, { colour: string; ink: string }>();
  private covers = new Map<string, CoverRecord>();
  private held: Album | null = null;
  private heldFlipped = false;
  private matches: Set<string> | null = null;
  private listMode = false;
  private coverQueue: Album[] = [];
  private coverRunning = 0;
  private pendingPlay: Album | null = null;
  private tipTimer = 0;

  constructor(stage: Stage | null) {
    this.stage = stage;
    this.list = new ListView(byId('list'), (album) => void this.pick(album));
    if (!stage) {
      document.body.classList.add('no-3d');
      byId('view').hidden = true;
    }
    this.bindLibrary();
    this.bindBar();
    this.bindAlbumPanel();
    this.bindDeck();
    this.bindKeys();
    this.bindDrop();
    this.bindSettings();
    this.setLight(prefs.get<Light>('light', 'dusk'));
    (byId('sort') as HTMLSelectElement).value = this.sort;
    this.setListMode(!stage || prefs.get('list', false));
  }

  async start(params: URLSearchParams): Promise<void> {
    const restored = await this.library.restore();
    if (params.has('demo') || (!restored && params.has('autodemo'))) this.library.showDemo();
    else if (!restored) byId('welcome').hidden = false;
    this.updateRelink();
  }

  // ─── Library ────────────────────────────────────────────────────

  private bindLibrary(): void {
    const lib = this.library;
    lib.events.on('albums', (albums) => this.setAlbums(albums));
    lib.events.on('progress', (p) => {
      const pill = byId('progress');
      pill.hidden = p === null;
      if (!p) return;
      byId('progress-text').textContent =
        p.phase === 'listing'
          ? `Looking through your folder… ${plural(p.done, 'file')}`
          : `Reading tags ${p.done} of ${p.total}`;
      byId('progress-bar').style.width = p.total ? `${(100 * p.done) / p.total}%` : '15%';
    });
    lib.events.on('linked', (linked) => {
      this.updateRelink();
      // Stand-in covers can now be replaced by the real ones in the folder.
      if (linked) this.queueCovers();
    });
    lib.events.on('status', (s) => announce(s));
    lib.events.on('cover', ({ id, cover }) => this.onCover(id, cover));
    byId('progress-cancel').addEventListener('click', () => lib.cancel());
  }

  private setAlbums(albums: Album[]): void {
    const heldId = this.held?.id;
    this.albums = sortAlbums(albums, this.sort);
    if (albums.length > 0) byId('welcome').hidden = true;
    this.stage?.setAlbums(this.albums, this.sort, (a) => this.spineOf(a));
    this.renderList();
    if (this.matches) this.applySearch();
    if (heldId && !this.albums.some((a) => a.id === heldId)) void this.putBack();
    this.updateFolderInfo();
    this.queueCovers();
  }

  private renderList(): void {
    this.list.render(this.albums, this.sort, (a) => this.colourOf(a).colour, this.dividers);
    for (const [id, cover] of this.covers) this.list.setCover(id, cover.blob);
    this.list.setMatches(this.matches);
    this.list.setPlaying(this.deck.album?.id ?? null);
  }

  private colourOf(album: Album): { colour: string; ink: string } {
    return this.colours.get(album.id) ?? placeholderColours(album);
  }

  private spineOf(album: Album): SpineText {
    return {
      id: album.id,
      title: album.title,
      artist: album.artist,
      year: album.year,
      ...this.colourOf(album),
    };
  }

  /** Reads covers in the background, a few at a time, so every spine gets its real colours. */
  private queueCovers(): void {
    const done = (a: Album): boolean => {
      const c = this.covers.get(a.id);
      return c !== undefined && isFinal(c, this.library.demo);
    };
    this.coverQueue = this.albums.filter((a) => !done(a));
    for (let i = this.coverRunning; i < COVER_WORKERS; i++) void this.coverWorker();
  }

  private async coverWorker(): Promise<void> {
    this.coverRunning++;
    while (this.coverQueue.length > 0) {
      const album = this.coverQueue.shift()!;
      const have = this.covers.get(album.id);
      if (have && isFinal(have, this.library.demo)) continue;
      await this.library.cover(album);
      // Let the page breathe between covers.
      await new Promise((r) => setTimeout(r, 0));
    }
    this.coverRunning--;
  }

  private onCover(id: string, cover: CoverRecord): void {
    this.covers.set(id, cover);
    this.colours.set(id, { colour: cover.colour, ink: cover.ink });
    const album = this.albums.find((a) => a.id === id);
    if (album) this.stage?.paintSpine(id, this.spineOf(album));
    this.list.setCover(id, cover.blob);
  }

  private updateRelink(): void {
    const lib = this.library;
    const needs = this.albums.length > 0 && !lib.linked && !lib.demo;
    // Not while a scan is running: the progress pill is in the same place.
    byId('relink').hidden = !needs || !byId('progress').hidden;
    byId('relink-text').textContent = this.pendingPlay
      ? `To play "${this.pendingPlay.title}", connect your music folder again.`
      : 'Your shelf is here. Connect the music folder again to play.';
    byId('folder-label').textContent =
      this.albums.length > 0 && !lib.demo ? 'Folder' : 'Open folder';
  }

  private updateFolderInfo(): void {
    const lib = this.library;
    const tracks = this.albums.reduce((n, a) => n + a.tracks.length, 0);
    byId('folder-info').textContent = lib.demo
      ? 'The demo shelf: 150 made-up records with short synthesized tunes.'
      : this.albums.length === 0
        ? 'No folder yet.'
        : `${lib.folderName ? `“${lib.folderName}”: ` : ''}${plural(this.albums.length, 'album')}, ${plural(tracks, 'track')}. Only tags and small covers are kept in this browser.`;
  }

  /** Opens the folder: the kept one if the browser allows, else the picker. Runs in a click. */
  async openFolder(): Promise<void> {
    const lib = this.library;
    if (lib.canReconnect && (await lib.reconnect())) return this.afterRelink();
    const picked = await lib.pickWithHandle();
    if (picked === null) byId<HTMLInputElement>('folder-input').click();
    else if (picked) this.afterRelink();
  }

  private afterRelink(): void {
    this.updateRelink();
    const album = this.pendingPlay;
    this.pendingPlay = null;
    this.updateRelink();
    if (album && this.held?.id === album.id) void this.play();
  }

  // ─── Top bar ────────────────────────────────────────────────────

  private bindBar(): void {
    const search = byId<HTMLInputElement>('search');
    search.addEventListener('input', () => this.applySearch());
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = this.albums.find((a) => this.matches?.has(a.id));
        if (first) void this.pick(first);
      } else if (e.key === 'Escape') {
        search.value = '';
        this.applySearch();
        (this.stage ? byId('scene') : byId('list')).focus();
      }
    });
    byId<HTMLSelectElement>('sort').addEventListener('change', (e) => {
      this.sort = (e.target as HTMLSelectElement).value as SortKey;
      prefs.set('sort', this.sort);
      this.setAlbums(this.library.albums);
    });
    byId('shuffle').addEventListener('click', () => this.shuffle());
    byId('view').addEventListener('click', () => this.setListMode(!this.listMode));
    byId('light').addEventListener('click', () =>
      this.setLight(document.body.dataset.light === 'day' ? 'dusk' : 'day'),
    );
    byId('folder').addEventListener('click', () => void this.openFolder());
    byId('welcome-folder').addEventListener('click', () => void this.openFolder());
    byId('welcome-demo').addEventListener('click', () => {
      byId('welcome').hidden = true;
      this.library.showDemo();
    });
    byId('relink-go').addEventListener('click', () => void this.openFolder());
    byId<HTMLInputElement>('folder-input').addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.files && input.files.length > 0)
        void this.library.add(readFileList(input.files)).then(() => this.afterRelink());
      input.value = '';
    });
  }

  private applySearch(): void {
    const q = byId<HTMLInputElement>('search').value;
    this.matches = q.trim() ? searchAlbums(this.albums, q) : null;
    this.stage?.setMatches(this.matches);
    this.list.setMatches(this.matches);
    const count = byId('search-count');
    count.textContent = this.matches ? plural(this.matches.size, 'record') : '';
  }

  private setListMode(on: boolean): void {
    this.listMode = on || !this.stage;
    byId('list').hidden = !this.listMode;
    const view = byId('view');
    view.setAttribute('aria-pressed', String(this.listMode));
    view.setAttribute('aria-label', this.listMode ? 'Shelf view' : 'List view');
    view.title = this.listMode ? 'Shelf view (L)' : 'List view (L)';
    byId<HTMLImageElement>('album-cover').hidden = !this.listMode;
    if (this.stage) prefs.set('list', this.listMode);
    this.layoutPanels();
  }

  private setLight(mode: Light): void {
    document.body.dataset.light = mode;
    this.stage?.setLight(mode);
    prefs.set('light', mode);
    const btn = byId('light');
    btn.setAttribute('aria-label', mode === 'day' ? 'Switch to dusk' : 'Switch to daylight');
    document
      .querySelector('meta[name=theme-color]')
      ?.setAttribute('content', mode === 'day' ? '#efe7da' : '#1b1612');
  }

  private shuffle(): void {
    const pool = this.matches ? this.albums.filter((a) => this.matches!.has(a.id)) : this.albums;
    if (pool.length === 0) return;
    const album = pool[Math.floor(Math.random() * pool.length)]!;
    const i = this.albums.indexOf(album);
    if (this.stage && !this.listMode) {
      this.stage.focusOn(i);
      window.setTimeout(() => void this.pick(album), 650);
    } else void this.pick(album);
  }

  // ─── The record in your hands ───────────────────────────────────

  private bindAlbumPanel(): void {
    byId('album-close').addEventListener('click', () => void this.putBack());
    byId('putback').addEventListener('click', () => void this.putBack());
    byId('flip').addEventListener('click', () => void this.flip());
    byId('play').addEventListener('click', () => void this.play());
    const menu = byId('player-menu');
    const pickBtn = byId('player-pick');
    pickBtn.addEventListener('click', () => {
      const open = menu.hidden;
      this.renderPlayerMenu();
      menu.hidden = !open;
      pickBtn.setAttribute('aria-expanded', String(open));
      if (open) (menu.querySelector('[aria-selected=true]') as HTMLElement | null)?.focus();
    });
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll<HTMLElement>('li')];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') items[Math.min(items.length - 1, at + 1)]?.focus();
      else if (e.key === 'ArrowUp') items[Math.max(0, at - 1)]?.focus();
      else if (e.key === 'Escape') {
        menu.hidden = true;
        pickBtn.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('click', (e) => {
      if (
        !menu.hidden &&
        !menu.contains(e.target as Node) &&
        e.target !== pickBtn &&
        !pickBtn.contains(e.target as Node)
      ) {
        menu.hidden = true;
        pickBtn.setAttribute('aria-expanded', 'false');
      }
    });
    this.updatePlayName();
  }

  private renderPlayerMenu(): void {
    const menu = byId('player-menu');
    menu.textContent = '';
    const current = chosenPlayer().id;
    for (const p of allPlayers()) {
      const badge = el('span', { class: 'badge', style: `--b1:${p.badge[0]};--b2:${p.badge[1]}` });
      const li = el(
        'li',
        { role: 'option', tabindex: '-1', 'aria-selected': String(p.id === current) },
        badge,
        el('div', {}, el('b', { text: p.name }), el('small', { text: p.blurb })),
      );
      const choose = (): void => {
        this.choosePlayer(p);
        menu.hidden = true;
        byId('player-pick').setAttribute('aria-expanded', 'false');
        byId('play').focus();
      };
      li.addEventListener('click', choose);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      });
      menu.append(li);
    }
  }

  private choosePlayer(p: PlayerInfo): void {
    prefs.set('player', p.id);
    this.updatePlayName();
    this.renderSettingsPlayers();
  }

  private updatePlayName(): void {
    byId('play-name').textContent = chosenPlayer().name;
  }

  /** Takes an album off the shelf: into your hands in 3D, into the panel in the list. */
  async pick(album: Album): Promise<void> {
    byId('player-menu').hidden = true;
    if (this.held?.id === album.id) {
      byId('play').focus();
      return;
    }
    this.held = album;
    this.heldFlipped = false;
    this.fillAlbumPanel(album);
    if (this.deck.open && !this.deck.tucked) this.deck.tuck(true);
    byId('album').hidden = false;
    this.layoutPanels();
    announce(
      `${album.title} by ${album.artist}${album.year ? `, ${album.year}` : ''}. ${plural(album.tracks.length, 'track')}.`,
    );
    byId('play').focus({ preventScroll: true });
    if (this.stage && !this.listMode) {
      const cover = await this.library.cover(album);
      if (this.held !== album) return;
      const front = await createImageBitmap(cover.blob);
      const spine = this.spineOf(album);
      const sides = this.sidesOf(album);
      const back = backCover({ ...spine, genre: album.genre, sides });
      const label = labelArt(spine, front, 512);
      await this.stage.pull(album.id, { spine, front, back, label, thickness: thicknessOf(album) });
    }
  }

  private sidesOf(album: Album): { title: string; durationSec: number | null; artist: string }[][] {
    const durations = album.tracks.map((t) => t.durationSec ?? 240);
    return packSides(durations).map(([a, b]) =>
      album.tracks
        .slice(a, b + 1)
        .map((t) => ({ title: t.title, durationSec: t.durationSec, artist: t.artist })),
    );
  }

  private fillAlbumPanel(album: Album): void {
    byId('album-artist').textContent = album.artist;
    byId('album-title').textContent = album.title;
    const bits = [
      album.year ? String(album.year) : '',
      album.genre,
      plural(album.tracks.length, 'track'),
      album.durationSec ? time(album.durationSec) : '',
    ];
    byId('album-meta').textContent = bits.filter(Boolean).join(' · ');
    const img = byId<HTMLImageElement>('album-cover');
    const url = this.list.coverUrl(album.id);
    if (url) img.src = url;
    else img.removeAttribute('src');
    const box = byId('album-tracks');
    box.textContent = '';
    const various =
      album.artist === 'Various Artists' || new Set(album.tracks.map((t) => t.artist)).size > 1;
    this.sidesOf(album).forEach((side, s) => {
      const letter = String.fromCharCode(65 + s);
      box.append(el('h3', { text: `SIDE ${letter}` }));
      const ol = el('ol');
      side.forEach((t, n) => {
        const title = el(
          'span',
          {},
          t.title,
          ...(various && t.artist ? [el('span', { class: 'artist', text: t.artist })] : []),
        );
        ol.append(
          el(
            'li',
            {},
            el('span', { text: `${letter}${n + 1}` }),
            title,
            el('span', { text: time(t.durationSec) }),
          ),
        );
      });
      box.append(ol);
    });
  }

  async flip(): Promise<void> {
    if (!this.held) return;
    this.heldFlipped = (await this.stage?.flip()) ?? !this.heldFlipped;
    byId('flip').textContent = this.heldFlipped ? 'Show the front' : 'Turn over';
  }

  async putBack(): Promise<void> {
    if (!this.held) return;
    const album = this.held;
    this.held = null;
    byId('album').hidden = true;
    byId('flip').textContent = 'Turn over';
    this.layoutPanels();
    await this.stage?.putBack();
    if (this.listMode) this.list.focus(album.id);
    else byId('scene').focus({ preventScroll: true });
  }

  /** Plays the record in your hands on the chosen player. */
  async play(inTab = prefs.get('openTab', false)): Promise<void> {
    const album = this.held ?? this.deck.album;
    if (!album) return;
    const player = chosenPlayer();
    // A tab must be opened inside the click, before anything is awaited.
    const tab = inTab ? window.open('about:blank', '_blank') : null;
    const files = await this.library.filesOf(album);
    if (!files) {
      tab?.close();
      this.pendingPlay = album;
      this.updateRelink();
      byId('relink-go').focus();
      return;
    }
    const tracks: HandoffTrack[] = album.tracks.map((t, i) => ({
      file: files[i]!,
      title: t.title,
      artist: t.artist,
      trackNo: t.trackNo,
      disc: t.discNo,
      durationSec: t.durationSec,
    }));
    const cover = this.covers.get(album.id)?.blob ?? null;
    this.deck.start(player, album, tracks, cover, inTab && tab !== null, tab);
    this.list.setPlaying(album.id);
    announce(`Playing ${album.title} on ${player.name}.`);
    if (this.held) {
      this.held = null;
      byId('album').hidden = true;
      this.layoutPanels();
      await this.stage?.playHeld();
    }
    // The player may have started while the record was on its way.
    this.stage?.setPlaying(album.id, this.deck.isPlaying);
  }

  // ─── Deck ───────────────────────────────────────────────────────

  private bindDeck(): void {
    this.deck.events.on('playing', (on) => this.stage?.setPlaying(this.deck.album?.id ?? null, on));
    this.deck.events.on('shown', () => this.layoutPanels());
    this.deck.events.on('closed', () => {
      this.list.setPlaying(null);
      void this.stage?.clearTurntable();
    });
    this.deck.events.on('toTab', () => {
      const album = this.deck.album;
      if (!album) return;
      this.held = null;
      const tab = window.open('about:blank', '_blank');
      void this.library.filesOf(album).then((files) => {
        if (!files || !tab) return;
        const tracks = album.tracks.map((t, i) => ({
          file: files[i]!,
          title: t.title,
          artist: t.artist,
          trackNo: t.trackNo,
          disc: t.discNo,
          durationSec: t.durationSec,
        }));
        this.deck.start(
          chosenPlayer(),
          album,
          tracks,
          this.covers.get(album.id)?.blob ?? null,
          true,
          tab,
        );
        this.layoutPanels();
      });
    });
  }

  /** The 3D view makes room for whichever panel is open: on the right, or at the bottom on a phone. */
  private layoutPanels(): void {
    if (!this.stage) return;
    const albumOpen = !byId('album').hidden;
    const deckOpen = this.deck.open && !byId('deck').hidden && !this.deck.tucked;
    const panel = this.listMode ? null : albumOpen ? byId('album') : deckOpen ? byId('deck') : null;
    if (!panel) {
      this.stage.setInset(0, 0);
      return;
    }
    const r = panel.getBoundingClientRect();
    if (window.innerWidth <= 760)
      this.stage.setInset(0, Math.min(0.7, (r.height + 16) / window.innerHeight));
    else this.stage.setInset(Math.min(0.6, (r.width + 24) / window.innerWidth), 0);
  }

  // ─── Keys ───────────────────────────────────────────────────────

  private bindKeys(): void {
    window.addEventListener('resize', () => this.layoutPanels());
    document.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA';
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((byId('settings') as HTMLDialogElement).open) return;
      const key = e.key;
      const onScene = target === byId('scene') || target === document.body;
      if (key === '/') {
        e.preventDefault();
        byId('search').focus();
      } else if (key === 'Escape') {
        if (this.held) void this.putBack();
        else if (byId('deck').classList.contains('full')) byId('deck').classList.remove('full');
        else if (byId<HTMLInputElement>('search').value) {
          byId<HTMLInputElement>('search').value = '';
          this.applySearch();
        }
      } else if (key === 'f' || key === 'F') {
        if (this.held) void this.flip();
      } else if (key === 'r' || key === 'R') this.shuffle();
      else if (key === 'l' || key === 'L') this.setListMode(!this.listMode);
      else if (key === 'd' || key === 'D')
        this.setLight(document.body.dataset.light === 'day' ? 'dusk' : 'day');
      else if (this.stage && !this.listMode && onScene && !this.held) this.sceneKey(e);
    });
  }

  private sceneKey(e: KeyboardEvent): void {
    const stage = this.stage!;
    if (this.albums.length === 0) return;
    const dirs: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      const from = stage.focused ?? this.firstVisible();
      const next = stage.focused === null ? from : stage.neighbour(from, dir);
      stage.focusOn(next);
      const a = this.albums[next]!;
      announce(`${a.artist}, ${a.title}${a.year ? `, ${a.year}` : ''}`);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const i = stage.focused;
      if (i !== null) void this.pick(this.albums[i]!);
    } else if (e.key === '+' || e.key === '=') stage.zoom(0.8);
    else if (e.key === '-' || e.key === '_') stage.zoom(1.25);
    else if (e.key === '0' || e.key === 'Home') {
      stage.focusOn(null);
      stage.overview();
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const from = stage.focused ?? 0;
      stage.focusOn(
        Math.max(0, Math.min(this.albums.length - 1, from + (e.key === 'PageDown' ? 20 : -20))),
      );
    }
  }

  private firstVisible(): number {
    if (this.matches) {
      const i = this.albums.findIndex((a) => this.matches!.has(a.id));
      if (i >= 0) return i;
    }
    return 0;
  }

  // ─── Drop and settings ──────────────────────────────────────────

  private bindDrop(): void {
    const drop = byId('drop');
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      drop.hidden = false;
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) drop.hidden = true;
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      drop.hidden = true;
      const items = e.dataTransfer?.items;
      if (!items) return;
      byId('welcome').hidden = true;
      void readDrop(items)
        .then((contents) => this.library.add(contents))
        .then(() => this.afterRelink());
    });
  }

  private bindSettings(): void {
    const dialog = byId<HTMLDialogElement>('settings');
    byId('settings-open').addEventListener('click', () => {
      this.renderSettingsPlayers();
      byId<HTMLInputElement>('custom-url').value = prefs.get('customPlayer', '');
      byId<HTMLInputElement>('open-tab').checked = prefs.get('openTab', false);
      byId<HTMLInputElement>('dividers').checked = this.dividers;
      byId<HTMLInputElement>('daylight').checked = document.body.dataset.light === 'day';
      byId<HTMLInputElement>('quality').checked = prefs.get<string>('quality', '') === 'low';
      this.updateFolderInfo();
      dialog.showModal();
    });
    byId<HTMLInputElement>('custom-url').addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const url = input.value.trim() ? validPlayerUrl(input.value) : '';
      input.setCustomValidity(url === null ? 'An http(s) address, please.' : '');
      input.reportValidity();
      if (url === null) return;
      prefs.set('customPlayer', url);
      if (url) prefs.set('player', CUSTOM_ID);
      else if (prefs.get<string>('player', '') === CUSTOM_ID) prefs.set('player', PLAYERS[0]!.id);
      this.renderSettingsPlayers();
      this.updatePlayName();
    });
    byId<HTMLInputElement>('open-tab').addEventListener('change', (e) =>
      prefs.set('openTab', (e.target as HTMLInputElement).checked),
    );
    byId<HTMLInputElement>('daylight').addEventListener('change', (e) =>
      this.setLight((e.target as HTMLInputElement).checked ? 'day' : 'dusk'),
    );
    byId<HTMLInputElement>('dividers').addEventListener('change', (e) => {
      this.dividers = (e.target as HTMLInputElement).checked;
      prefs.set('dividers', this.dividers);
      this.setAlbums(this.library.albums);
    });
    byId<HTMLInputElement>('quality').addEventListener('change', (e) => {
      prefs.set('quality', (e.target as HTMLInputElement).checked ? 'low' : 'high');
      announce('Reload the page to change the graphics.');
      byId('folder-info').textContent = 'Reload the page to change the graphics.';
    });
    byId('rescan').addEventListener('click', () => {
      dialog.close();
      void this.openFolder();
    });
    byId('forget').addEventListener('click', () => {
      dialog.close();
      this.deck.close();
      void this.putBack();
      this.covers.clear();
      this.colours.clear();
      this.list.forgetCovers();
      void this.library.forget().then(() => {
        byId('welcome').hidden = false;
      });
    });
  }

  private renderSettingsPlayers(): void {
    const box = byId('settings-players');
    box.textContent = '';
    const current = chosenPlayer().id;
    for (const p of allPlayers()) {
      const badge = el('span', { class: 'badge', style: `--b1:${p.badge[0]};--b2:${p.badge[1]}` });
      const card = el(
        'button',
        { class: 'player-card', type: 'button', 'aria-pressed': String(p.id === current) },
        badge,
        el('span', {}, el('b', { text: p.name }), el('small', { text: p.blurb })),
      );
      card.addEventListener('click', () => this.choosePlayer(p));
      box.append(card);
    }
  }

  // ─── Hover tooltip (3D) ─────────────────────────────────────────

  hover(index: number | null, x: number, y: number): void {
    const tip = byId('tip');
    clearTimeout(this.tipTimer);
    if (index === null || this.held) {
      tip.hidden = true;
      return;
    }
    const album = this.albums[index];
    if (!album) return;
    tip.textContent = '';
    tip.append(
      el('b', { text: album.title }),
      el('span', { text: `${album.artist}${album.year ? ` · ${album.year}` : ''}` }),
    );
    tip.style.left = `${Math.min(x, window.innerWidth - 300)}px`;
    tip.style.top = `${y}px`;
    this.tipTimer = window.setTimeout(() => (tip.hidden = false), 80);
  }

  /** A record on the shelf was clicked. */
  pickIndex(index: number): void {
    const album = this.albums[index];
    if (album) void this.pick(album);
  }

  heroClick(): void {
    void this.flip();
  }
}
