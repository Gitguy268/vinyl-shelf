import { time } from '../art/back';
import type { Album } from '../library/types';
import { Emitter } from '../util/emitter';
import { byId, el } from './dom';
import { Handoff, shelfUrl, type HandoffTrack, type PlayerState } from './handoff';
import type { PlayerInfo } from './players';

export interface DeckEvents extends Record<string, unknown> {
  /** Playing or paused, for the album on the turntable. */
  playing: boolean;
  /** The deck was closed: the music stopped. */
  closed: undefined;
  /** The panel was shown or tucked away (the view makes room for it). */
  shown: boolean;
  /** The listener asked for the player in a tab of its own. */
  toTab: undefined;
}

/**
 * The player beside the shelf: a frame holding one of the vinyl players (or a tab of its own),
 * with what it is playing in its header. Tucking it away keeps the music going.
 */
export class Deck {
  readonly events = new Emitter<DeckEvents>();
  private panel = byId('deck');
  private frameBox = byId('deck-frame');
  private status = byId('deck-status');
  private hint = byId('deck-hint');
  private now = byId<HTMLButtonElement>('now');
  private nowText = byId('now-text');
  private handoff = new Handoff();
  private frame: HTMLIFrameElement | null = null;
  private tab: Window | null = null;
  private player: PlayerInfo | null = null;
  album: Album | null = null;
  private playing = false;
  private lastState: PlayerState | null = null;

  constructor() {
    byId('deck-close').addEventListener('click', () => this.close());
    byId('deck-hide').addEventListener('click', () => this.tuck(true));
    this.now.addEventListener('click', () => (this.tab ? this.tab.focus() : this.tuck(false)));
    byId('deck-full').addEventListener('click', () => this.panel.classList.toggle('full'));
    byId('deck-tab').addEventListener('click', () => this.events.emit('toTab', undefined));
    this.handoff.events.on('hello', () => this.setStatus('Putting the record on…'));
    this.handoff.events.on('loaded', (n) =>
      this.setStatus(`${n} ${n === 1 ? 'track' : 'tracks'} on the record`),
    );
    this.handoff.events.on('blocked', () => (this.hint.hidden = !this.frame));
    this.handoff.events.on('timeout', () =>
      this.setStatus('The player did not answer. Is it one that takes albums from Vinyl Shelf?'),
    );
    this.handoff.events.on('state', (s) => this.onState(s));
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get open(): boolean {
    return this.album !== null;
  }

  get tucked(): boolean {
    return this.panel.classList.contains('tucked');
  }

  /** Puts an album on a player. Call inside the click when `inTab` (pop-up rules). */
  start(
    player: PlayerInfo,
    album: Album,
    tracks: HandoffTrack[],
    cover: Blob | null,
    inTab: boolean,
    tab?: Window | null,
  ): void {
    this.teardown();
    this.player = player;
    this.album = album;
    this.playing = false;
    this.lastState = null;
    const payload = {
      title: album.title,
      artist: album.artist,
      year: album.year,
      genre: album.genre,
      cover,
    };
    byId('deck-name').textContent = player.name;
    const badge = byId('deck-badge');
    badge.style.setProperty('--b1', player.badge[0]);
    badge.style.setProperty('--b2', player.badge[1]);
    this.hint.hidden = true;
    this.setStatus(`Opening ${player.name}…`);
    if (inTab && tab) {
      this.tab = tab;
      this.handoff.begin(tab, payload, tracks);
      // The tab was opened blank inside the click (pop-up rules); now it gets the player.
      tab.location.href = shelfUrl(player.url);
      this.panel.hidden = true;
      this.showNow();
      return;
    }
    const frame = el('iframe', {
      title: `${player.name}: ${album.title}`,
      allow: 'autoplay; fullscreen; clipboard-write',
      referrerpolicy: 'no-referrer',
    });
    this.frameBox.append(frame);
    this.frame = frame;
    // The window exists before it loads anything: point the hand-off at it first.
    this.handoff.begin(frame.contentWindow!, payload, tracks);
    frame.src = shelfUrl(player.url);
    this.panel.hidden = false;
    this.panel.classList.remove('tucked', 'full');
    this.now.hidden = true;
    this.events.emit('shown', true);
  }

  private onState(s: PlayerState): void {
    this.lastState = s;
    if (s.playing !== this.playing) {
      this.playing = s.playing;
      this.events.emit('playing', s.playing);
    }
    if (s.playing) this.hint.hidden = true;
    const where = s.duration > 0 ? `${time(s.position)} / ${time(s.duration)}` : time(s.position);
    this.setStatus(`${s.playing ? 'Playing' : 'Paused'}: ${s.title}${where ? ` · ${where}` : ''}`);
    this.nowText.textContent = `${s.title || this.album?.title || ''} · ${this.player?.name ?? ''}`;
    this.now.classList.toggle('playing', s.playing);
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
    if (!this.lastState) this.nowText.textContent = `${this.album?.title ?? ''} · ${text}`;
  }

  private showNow(): void {
    this.now.hidden = false;
    this.now.classList.toggle('playing', this.playing);
    if (!this.nowText.textContent) this.nowText.textContent = this.album?.title ?? '';
  }

  /** Hides the panel (the music goes on) or brings it back. */
  tuck(on: boolean): void {
    if (!this.frame) return;
    this.panel.classList.toggle('tucked', on);
    this.panel.classList.remove('full');
    if (on) this.showNow();
    else this.now.hidden = true;
    this.events.emit('shown', !on);
  }

  close(): void {
    const was = this.album !== null;
    this.teardown();
    this.panel.hidden = true;
    this.now.hidden = true;
    if (was) {
      this.events.emit('shown', false);
      this.events.emit('closed', undefined);
    }
  }

  private teardown(): void {
    this.handoff.stop();
    this.frame?.remove();
    this.frame = null;
    try {
      this.tab?.close();
    } catch {
      // not ours to close any more
    }
    this.tab = null;
    this.album = null;
    this.nowText.textContent = '';
  }
}
