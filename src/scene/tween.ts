import { Quaternion, Vector3, type Object3D } from 'three';

export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
  scale?: Vector3;
}

export const ease = {
  inOut: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t: number): number => 1 - (1 - t) ** 3,
  in: (t: number): number => t * t * t,
};

interface Run {
  obj: Object3D;
  from: Pose;
  to: Pose;
  ms: number;
  t: number;
  delay: number;
  arc: number;
  curve: (t: number) => number;
  done: () => void;
}

/** Moves objects between poses over time; a newer move of the same object replaces the older one. */
export class Tweens {
  private runs: Run[] = [];
  /** Reduced motion: every move lands at once. */
  instant = false;

  to(
    obj: Object3D,
    to: Pose,
    ms: number,
    opts: { delay?: number; arc?: number; curve?: (t: number) => number } = {},
  ): Promise<void> {
    this.runs = this.runs.filter((r) => {
      if (r.obj !== obj) return true;
      r.done();
      return false;
    });
    return new Promise((done) => {
      this.runs.push({
        obj,
        from: {
          position: obj.position.clone(),
          quaternion: obj.quaternion.clone(),
          scale: obj.scale.clone(),
        },
        to,
        ms: this.instant ? 1 : ms,
        t: 0,
        delay: this.instant ? 0 : (opts.delay ?? 0),
        arc: opts.arc ?? 0,
        curve: opts.curve ?? ease.inOut,
        done,
      });
    });
  }

  get busy(): boolean {
    return this.runs.length > 0;
  }

  tick(dt: number): boolean {
    if (this.runs.length === 0) return false;
    const ms = dt * 1000;
    for (const r of this.runs) {
      if (r.delay > 0) {
        r.delay -= ms;
        continue;
      }
      r.t = Math.min(1, r.t + ms / r.ms);
      const k = r.curve(r.t);
      r.obj.position.lerpVectors(r.from.position, r.to.position, k);
      if (r.arc) r.obj.position.y += Math.sin(Math.PI * k) * r.arc;
      r.obj.quaternion.slerpQuaternions(r.from.quaternion, r.to.quaternion, k);
      if (r.to.scale && r.from.scale) r.obj.scale.lerpVectors(r.from.scale, r.to.scale, k);
    }
    const finished = this.runs.filter((r) => r.t >= 1);
    this.runs = this.runs.filter((r) => r.t < 1);
    for (const r of finished) r.done();
    return true;
  }
}
