import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { mix } from '../art/colour';
import { canvas, ctx2d } from '../art/draw';
import { paintSpine, type SpineText } from '../art/spine';
import { DIM } from './layout';
import { recordFace } from './textures';

export const RECORD_RADIUS = 0.1505;
const RECORD_THICK = 0.0018;

/** A texture from a canvas or a decoded image (drawn through a canvas: WebGL ignores flipY for bitmaps). */
function tex(c: HTMLCanvasElement | ImageBitmap): Texture {
  let source: HTMLCanvasElement;
  if (c instanceof HTMLCanvasElement) source = c;
  else {
    source = canvas(c.width, c.height);
    ctx2d(source).drawImage(c, 0, 0);
  }
  const t = new CanvasTexture(source);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A record: black vinyl with grooves, its label in the middle, a clear-coat sheen. */
export function makeRecord(label: HTMLCanvasElement | null, labelColour: string): Mesh {
  const face = recordFace(label, labelColour);
  const vinyl = new MeshPhysicalMaterial({
    map: face,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.35,
  });
  const edge = new MeshStandardMaterial({ color: '#0a0a0b', roughness: 0.4 });
  const m = new Mesh(new CylinderGeometry(RECORD_RADIUS, RECORD_RADIUS, RECORD_THICK, 128), [
    edge,
    vinyl,
    vinyl,
  ]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export interface HeroArt {
  spine: SpineText;
  front: HTMLCanvasElement | ImageBitmap;
  back: HTMLCanvasElement;
  label: HTMLCanvasElement;
  thickness: number;
}

/**
 * The record in your hands: the sleeve with its real cover, back and spine, and the disc inside.
 * Its box has the same orientation as a record on the shelf (spine towards +z, front cover +x),
 * so it can start exactly where the shelf's copy stood.
 */
export class Hero {
  readonly group = new Group();
  readonly sleeve: Mesh;
  record: Mesh;
  private textures: Texture[] = [];

  constructor(art: HeroArt) {
    const spineCanvas = canvas(64, 1024);
    paintSpine(ctx2d(spineCanvas), 0, 0, 64, 1024, art.spine);
    const board = new Color(mix(art.spine.colour, '#d8cdbb', 0.35));
    const front = tex(art.front);
    const back = tex(art.back);
    const spine = tex(spineCanvas);
    this.textures.push(front, back, spine);
    const paper = (map?: Texture, rough = 0.7): MeshStandardMaterial =>
      new MeshStandardMaterial(map ? { map, roughness: rough } : { color: board, roughness: 0.85 });
    this.sleeve = new Mesh(new BoxGeometry(art.thickness, DIM.sleeve, DIM.sleeve), [
      paper(front, 0.55),
      paper(back, 0.75),
      paper(),
      paper(),
      paper(spine, 0.7),
      new MeshStandardMaterial({ color: board.clone().multiplyScalar(0.55), roughness: 0.9 }),
    ]);
    this.sleeve.castShadow = true;
    this.sleeve.receiveShadow = true;
    this.group.add(this.sleeve);
    this.record = makeRecord(art.label, art.spine.colour);
    // Inside the sleeve, standing in the same plane as the cover.
    this.record.rotation.z = Math.PI / 2;
    this.record.visible = false;
    this.sleeve.add(this.record);
  }

  dispose(): void {
    for (const t of this.textures) t.dispose();
    this.sleeve.geometry.dispose();
    for (const m of this.sleeve.material as MeshStandardMaterial[]) m.dispose();
  }
}
