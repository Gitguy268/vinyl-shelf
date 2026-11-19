import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import { walnut } from './textures';

const RPM = 100 / 3;

/**
 * A turntable on top of the shelf: walnut plinth, aluminium platter, a straight arm. When an album
 * goes to a player, its record lands here and turns while the player plays it.
 */
export class Turntable {
  readonly group = new Group();
  readonly platter = new Group();
  private arm = new Group();
  private armAngle = 0;
  private armTarget = 0;
  playing = false;
  private record: Object3D | null = null;

  constructor() {
    const wood = new MeshStandardMaterial({ map: walnut(), roughness: 0.5 });
    const alu = new MeshStandardMaterial({ color: '#c9ccd1', metalness: 0.9, roughness: 0.32 });
    const black = new MeshStandardMaterial({ color: '#141414', roughness: 0.6 });
    const plinth = new Mesh(new BoxGeometry(0.45, 0.085, 0.36), wood);
    plinth.position.y = 0.0425;
    const plate = new Mesh(
      new BoxGeometry(0.43, 0.004, 0.34),
      new MeshStandardMaterial({ color: '#1c1b1a', roughness: 0.45, metalness: 0.3 }),
    );
    plate.position.y = 0.087;
    const feet = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => {
        const f = new Mesh(new CylinderGeometry(0.02, 0.022, 0.012, 24), black);
        f.position.set(sx * 0.19, -0.006, sz * 0.14);
        return f;
      }),
    );
    const platterBody = new Mesh(new CylinderGeometry(0.152, 0.152, 0.024, 96), alu);
    platterBody.position.y = 0.012;
    const mat = new Mesh(new CylinderGeometry(0.149, 0.149, 0.003, 96), black);
    mat.position.y = 0.0255;
    const spindle = new Mesh(new CylinderGeometry(0.0036, 0.0036, 0.03, 12), alu);
    spindle.position.y = 0.03;
    this.platter.add(platterBody, mat, spindle);
    this.platter.position.set(-0.045, 0.089, 0);
    // Arm: pivot at the back right, resting beside the platter.
    const pivot = new Mesh(new CylinderGeometry(0.018, 0.022, 0.03, 32), alu);
    pivot.position.y = 0.015;
    const tube = new Mesh(new CylinderGeometry(0.0035, 0.0035, 0.23, 12), alu);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.035, 0.115);
    const head = new Mesh(new BoxGeometry(0.018, 0.008, 0.03), black);
    head.position.set(0, 0.03, 0.235);
    const counter = new Mesh(new CylinderGeometry(0.014, 0.014, 0.03, 24), black);
    counter.rotation.x = Math.PI / 2;
    counter.position.set(0, 0.035, -0.035);
    this.arm.add(pivot, tube, head, counter);
    this.arm.position.set(0.16, 0.089, -0.12);
    this.group.add(plinth, plate, ...feet, this.platter, this.arm);
    for (const m of [plinth, plate, platterBody, mat, tube, head, pivot, counter]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  }

  /** Where a record lies when it is on the platter, in world space. */
  recordPose(): { position: Vector3; quaternion: Quaternion } {
    this.group.updateMatrixWorld(true);
    const p = new Vector3(0, 0.028, 0);
    this.platter.localToWorld(p);
    return { position: p, quaternion: this.group.getWorldQuaternion(new Quaternion()) };
  }

  /** Takes the record onto the platter (it turns with it from now on). */
  load(record: Object3D | null): void {
    if (this.record && this.record !== record) this.record.removeFromParent();
    this.record = record;
    if (record) {
      record.position.set(0, 0.028, 0);
      record.quaternion.identity();
      this.platter.add(record);
    }
  }

  get hasRecord(): boolean {
    return this.record !== null;
  }

  setPlaying(on: boolean): void {
    this.playing = on && this.record !== null;
    this.armTarget = this.playing ? 0.42 : 0;
  }

  /** Turns the platter at 33⅓ and swings the arm; true while something moves. */
  tick(dt: number): boolean {
    let moving = false;
    if (this.playing) {
      this.platter.rotation.y -= ((RPM * 2 * Math.PI) / 60) * dt;
      moving = true;
    }
    const d = this.armTarget - this.armAngle;
    if (Math.abs(d) > 1e-4) {
      this.armAngle += d * (1 - Math.exp(-dt * 4));
      this.arm.rotation.y = -this.armAngle;
      moving = true;
    }
    return moving;
  }
}
