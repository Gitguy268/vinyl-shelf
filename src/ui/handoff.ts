import { Emitter } from '../util/emitter';
import { originOf, shelfUrl } from './protocol';

export { shelfUrl };

/** The shelf's side of vinyl-shelf/1 (docs/PROTOCOL.md). */

export interface HandoffAlbum {
  title: string;
  artist: string;
  year: number | null;
  genre: string;
  cover: Blob | null;
}

export interface HandoffTrack {
  file: File;
  title: string;
  artist: string;
  trackNo: number | null;
  disc: number | null;
  durationSec: number | null;
}

export interface PlayerState {
  playing: boolean;
  track: number;
  title: string;
  position: number;
  duration: number;
  sound: string;
  blocked: boolean;
}

export interface HandoffEvents extends Record<string, unknown> {
  hello: string;
  loaded: number;
  state: PlayerState;
  blocked: undefined;
  /** The player did not answer in time. */
  timeout: undefined;
}

const HELLO_TIMEOUT_MS = 25_000;

/**
 * One album handed to one player page (a frame of ours, or a tab we opened). Messages from any
 * other window are ignored; the player is sent the album only after it says hello.
 */
export class Handoff {
  readonly events = new Emitter<HandoffEvents>();
  private target: Window | null = null;
  /**
   * The player's origin; files are only ever posted to it ('*' only for a file: player, whose
   * origin is opaque). Set from the address, then from where the hello really came from.
   */
  private origin = '*';
  private payload: { album: HandoffAlbum; tracks: HandoffTrack[] } | null = null;
  private timer = 0;
  private sent = false;

  constructor() {
    window.addEventListener('message', this.onMessage);
  }

  /** Points the hand-off at a window before the player loads in it, so an early hello is kept. */
  begin(target: Window, playerUrl: string, album: HandoffAlbum, tracks: HandoffTrack[]): void {
    this.target = target;
    this.origin = originOf(playerUrl, location.href);
    this.payload = { album, tracks };
    this.sent = false;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.sent) this.events.emit('timeout', undefined);
    }, HELLO_TIMEOUT_MS);
  }

  stop(): void {
    this.target = null;
    this.payload = null;
    clearTimeout(this.timer);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('message', this.onMessage);
  }

  private onMessage = (e: MessageEvent): void => {
    const d = e.data as { type?: unknown; v?: unknown } | null;
    if (!this.target || e.source !== this.target || !d || typeof d !== 'object' || d.v !== 1)
      return;
    // The hello fixes the origin for the rest: it comes from our own frame or tab, which may have
    // been redirected (http to https, a trailing slash). Every later message must match it.
    if (d.type === 'vinyl-shelf:hello' && !this.sent)
      this.origin = e.origin === 'null' ? '*' : e.origin;
    else if (this.origin !== '*' && e.origin !== this.origin) return;
    switch (d.type) {
      case 'vinyl-shelf:hello': {
        if (!this.payload || this.sent) return;
        this.sent = true;
        clearTimeout(this.timer);
        const msg = { type: 'vinyl-shelf:load', v: 1, autoplay: true, ...this.payload };
        try {
          this.target.postMessage(msg, this.origin);
        } catch {
          // The window went away between hello and load.
        }
        this.events.emit('hello', String((d as { player?: unknown }).player ?? ''));
        break;
      }
      case 'vinyl-shelf:loaded':
        this.events.emit('loaded', Number((d as { tracks?: unknown }).tracks) || 0);
        break;
      case 'vinyl-shelf:state': {
        const s = d as Partial<PlayerState>;
        this.events.emit('state', {
          playing: s.playing === true,
          track: Number(s.track) || 0,
          title: typeof s.title === 'string' ? s.title.slice(0, 200) : '',
          position: Number(s.position) || 0,
          duration: Number(s.duration) || 0,
          sound: typeof s.sound === 'string' ? s.sound : 'none',
          blocked: s.blocked === true,
        });
        break;
      }
      case 'vinyl-shelf:blocked':
        this.events.emit('blocked', undefined);
        break;
    }
  };
}
