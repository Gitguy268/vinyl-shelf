import {
  ACESFilmicToneMapping,
  Clock,
  HalfFloatType,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'high' | 'low';

/**
 * The renderer, camera and post-processing. Frames are drawn only when something changed or
 * moves (`wake`), so an idle shelf costs nothing.
 */
export class World {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(34, 1, 0.05, 40);
  readonly canvas: HTMLCanvasElement;
  private composer: EffectComposer;
  private ao: GTAOPass | null = null;
  private bloom: UnrealBloomPass;
  private clock = new Clock();
  private awake = 0;
  private raf = 0;
  private tickers = new Set<(dt: number, t: number) => boolean>();
  quality: Quality;
  /** Fraction of the canvas width covered on the right by the deck panel: the view shifts left. */
  private inset = 0;
  frames = 0;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25));

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    const target = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples: quality === 'high' ? 4 : 0,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (quality === 'high') {
      this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.85;
      this.ao.updateGtaoMaterial({
        radius: 0.06,
        distanceExponent: 1.4,
        thickness: 1.2,
        scale: 1,
        samples: 12,
      });
      this.ao.updatePdMaterial({
        lumaPhi: 10,
        depthPhi: 2,
        normalPhi: 3,
        radius: 6,
        rings: 2,
        samples: 12,
      });
      this.composer.addPass(this.ao);
    }
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.22, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** Called every frame while it returns true; the world sleeps when no ticker wants frames. */
  addTicker(fn: (dt: number, t: number) => boolean): () => void {
    this.tickers.add(fn);
    this.wake();
    return () => this.tickers.delete(fn);
  }

  /** Draw for at least `ms` more. */
  wake(ms = 120): void {
    this.awake = Math.max(this.awake, performance.now() + ms);
    if (!this.raf) {
      this.clock.getDelta();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  setInset(fraction: number): void {
    this.inset = fraction;
    this.resize();
  }

  /** Shadows are drawn again only when something moved that casts them. */
  shadowsChanged(): void {
    this.renderer.shadowMap.needsUpdate = true;
    this.wake();
  }

  private frame = (): void => {
    this.raf = 0;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    let busy = false;
    for (const fn of this.tickers) if (fn(dt, t)) busy = true;
    this.composer.render(dt);
    this.frames++;
    if (busy || performance.now() < this.awake) this.raf = requestAnimationFrame(this.frame);
  };

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    // The deck panel covers the right: centre the view in what is left, by rendering the right
    // part of a wider view whose centre falls in the middle of the uncovered area.
    const shift = this.inset * w;
    this.camera.aspect = (w + shift) / h;
    if (shift > 0) this.camera.setViewOffset(w + shift, h, shift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.wake();
  }

  /** The canvas as an image, for tests and the share card. */
  snapshot(): string {
    this.composer.render(0);
    return this.canvas.toDataURL('image/png');
  }
}
