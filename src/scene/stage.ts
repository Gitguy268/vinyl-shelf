import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { canvas, ctx2d, SANS } from '../art/draw';
import type { SpineText } from '../art/spine';
import type { Album, SortKey } from '../library/types';
import { Hero, type HeroArt } from './hero';
import { decorate } from './decor';
import { DIM, layoutShelf, type ShelfLayout } from './layout';
import { Rig } from './rig';
import { Room, shelfFrame, type Light } from './room';
import { Sleeves } from './sleeves';
import { Turntable } from './turntable';
import { Tweens, ease, type Pose } from './tween';
import { World, type Quality } from './world';

export interface StageEvents {
  /** The pointer is over a record (or nothing): album index and page position. */
  hover(album: number | null, x: number, y: number): void;
  /** A record was clicked. */
  pick(album: number): void;
  /** The record in your hands was clicked. */
  heroClick(): void;
}

const SHELF_Z = DIM.depth / 2;

/** The 3D shelf: everything the page shows in the canvas, and how it moves. */
export class Stage {
  readonly world: World;
  private room = new Room();
  private rig: Rig;
  private tweens = new Tweens();
  private shelf = new Group();
  private frame: Group | null = null;
  private decor: Group | null = null;
  private sleeves: Sleeves | null = null;
  private dividers = new Group();
  private turntable = new Turntable();
  private layout: ShelfLayout | null = null;
  private albums: Album[] = [];
  private indexOf = new Map<string, number>();
  private hero: { id: string; hero: Hero; flipped: boolean } | null = null;
  private standing: { id: string; hero: Hero } | null = null;
  private hoverIdx: number | null = null;
  private focusIdx: number | null = null;
  private matches: Set<string> | null = null;
  private playingId: string | null = null;
  private ray = new Raycaster();
  private events: StageEvents;
  private flushAt = 0;

  constructor(canvasEl: HTMLCanvasElement, quality: Quality, events: StageEvents) {
    this.events = events;
    this.world = new World(canvasEl, quality);
    this.rig = new Rig(this.world.camera);
    this.shelf.position.z = SHELF_Z;
    this.world.scene.add(this.room.group, this.shelf, this.turntable.group);
    this.shelf.add(this.dividers);
    this.world.addTicker((dt) => this.tick(dt));
    this.bindInput(canvasEl);
  }

  setReducedMotion(on: boolean): void {
    this.tweens.instant = on;
    this.rig.reduced = on;
  }

  setLight(mode: Light): void {
    this.room.setLight(mode);
    this.world.shadowsChanged();
  }

  /** Lays the shelf out again for these albums in this order. */
  setAlbums(albums: Album[], sort: SortKey, spines: (album: Album) => SpineText): void {
    const keepView = this.layout !== null && this.albums.length > 0;
    this.albums = albums;
    this.indexOf = new Map(albums.map((a, i) => [a.id, i]));
    this.layout = layoutShelf(albums, sort);
    this.sleeves?.batches.forEach((b) => this.shelf.remove(b.mesh));
    this.sleeves?.dispose();
    if (this.frame) this.shelf.remove(this.frame);
    this.frame = shelfFrame(this.layout);
    this.shelf.add(this.frame);
    if (this.decor) this.shelf.remove(this.decor);
    this.decor = decorate(this.layout);
    this.shelf.add(this.decor);
    this.sleeves = new Sleeves(this.layout);
    for (const b of this.sleeves.batches) this.shelf.add(b.mesh);
    albums.forEach((a, i) => this.sleeves!.paint(i, spines(a)));
    this.sleeves.flush();
    this.buildDividers(this.layout);
    this.room.fit(this.layout);
    this.turntable.group.position.set(
      this.layout.width >= 1.1 ? this.layout.width / 2 - 0.3 : 0,
      this.layout.height,
      SHELF_Z + 0.012,
    );
    this.rig.fit(this.layout, DIM.depth, !keepView);
    this.hoverIdx = null;
    this.focusIdx = null;
    this.refreshHidden();
    this.refreshStates();
    // The record standing by the turntable goes back to its place in the new order.
    if (this.standing) this.placeStanding(this.standing.hero, false);
    this.world.shadowsChanged();
  }

