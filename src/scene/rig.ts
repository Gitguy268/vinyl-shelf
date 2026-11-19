import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { DIM, type ShelfLayout } from './layout';

/**
 * The camera stands in the room facing the shelf. It looks at a point on the shelf (x along it,
 * y up it) from a distance, a little from above and to the side, and eases towards where it is
 * asked to go.
 */
export class Rig {
  private target = new Vector3(0, 0.8, 0);
  private distance = 2.5;
  private goalTarget = new Vector3(0, 0.8, 0);
  private goalDistance = 2.5;
  private bounds = { x0: -1, x1: 1, y0: 0.2, y1: 1.4, near: 0.55, far: 4 };
  private camera: PerspectiveCamera;
  /** The z of the shelf's front edge. */
  private front = DIM.depth;
  reduced = false;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  /** Distance at which a box `w` by `h` metres fills the view. */
  private fitDistance(w: number, h: number): number {
    const v = MathUtils.degToRad(this.camera.fov) / 2;
    const byH = h / 2 / Math.tan(v);
    const byW = w / 2 / (Math.tan(v) * Math.max(this.camera.aspect, 0.3));
    return Math.max(byH, byW);
  }

  /** New bounds for a shelf; `reset` also moves the camera back to the overview. */
  fit(layout: ShelfLayout, front: number, reset = true): void {
    this.front = front;
    const margin = 0.25;
    this.bounds = {
      x0: -layout.width / 2 + 0.15,
      x1: layout.width / 2 - 0.15,
      y0: 0.18,
      y1: Math.max(0.3, layout.height + 0.05),
      near: 0.5,
      far: Math.max(
        1.3,
        Math.min(this.fitDistance(layout.width + margin, layout.height + 0.35), 5.5),
      ),
    };
    if (!reset) {
      this.clamp();
      return;
    }
    this.overview();
    this.target.copy(this.goalTarget);
    this.distance = this.goalDistance;
  }

  /** The whole shelf, or as much of a long one as fits from across the room. */
  overview(): void {
    this.goalTarget.set(0, (this.bounds.y0 + this.bounds.y1) / 2, 0);
    this.goalDistance = this.bounds.far;
    this.clamp();
  }

  /** Looks at a point on the shelf from `distance` metres. */
  lookAt(x: number, y: number, distance = this.goalDistance): void {
    this.goalTarget.set(x, y, 0);
    this.goalDistance = distance;
    this.clamp();
  }

  pan(dx: number, dy: number): void {
    const k = this.goalDistance * 0.9;
    this.goalTarget.x -= dx * k;
    this.goalTarget.y += dy * k;
    this.clamp();
  }

  zoom(factor: number): void {
    this.goalDistance *= factor;
    this.clamp();
  }

  get zoomedIn(): boolean {
    return this.goalDistance < this.bounds.far * 0.6;
  }

  get focus(): Vector3 {
    return this.goalTarget.clone();
  }

  private clamp(): void {
    // The closer you stand, the further along the shelf you may look.
    const t = this.goalTarget;
    t.x = MathUtils.clamp(t.x, this.bounds.x0, this.bounds.x1);
    t.y = MathUtils.clamp(t.y, this.bounds.y0, this.bounds.y1);
    this.goalDistance = MathUtils.clamp(this.goalDistance, this.bounds.near, this.bounds.far);
    if (this.goalDistance >= this.bounds.far * 0.98)
      t.x = MathUtils.clamp(t.x, this.bounds.x0 * 0.2, this.bounds.x1 * 0.2);
  }

  /** Moves the camera a step towards its goal; true while still moving. */
  tick(dt: number): boolean {
    const k = this.reduced ? 1 : 1 - Math.exp(-dt * 6);
    const before = this.target.clone();
    const d0 = this.distance;
    this.target.lerp(this.goalTarget, k);
    this.distance += (this.goalDistance - this.distance) * k;
    this.apply();
    return before.distanceToSquared(this.target) > 1e-9 || Math.abs(d0 - this.distance) > 1e-5;
  }

  apply(): void {
    const d = this.distance;
    // Standing a little to the right and above eye level of the target, as you would.
    const side = 0.06 * d;
    const lift = 0.1 * d + 0.04;
    this.camera.position.set(this.target.x + side, this.target.y + lift, this.front + d);
    this.camera.lookAt(this.target.x, this.target.y, this.front * 0.4);
  }
}
