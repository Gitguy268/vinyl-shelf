import {
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { canvas, ctx2d } from '../art/draw';
import { paintSpine, type SpineText } from '../art/spine';
import { DIM, type ShelfLayout } from './layout';

/** Spine cells in the atlas: across the spine, and along it. */
export const CELL_W = 24;
export const CELL_H = 384;
const ATLAS_W = 4096;
const PER_ROW = Math.floor(ATLAS_W / CELL_W);
const MAX_ROWS = Math.floor(4096 / CELL_H);
const PER_ATLAS = PER_ROW * MAX_ROWS;

/** One batch of sleeves that share an atlas texture. */
class Batch {
  readonly mesh: InstancedMesh;
  readonly atlas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  readonly g: CanvasRenderingContext2D;
  readonly state: InstancedBufferAttribute;
  readonly colour: InstancedBufferAttribute;
  dirty = false;

  constructor(count: number, material: (tex: CanvasTexture) => MeshStandardMaterial) {
    const rows = Math.max(1, Math.ceil(count / PER_ROW));
    // A power-of-two height keeps mipmaps sharp everywhere.
    const h = 2 ** Math.ceil(Math.log2(rows * CELL_H));
    this.atlas = canvas(ATLAS_W, h);
    this.g = ctx2d(this.atlas);
    this.texture = new CanvasTexture(this.atlas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.anisotropy = 8;
    const geo = new BoxGeometry(1, 1, 1);
    // Mark the +z face (the spine) so the shader can paint it from the atlas.
    const face = new Float32Array(geo.attributes.position!.count);
    for (let i = 16; i < 20; i++) face[i] = 1;
    geo.setAttribute('aFace', new BufferAttribute(face, 1));
    const rects = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const col = i % PER_ROW;
      const row = Math.floor(i / PER_ROW);
      // UV rect of the cell; v runs up, the canvas runs down.
      rects.set(
        [
          (col * CELL_W) / ATLAS_W,
          1 - ((row + 1) * CELL_H) / h,
          ((col + 1) * CELL_W) / ATLAS_W,
          1 - (row * CELL_H) / h,
        ],
        i * 4,
      );
    }
    geo.setAttribute('aSpine', new InstancedBufferAttribute(rects, 4));
    this.state = new InstancedBufferAttribute(new Float32Array(count * 2), 2);
    this.state.setUsage(DynamicDrawUsage);
    geo.setAttribute('aState', this.state);
    this.colour = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    geo.setAttribute('aColour', this.colour);
    this.mesh = new InstancedMesh(geo, material(this.texture), count);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  paint(i: number, s: SpineText): void {
    const col = i % PER_ROW;
    const row = Math.floor(i / PER_ROW);
    paintSpine(this.g, col * CELL_W, row * CELL_H, CELL_W, CELL_H, s);
    const c = new Color(s.colour);
    this.colour.setXYZ(i, c.r, c.g, c.b);
    this.colour.needsUpdate = true;
    this.dirty = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.texture.dispose();
  }
}

function sleeveMaterial(atlas: CanvasTexture): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ roughness: 0.78, metalness: 0 });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uAtlas = { value: atlas };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aFace;
attribute vec4 aSpine;
attribute vec2 aState;
attribute vec3 aColour;
varying float vFace;
varying vec2 vSpineUv;
varying vec2 vState;
varying vec3 vColour;
varying vec2 vBoxUv;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
vFace = aFace;
vSpineUv = mix(aSpine.xy, aSpine.zw, uv);
vState = aState;
vColour = aColour;
vBoxUv = uv;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uAtlas;
varying float vFace;
varying vec2 vSpineUv;
varying vec2 vState;
varying vec3 vColour;
varying vec2 vBoxUv;`,
      )
      .replace(
        '#include <map_fragment>',
        `if (vFace > 0.5) {
  diffuseColor.rgb = texture2D(uAtlas, vSpineUv).rgb;
} else {
  // Sleeve board: the cover's colour, a little worn towards the edges.
  float edge = smoothstep(0.0, 0.08, min(min(vBoxUv.x, 1.0 - vBoxUv.x), min(vBoxUv.y, 1.0 - vBoxUv.y)));
  diffuseColor.rgb = mix(vColour * 0.55 + 0.12, vColour, edge);
}
// Search: what does not match goes dark and grey.
float grey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grey) * 0.25, vState.x);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vState.y * 0.35;`,
      );
  };
  m.customProgramCacheKey = () => 'vinyl-shelf-sleeve';
  return m;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3();

/**
 * All the records on the shelf. Each album has one instance; divider cards are separate (few).
 * `pullOut` slides a record towards you (hover, focus, search hit); hidden records (the one in
 * your hands) are scaled to nothing.
 */
export class Sleeves {
  readonly batches: Batch[] = [];
  private slotByAlbum: number[] = [];
  private out: Float32Array;
  private outTarget: Float32Array;
  private hidden = new Set<number>();
  private layout: ShelfLayout;

  constructor(layout: ShelfLayout) {
    this.layout = layout;
    const n = layout.slotOf.length;
    this.slotByAlbum = layout.slotOf;
    this.out = new Float32Array(n);
    this.outTarget = new Float32Array(n);
    for (let start = 0; start < n || start === 0; start += PER_ATLAS) {
      const count = Math.max(1, Math.min(PER_ATLAS, n - start));
      this.batches.push(new Batch(count, sleeveMaterial));
      if (n === 0) break;
    }
    for (let i = 0; i < n; i++) this.place(i);
    for (const b of this.batches) {
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.computeBoundingSphere();
    }
  }

  private at(album: number): [Batch, number] {
    return [this.batches[Math.floor(album / PER_ATLAS)]!, album % PER_ATLAS];
  }

  /** The album index an instance of a batch mesh stands for. */
  albumOf(mesh: object, instance: number): number | null {
    const b = this.batches.findIndex((batch) => batch.mesh === mesh);
    return b < 0 ? null : b * PER_ATLAS + instance;
  }

  paint(album: number, s: SpineText): void {
    const [b, i] = this.at(album);
    b.paint(i, s);
  }

  /** Uploads repainted atlases; call at most a few times a second. */
  flush(): boolean {
    let any = false;
    for (const b of this.batches)
      if (b.dirty) {
        b.texture.needsUpdate = true;
        b.dirty = false;
        any = true;
      }
    return any;
  }

  /** The pose of a record on the shelf, `out` metres pulled towards you. */
  pose(album: number, out = 0): { position: Vector3; quaternion: Quaternion; scale: Vector3 } {
    const slot = this.layout.slots[this.slotByAlbum[album]!]!;
    tmpE.set(0, slot.yaw, slot.lean);
    return {
      position: new Vector3(slot.x, slot.y, slot.z + out),
      quaternion: new Quaternion().setFromEuler(tmpE),
      scale: new Vector3(slot.thickness, DIM.sleeve, DIM.sleeve),
    };
  }

  private place(album: number): void {
    const [b, i] = this.at(album);
    const slot = this.layout.slots[this.slotByAlbum[album]!]!;
    tmpE.set(0, slot.yaw, slot.lean);
    tmpQ.setFromEuler(tmpE);
    tmpP.set(slot.x, slot.y + this.out[album]! * 0.04, slot.z + this.out[album]!);
    if (this.hidden.has(album)) tmpS.set(0, 0, 0);
    else tmpS.set(slot.thickness, DIM.sleeve, DIM.sleeve);
    tmpM.compose(tmpP, tmpQ, tmpS);
    b.mesh.setMatrixAt(i, tmpM);
  }

  /** How far a record should stand out of the row, in metres. */
  setOut(album: number, metres: number): void {
    if (album >= 0 && album < this.outTarget.length) this.outTarget[album] = metres;
  }

  clearOut(): void {
    this.outTarget.fill(0);
  }

  /** Records taken off the shelf (in your hands, or standing by the turntable) are not drawn here. */
  setHidden(albums: readonly number[]): void {
    const before = [...this.hidden];
    this.hidden = new Set(albums.filter((a) => a >= 0 && a < this.out.length));
    for (const a of [...before, ...this.hidden]) if (a < this.out.length) this.place(a);
    for (const b of this.batches) b.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Search: 1 dims a record, 0 shows it; `glow` lights the one playing. */
  setState(album: number, dim: number, glow: number): void {
    const [b, i] = this.at(album);
    b.state.setXY(i, dim, glow);
    b.state.needsUpdate = true;
  }

  /** Eases records towards their target positions; true while any is moving. */
  tick(dt: number): boolean {
    let moving = false;
    const k = 1 - Math.exp(-dt * 14);
    const touched = new Set<Batch>();
    for (let a = 0; a < this.out.length; a++) {
      const d = this.outTarget[a]! - this.out[a]!;
      if (Math.abs(d) < 1e-5) continue;
      this.out[a] = Math.abs(d) < 1e-4 ? this.outTarget[a]! : this.out[a]! + d * k;
      this.place(a);
      touched.add(this.at(a)[0]);
      moving = true;
    }
    for (const b of touched) b.mesh.instanceMatrix.needsUpdate = true;
    return moving;
  }

  dispose(): void {
    for (const b of this.batches) b.dispose();
  }
}