  /** Repaints one spine (its cover's colours arrived). */
  paintSpine(albumId: string, spine: SpineText): void {
    const i = this.indexOf.get(albumId);
    if (i === undefined || !this.sleeves) return;
    this.sleeves.paint(i, spine);
    this.world.wake(400);
  }

  private buildDividers(layout: ShelfLayout): void {
    for (const child of [...this.dividers.children]) {
      child.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          for (const mat of [m.material].flat()) {
            (mat as MeshStandardMaterial).map?.dispose();
            mat.dispose();
          }
        }
      });
      this.dividers.remove(child);
    }
    const kraft = new MeshStandardMaterial({ color: '#c8b28a', roughness: 0.9 });
    for (const slot of layout.slots) {
      if (slot.album >= 0) continue;
      const card = new Mesh(new BoxGeometry(slot.thickness, DIM.sleeve, DIM.sleeve + 0.01), kraft);
      card.position.set(slot.x, slot.y, slot.z);
      card.rotation.set(0, 0, slot.lean);
      card.castShadow = true;
      // The tab: a little label standing just above the records at the front, facing the room.
      const c = canvas(128, 40);
      const g = ctx2d(c);
      g.fillStyle = '#f3ead8';
      g.fillRect(0, 0, 128, 40);
      g.fillStyle = '#2a2018';
      g.font = `800 ${slot.label.length > 3 ? 20 : 30}px ${SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(slot.label.slice(0, 12), 64, 22, 122);
      const t = new CanvasTexture(c);
      t.colorSpace = SRGBColorSpace;
      const face = new MeshStandardMaterial({ map: t, roughness: 0.7 });
      const edge = new MeshStandardMaterial({ color: '#efe4cf', roughness: 0.7 });
      const tab = new Mesh(new BoxGeometry(0.05, 0.0156, 0.0016), [
        edge,
        edge,
        edge,
        edge,
        face,
        edge,
      ]);
      tab.position.set(0, DIM.sleeve / 2 + 0.0088, DIM.sleeve / 2 - 0.018);
      card.add(tab);
      this.dividers.add(card);
    }
  }

  // ─── Search, focus, playing ─────────────────────────────────────

  setMatches(ids: Set<string> | null): void {
    this.matches = ids && ids.size > 0 ? ids : ids;
    this.refreshStates();
    const first = ids ? this.albums.findIndex((a) => ids.has(a.id)) : -1;
    if (first >= 0) this.focusOn(first, false);
  }

  setPlaying(id: string | null, playing: boolean): void {
    this.playingId = id;
    this.turntable.setPlaying(playing);
    this.refreshStates();
    this.world.wake(300);
  }

  private refreshStates(): void {
    if (!this.sleeves) return;
    this.sleeves.clearOut();
    this.albums.forEach((a, i) => {
      const dim = this.matches ? (this.matches.has(a.id) ? 0 : 1) : 0;
      this.sleeves!.setState(i, dim, a.id === this.playingId ? 1 : 0);
      if (this.matches?.has(a.id)) this.sleeves!.setOut(i, 0.012);
    });
    if (this.hoverIdx !== null) this.sleeves.setOut(this.hoverIdx, 0.028);
    if (this.focusIdx !== null) this.sleeves.setOut(this.focusIdx, 0.028);
    this.world.wake(600);
  }

  private refreshHidden(): void {
    const hidden = [this.hero?.id, this.standing?.id]
      .map((id) => (id ? (this.indexOf.get(id) ?? -1) : -1))
      .filter((i) => i >= 0);
    this.sleeves?.setHidden(hidden);
    this.world.shadowsChanged();
  }

  /** Keyboard focus: the record stands out and the camera comes closer. */
  focusOn(album: number | null, zoom = true): void {
    this.focusIdx = album;
    this.refreshStates();
    if (album === null || !this.sleeves) return;
    const p = this.sleeves.pose(album).position;
    this.rig.lookAt(p.x, p.y, zoom ? Math.min(1.25, this.rig.zoomedIn ? 1.25 : 1.6) : undefined);
    this.world.wake(1200);
  }

  get focused(): number | null {
    return this.focusIdx;
  }

  /** The album to the left/right of `album` on the shelf, or up/down a row. */
  neighbour(album: number, dir: 'left' | 'right' | 'up' | 'down'): number {
    if (!this.layout || this.albums.length === 0) return 0;
    if (dir === 'left') return Math.max(0, album - 1);
    if (dir === 'right') return Math.min(this.albums.length - 1, album + 1);
    const slots = this.layout.slots;
    const here = slots[this.layout.slotOf[album]!]!;
    const rowH = DIM.cube + DIM.board;
    const want = here.y + (dir === 'up' ? rowH : -rowH);
    let best = album;
    let bestD = Infinity;
    this.layout.slotOf.forEach((s, i) => {
      const slot = slots[s]!;
      if (Math.abs(slot.y - want) > rowH / 2) return;
      const d = Math.abs(slot.x - here.x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  overview(): void {
    this.rig.overview();
    this.world.wake(1500);
  }

  zoom(factor: number): void {
    this.rig.zoom(factor);
    this.world.wake(900);
  }

  pan(dx: number, dy: number): void {
    this.rig.pan(dx, dy);
    this.world.wake(900);
  }

  /** Fractions of the view the panels cover, right and bottom (the view shifts into the rest). */
  setInset(right: number, bottom = 0): void {
    this.world.setInset(right, bottom);
    if (this.hero) void this.move(this.hero.hero.sleeve, this.presentPose(this.hero.flipped), 420);
  }

  // ─── The record in your hands ───────────────────────────────────

  /** A tween that also wakes the renderer (it sleeps when nothing moves). */
  private move(...args: Parameters<Tweens['to']>): Promise<void> {
    this.world.wake();
    return this.tweens.to(...args);
  }

  private shelfPose(album: number, out = 0): Pose {
    const local = this.sleeves!.pose(album, out);
    return {
      position: local.position.clone().add(this.shelf.position),
      quaternion: local.quaternion,
    };
  }

  /** In front of the camera, cover towards you, sized to fit the free part of the view. */
  private presentPose(flipped: boolean): Pose {
    const cam = this.world.camera;
    cam.updateMatrixWorld();
    const tan = Math.tan((cam.fov * Math.PI) / 360);
    // The camera's frustum is the larger, offset view (World.resize): the free part of it is a
    // fraction of its height and width.
    const w = this.world.canvas.clientWidth;
    const h = Math.max(1, this.world.canvas.clientHeight);
    const sx = this.world.insetRight * w;
    const sy = this.world.insetBottom * h;
    const freeH = (h - sy) / (h + sy);
    const freeW = ((w - sx) / (w + sx)) * cam.aspect;
    const d = Math.max(
      (DIM.sleeve * 1.65) / (2 * tan * Math.max(freeH, 0.15)),
      (DIM.sleeve * 1.35) / (2 * tan * Math.max(freeW, 0.15)),
    );
    const forward = cam.getWorldDirection(new Vector3());
    const position = cam.position.clone().addScaledVector(forward, d);
    const toCam = forward.clone().negate();
    const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    // Turned a little, as you would hold it: the spine edge catches the light.
    toCam.applyAxisAngle(up, flipped ? 0.1 : -0.1);
    const x = flipped ? toCam.clone().negate() : toCam;
    const z = new Vector3().crossVectors(x, up).normalize();
    const y = new Vector3().crossVectors(z, x).normalize();
    const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    return { position, quaternion };
  }

  get holding(): string | null {
    return this.hero?.id ?? null;
  }

  /** Pulls a record out of the shelf and holds it up, cover towards you. */
  async pull(albumId: string, art: HeroArt): Promise<void> {
    const i = this.indexOf.get(albumId);
    if (i === undefined || !this.sleeves) return;
    if (this.hero) await this.putBack();
    const hero = new Hero(art);
    const start = this.shelfPose(i);
    hero.sleeve.position.copy(start.position);
    hero.sleeve.quaternion.copy(start.quaternion);
    this.world.scene.add(hero.group);
    this.hero = { id: albumId, hero, flipped: false };
    this.hoverIdx = null;
    this.refreshHidden();
    this.refreshStates();
    const out = this.shelfPose(i, 0.26);
    out.quaternion = new Quaternion();
    await this.move(hero.sleeve, out, 340, { curve: ease.out });
    if (this.hero?.hero !== hero) return;
    await this.move(hero.sleeve, this.presentPose(false), 620, { arc: 0.04 });
  }

  /** Shows the other side of the sleeve. */
  async flip(): Promise<boolean> {
    if (!this.hero) return false;
    this.hero.flipped = !this.hero.flipped;
    await this.move(this.hero.hero.sleeve, this.presentPose(this.hero.flipped), 520, {
      arc: 0.03,
    });
    return this.hero.flipped;
  }

  /** Puts the record in your hands back in its place. */
  async putBack(): Promise<void> {
    const held = this.hero;
    if (!held) return;
    this.hero = null;
    const i = this.indexOf.get(held.id);
    if (i !== undefined && this.sleeves) {
      const out = this.shelfPose(i, 0.26);
      out.quaternion = new Quaternion();
      await this.move(held.hero.sleeve, out, 480, { arc: 0.03 });
      await this.move(held.hero.sleeve, this.shelfPose(i), 300, { curve: ease.out });
    }
    held.hero.group.removeFromParent();
    held.hero.dispose();
    this.refreshHidden();
  }

  /**
   * The hand-off: the record slides out of its sleeve and onto the turntable on top of the shelf;
   * the sleeve goes to stand against the wall beside it. The record that was there goes home.
   */
  async playHeld(): Promise<void> {
    const held = this.hero;
    if (!held) return;
    this.hero = null;
    const old = this.standing;
    this.standing = { id: held.id, hero: held.hero };
    const disc = held.hero.record;
    disc.visible = true;
    // Out through the open edge (the sleeve's -z side).
    await this.move(
      disc,
      { position: new Vector3(0, 0, -0.2), quaternion: disc.quaternion.clone() },
      520,
      {
        curve: ease.out,
      },
    );
    // Off to the platter, keeping where it is in the world as it changes parent.
    this.world.scene.attach(disc);
    const pose = this.turntable.recordPose();
    this.rig.lookAt(this.turntable.group.position.x, this.turntable.group.position.y + 0.05, 1.6);
    const lifted = {
      position: pose.position.clone().add(new Vector3(0, 0.12, 0.05)),
      quaternion: pose.quaternion,
    };
    const homeOld = old ? this.sendHome(old) : Promise.resolve();
    await this.move(disc, lifted, 820, { arc: 0.18 });
    await this.move(disc, pose, 300, { curve: ease.out });
    this.turntable.load(disc);
    await Promise.all([this.placeStanding(held.hero, true), homeOld]);
    this.refreshHidden();
    // Step back to see the shelf with the record turning on top.
    this.rig.overview();
    this.world.wake(1500);
  }

  private async sendHome(standing: { id: string; hero: Hero }): Promise<void> {
    const i = this.indexOf.get(standing.id);
    if (i !== undefined && this.sleeves) {
      await this.move(standing.hero.sleeve, this.shelfPose(i, 0.2), 700, { arc: 0.1 });
      await this.move(standing.hero.sleeve, this.shelfPose(i), 260);
    }
    standing.hero.group.removeFromParent();
    standing.hero.dispose();
    if (this.standing === standing) this.standing = null;
    this.refreshHidden();
  }

  /**
   * The sleeve of the record that is playing stands cover out, leaning against the wall: on top of
   * the shelf beside the turntable, or on the floor beside a shelf too narrow for both.
   */
  private placeStanding(hero: Hero, animate: boolean): Promise<void> {
    if (!this.layout) return Promise.resolve();
    const tilt = -0.16;
    const onTop = this.layout.width >= 1.1;
    const half = DIM.sleeve / 2;
    const x = onTop ? this.turntable.group.position.x - 0.43 : this.layout.width / 2 + 0.26;
    const floor = onTop ? this.layout.height : 0;
    const position = new Vector3(
      x,
      floor + half * Math.cos(tilt) + 0.002,
      0.012 + half * Math.sin(-tilt),
    );
    // Cover towards the room (+x of the sleeve turned to +z), top leaning back to the wall.
    const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
    quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt));
    const pose = { position, quaternion };
    if (!animate) {
      hero.sleeve.position.copy(position);
      hero.sleeve.quaternion.copy(quaternion);
      return Promise.resolve();
    }
    return this.move(hero.sleeve, pose, 900, { arc: 0.12 });
  }

  /** Takes the record off the turntable (playback stopped and the deck closed). */
  async clearTurntable(): Promise<void> {
    this.turntable.setPlaying(false);
    if (this.standing) await this.sendHome(this.standing);
    this.turntable.load(null);
    this.playingId = null;
    this.refreshStates();
  }

  // ─── Input ──────────────────────────────────────────────────────

  private pickAt(x: number, y: number): { album: number | null; hero: boolean } {
    const rect = this.world.canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.world.camera);
    const targets: Object3D[] = [...(this.sleeves?.batches.map((b) => b.mesh) ?? [])];
    if (this.hero) targets.push(this.hero.hero.sleeve);
    const hit = this.ray.intersectObjects(targets, false)[0];
    if (!hit) return { album: null, hero: false };
    if (this.hero && hit.object === this.hero.hero.sleeve) return { album: null, hero: true };
    if (hit.instanceId === undefined) return { album: null, hero: false };
    return { album: this.sleeves!.albumOf(hit.object, hit.instanceId), hero: false };
  }

  private bindInput(el: HTMLCanvasElement): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let dragged = 0;
    let pinch = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [
          { x: number; y: number },
          { x: number; y: number },
        ];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    el.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') this.hoverAt(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [
          { x: number; y: number },
          { x: number; y: number },
        ];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) this.zoom(pinch / d);
        pinch = d;
        dragged = 99;
        return;
      }
      dragged += Math.abs(dx) + Math.abs(dy);
      if (dragged > 6 && !this.hero) {
        const h = el.clientHeight;
        this.pan(dx / h, dy / h);
        this.setHover(null, 0, 0);
      }
    });
    const end = (e: PointerEvent): void => {
      const was = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (!was || dragged > 6 || e.type === 'pointercancel') return;
      const hit = this.pickAt(e.clientX, e.clientY);
      if (hit.hero) this.events.heroClick();
      else if (hit.album !== null) this.events.pick(hit.album);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => this.setHover(null, 0, 0));
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.hero) return;
        // Trackpads scroll sideways along the shelf; a wheel (or pinch with ctrl) zooms.
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
          this.pan((e.shiftKey ? e.deltaY : e.deltaX) / el.clientHeight, 0);
        } else {
          this.zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
        }
      },
      { passive: false },
    );
  }

  private hoverAt(x: number, y: number): void {
    if (this.tweens.busy && this.hero) return;
    const hit = this.pickAt(x, y);
    this.world.canvas.style.cursor = hit.album !== null || hit.hero ? 'pointer' : 'grab';
    this.setHover(hit.album, x, y);
  }

  private setHover(album: number | null, x: number, y: number): void {
    if (album !== this.hoverIdx) {
      this.hoverIdx = album;
      this.refreshStates();
    }
    this.events.hover(album, x, y);
  }

  // ─── Frame ──────────────────────────────────────────────────────

  private tick(dt: number): boolean {
    let busy = this.rig.tick(dt);
    if (this.sleeves?.tick(dt)) {
      busy = true;
      this.world.shadowsChanged();
    }
    if (this.tweens.tick(dt)) {
      busy = true;
      this.world.renderer.shadowMap.needsUpdate = true;
    }
    if (this.turntable.tick(dt)) busy = true;
    const now = performance.now();
    if (this.sleeves && now > this.flushAt) {
      this.flushAt = now + 300;
      if (this.sleeves.flush()) busy = true;
    }
    return busy;
  }

  /** For tests: where an album's spine is on the page. */
  spineOnPage(album: number): [number, number] | null {
    if (!this.sleeves) return null;
    const p = this.shelfPose(album).position.clone();
    p.z += DIM.sleeve / 2;
    p.project(this.world.camera);
    const rect = this.world.canvas.getBoundingClientRect();
    return [rect.left + ((p.x + 1) / 2) * rect.width, rect.top + ((1 - p.y) / 2) * rect.height];
  }
}
