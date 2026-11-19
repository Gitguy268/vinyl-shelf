import { dividerOf } from '../library/group';
import type { Album, SortKey } from '../library/types';
import { el } from './dom';

/**
 * The shelf as a grid of covers: the view for screen readers, small screens without WebGL, and
 * anyone who prefers it. Same albums, same order, same search.
 */
export class ListView {
  private root: HTMLElement;
  private tiles = new Map<string, HTMLButtonElement>();
  private urls = new Map<string, string>();
  private onPick: (album: Album) => void;

  constructor(root: HTMLElement, onPick: (album: Album) => void) {
    this.root = root;
    this.onPick = onPick;
  }

  render(
    albums: readonly Album[],
    sort: SortKey,
    colour: (a: Album) => string,
    dividers: boolean,
  ): void {
    this.root.textContent = '';
    this.tiles.clear();
    let grid: HTMLElement | null = null;
    let last: string | null = null;
    for (const album of albums) {
      const d = dividers ? dividerOf(album, sort) : '';
      if (!grid || d !== last) {
        if (d) this.root.append(el('h3', { text: d }));
        grid = el('div', { class: 'grid', role: 'list' });
        this.root.append(grid);
        last = d;
      }
      const art = this.urls.has(album.id)
        ? el('img', { class: 'art', src: this.urls.get(album.id)!, alt: '', loading: 'lazy' })
        : el('div', { class: 'art', style: `--c:${colour(album)}` });
      const tile = el(
        'button',
        {
          class: 'tile',
          type: 'button',
          role: 'listitem',
          'data-id': album.id,
          'aria-label': `${album.title} by ${album.artist}${album.year ? `, ${album.year}` : ''}`,
        },
        art,
        el('b', { text: album.title }),
        el('span', { text: album.artist }),
      );
      tile.addEventListener('click', () => this.onPick(album));
      grid.append(tile);
      this.tiles.set(album.id, tile);
    }
  }

  setCover(id: string, blob: Blob): void {
    if (!this.urls.has(id)) this.urls.set(id, URL.createObjectURL(blob));
    const tile = this.tiles.get(id);
    const art = tile?.querySelector('.art');
    if (tile && art && art.tagName !== 'IMG')
      art.replaceWith(
        el('img', { class: 'art', src: this.urls.get(id)!, alt: '', loading: 'lazy' }),
      );
  }

  coverUrl(id: string): string | undefined {
    return this.urls.get(id);
  }

  setMatches(ids: Set<string> | null): void {
    for (const [id, tile] of this.tiles) tile.classList.toggle('dim', ids !== null && !ids.has(id));
  }

  setPlaying(id: string | null): void {
    for (const [tid, tile] of this.tiles) tile.classList.toggle('playing', tid === id);
  }

  focus(id: string): void {
    const tile = this.tiles.get(id);
    tile?.focus();
    tile?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  forgetCovers(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
