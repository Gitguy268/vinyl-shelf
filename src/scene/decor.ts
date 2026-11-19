import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { rng } from '../art/colour';
import { generatedCover } from '../art/generate';
import { DIM, type ShelfLayout } from './layout';
import { walnut } from './textures';

/** Things people keep in the cubes that have no records: a plant, a speaker, books, a print. */

function shadowed<T extends Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function plant(seed: number): Group {
  const g = new Group();
  const rand = rng(seed);
  const pot = shadowed(
    new Mesh(
      new CylinderGeometry(0.075, 0.06, 0.12, 32),
      new MeshStandardMaterial({ color: '#b5623b', roughness: 0.85 }),
    ),
  );
  pot.position.y = 0.06;
  const soil = new Mesh(
    new CylinderGeometry(0.07, 0.07, 0.01, 24),
    new MeshStandardMaterial({ color: '#3a2a1e', roughness: 1 }),
  );
  soil.position.y = 0.115;
  g.add(pot, soil);
  const leaf = new MeshStandardMaterial({ color: '#3f6b3a', roughness: 0.6 });
  const leafLight = new MeshStandardMaterial({ color: '#5b8a4a', roughness: 0.6 });
  const stemMat = new MeshStandardMaterial({ color: '#4d6b33', roughness: 0.7 });
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.015 + rand() * 0.05;
    const h = 0.15 + rand() * 0.11;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.6;
    // A stem from the soil to the leaf.
    const len = Math.hypot(x, h - 0.115, z);
    const stem = new Mesh(new CylinderGeometry(0.0022, 0.0028, len, 6), stemMat);
    stem.position.set(x / 2, (h + 0.115) / 2, z / 2);
    stem.rotation.z = -Math.atan2(x, h - 0.115);
    stem.rotation.x = Math.atan2(z, h - 0.115);
    g.add(stem);
    const m = shadowed(new Mesh(new SphereGeometry(1, 12, 8), i % 3 ? leaf : leafLight));
    m.scale.set(0.045, 0.011, 0.022);
    m.position.set(x * 1.35, h, z * 1.35);
    m.rotation.set(rand() * 0.6, -a, 0.35 + rand() * 0.5);
    g.add(m);
  }
  return g;
}

function speaker(): Group {
  const g = new Group();
  const box = shadowed(
    new Mesh(
      new BoxGeometry(0.17, 0.27, 0.22),
      new MeshStandardMaterial({ map: walnut(31), roughness: 0.5 }),
    ),
  );
  box.position.y = 0.135;
  const grille = new Mesh(
    new BoxGeometry(0.15, 0.25, 0.004),
    new MeshStandardMaterial({ color: '#2b2622', roughness: 0.95 }),
  );
  grille.position.set(0, 0.135, 0.111);
  const woofer = new Mesh(
    new CylinderGeometry(0.05, 0.05, 0.004, 32),
    new MeshStandardMaterial({ color: '#1a1716', roughness: 0.8 }),
  );
  woofer.rotation.x = Math.PI / 2;
  woofer.position.set(0, 0.1, 0.114);
  const tweeter = new Mesh(
    new CylinderGeometry(0.016, 0.016, 0.004, 24),
    new MeshStandardMaterial({ color: '#c9ccd1', metalness: 0.8, roughness: 0.3 }),
  );
  tweeter.rotation.x = Math.PI / 2;
  tweeter.position.set(0, 0.205, 0.114);
  g.add(box, grille, woofer, tweeter);
  return g;
}

function books(seed: number): Group {
  const g = new Group();
  const rand = rng(seed);
  const colours = ['#7a2e2a', '#24476b', '#d9c7a1', '#2f5a45', '#c58b2c', '#3b3330'];
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const h = 0.025 + rand() * 0.02;
    const w = 0.2 + rand() * 0.06;
    const d = 0.15 + rand() * 0.04;
    const b = shadowed(
      new Mesh(
        new BoxGeometry(w, h, d),
        new MeshStandardMaterial({
          color: colours[Math.floor(rand() * colours.length)]!,
          roughness: 0.75,
        }),
      ),
    );
    b.position.set((rand() - 0.5) * 0.02, y + h / 2, 0);
    b.rotation.y = (rand() - 0.5) * 0.2;
    y += h;
    g.add(b);
  }
  return g;
}

function print(seed: number): Group {
  const g = new Group();
  const art = generatedCover(
    { id: `print-${seed}`, title: 'Untitled', artist: '', year: null },
    256,
  );
  const tex = new CanvasTexture(art);
  tex.colorSpace = SRGBColorSpace;
  const frame = new MeshStandardMaterial({ color: '#1d1a17', roughness: 0.5 });
  const face = new MeshStandardMaterial({ map: tex, roughness: 0.7 });
  const m = shadowed(
    new Mesh(new BoxGeometry(0.22, 0.28, 0.018), [frame, frame, frame, frame, face, frame]),
  );
  m.position.set(0, 0.14 * Math.cos(0.18), -0.06);
  m.rotation.x = -0.18;
  g.add(m);
  return g;
}

/** Fills the spare cubes, the same way every time for the same shelf. */
export function decorate(layout: ShelfLayout): Group {
  const g = new Group();
  const makers = [plant, speaker, books, print];
  layout.spare.forEach((cube, n) => {
    const c = layout.cubes[cube]!;
    const item = makers[n % makers.length]!(cube * 7 + 3);
    item.position.set(c.x + DIM.cube / 2, c.y, 0.02);
    g.add(item);
  });
  return g;
}
