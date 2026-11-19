import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  SpotLight,
  Vector2,
  type Object3D,
} from 'three';
import { floorboards, oak, plaster } from './textures';
import { DIM, type ShelfLayout } from './layout';

export type Light = 'dusk' | 'day';

/** The room around the shelf: wall, floor, skirting, a floor lamp, and the light from a window. */
export class Room {
  readonly group = new Group();
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private lamp: SpotLight;
  private glow: PointLight;
  private shade: MeshStandardMaterial;
  private wall: MeshStandardMaterial;
  private lampGroup = new Group();

  constructor() {
    const wallTex = plaster([226, 214, 196]);
    wallTex.map.repeat.set(6, 2);
    wallTex.bump.repeat.set(6, 2);
    this.wall = new MeshStandardMaterial({
      map: wallTex.map,
      bumpMap: wallTex.bump,
      bumpScale: 0.6,
      roughness: 0.95,
    });
    const wall = new Mesh(new PlaneGeometry(16, 3.2), this.wall);
    wall.position.set(0, 1.6, 0);
    wall.receiveShadow = true;
    this.group.add(wall);

    const boards = floorboards();
    boards.map.repeat.set(5, 5);
    boards.bump.repeat.set(5, 5);
    const floor = new Mesh(
      new PlaneGeometry(16, 8),
      new MeshStandardMaterial({
        map: boards.map,
        bumpMap: boards.bump,
        bumpScale: 1.2,
        roughness: 0.55,
        metalness: 0,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 4);
    floor.receiveShadow = true;
    this.group.add(floor);

    const skirting = new Mesh(
      new BoxGeometry(16, 0.09, 0.018),
      new MeshStandardMaterial({ color: '#efe9df', roughness: 0.6 }),
    );
    skirting.position.set(0, 0.045, 0.009);
    skirting.receiveShadow = true;
    this.group.add(skirting);

    // Floor lamp: a round base, a brass stem and a linen drum shade.
    const brass = new MeshStandardMaterial({ color: '#b08a4f', metalness: 0.85, roughness: 0.35 });
    const base = new Mesh(new CylinderGeometry(0.15, 0.16, 0.025, 48), brass);
    base.position.y = 0.0125;
    const stem = new Mesh(new CylinderGeometry(0.009, 0.009, 1.5, 16), brass);
    stem.position.y = 0.76;
    this.shade = new MeshStandardMaterial({
      color: '#efe2c8',
      emissive: new Color('#ffc58a'),
      emissiveIntensity: 1.4,
      roughness: 0.9,
      side: DoubleSide,
    });
    const profile = [new Vector2(0.24, -0.15), new Vector2(0.2, 0.15)];
    const shade = new Mesh(new LatheGeometry(profile, 64), this.shade);
    shade.position.y = 1.52;
    for (const m of [base, stem, shade]) {
      m.castShadow = m !== shade;
      this.lampGroup.add(m);
    }
    this.lamp = new SpotLight('#ffcf9a', 6, 6, 1.25, 1, 1.6);
    this.lamp.position.set(0, 1.5, 0);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.bias = -0.0004;
    this.lamp.shadow.radius = 6;
    this.lampGroup.add(this.lamp, this.lamp.target);
    this.glow = new PointLight('#ffb978', 1.2, 4, 1.8);
    this.glow.position.set(0, 1.68, 0);
    this.lampGroup.add(this.glow);
    this.group.add(this.lampGroup);

    this.hemi = new HemisphereLight('#f4ead9', '#6a4c33', 0.5);
    this.group.add(this.hemi);
    this.sun = new DirectionalLight('#fff1dc', 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.01;
    this.sun.shadow.radius = 4;
    this.group.add(this.sun, this.sun.target);
  }

  /** Puts the lamp beside the shelf and aims the window light at it. */
  fit(layout: ShelfLayout): void {
    const left = -layout.width / 2;
    this.lampGroup.position.set(left - 0.5, 0, 0.7);
    this.lamp.target.position.set(0.7, 0.25, 0.1);
    this.sun.position.set(layout.width / 2 + 2.5, 3.2, 3.4);
    this.sun.target.position.set(0, layout.height / 2, 0);
    const cam = this.sun.shadow.camera;
    const half = Math.max(layout.width, layout.height) / 2 + 0.6;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 0.5;
    cam.far = 10;
    cam.updateProjectionMatrix();
  }

  setLight(mode: Light): void {
    const dusk = mode === 'dusk';
    this.sun.color.set(dusk ? '#ff9e5e' : '#fff3e2');
    this.sun.intensity = dusk ? 0.45 : 2.6;
    this.hemi.intensity = dusk ? 0.18 : 0.75;
    this.hemi.color.set(dusk ? '#9fb3d9' : '#f4ead9');
    this.lamp.intensity = dusk ? 6.5 : 2;
    this.glow.intensity = dusk ? 0.55 : 0.2;
    this.shade.emissiveIntensity = dusk ? 1.6 : 0.35;
    this.wall.color.set(dusk ? '#e3d6c4' : '#f2ebe0');
  }

  get objects(): Object3D[] {
    return [this.group];
  }
}

/** The cube shelf: oak boards, no back, so the wall shows through. */
export function shelfFrame(layout: ShelfLayout): Group {
  const g = new Group();
  const along = oak(7);
  const up = oak(9);
  up.center.set(0.5, 0.5);
  up.rotation = Math.PI / 2;
  const matH = new MeshStandardMaterial({ map: along, roughness: 0.62 });
  const matV = new MeshStandardMaterial({ map: up, roughness: 0.62 });
  const { width: W, height: H, rows, cols } = layout;
  const D = DIM.depth;
  const add = (w: number, h: number, x: number, y: number, mat: MeshStandardMaterial): void => {
    const m = new Mesh(new BoxGeometry(w, h, D), mat);
    m.position.set(x, y, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  // Outer frame: top and bottom run the full width, sides between them.
  add(W, DIM.frame, 0, DIM.foot + DIM.frame / 2, matH);
  add(W, DIM.frame, 0, H - DIM.frame / 2, matH);
  add(DIM.frame, H - 2 * DIM.frame, -W / 2 + DIM.frame / 2, H / 2, matV);
  add(DIM.frame, H - 2 * DIM.frame, W / 2 - DIM.frame / 2, H / 2, matV);
  for (let c = 1; c < cols; c++) {
    const x = -W / 2 + DIM.frame + c * DIM.cube + (c - 1) * DIM.board + DIM.board / 2;
    add(DIM.board, H - 2 * DIM.frame, x, H / 2, matV);
  }
  for (let r = 1; r < rows; r++) {
    const y = DIM.foot + DIM.frame + r * DIM.cube + (r - 1) * DIM.board + DIM.board / 2;
    add(W - 2 * DIM.frame, DIM.board, 0, y, matH);
  }
  return g;
}
