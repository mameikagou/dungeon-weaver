import { Simulation, FIXED_DELTA } from './engine/simulation';
import { GameRenderer } from './view/renderer';
import { GameAudio } from './view/audio';
import { startedAtom, pausedAtom, type UiBridge } from './ui/store';

export class GameRuntime {
  simulation = new Simulation();
  readonly view: GameRenderer;
  readonly audio = new GameAudio();
  private accumulator = 0;
  private lastTime = 0;
  private frameId = 0;
  private readonly keys = new Set<string>();
  private attacking = false;
  private charging = false;
  private aimTarget: { x: number; z: number } | null = null;
  private readonly abort = new AbortController();

  constructor(readonly canvas: HTMLCanvasElement, readonly bridge: UiBridge) {
    this.view = new GameRenderer(canvas);
    this.connect();
    this.bindInputs();
    this.frameId = requestAnimationFrame(this.frame);
  }

  private connect(): void {
    this.simulation.onEvent = event => {
      if (event !== 'fire' && event !== 'dash') this.bridge.publish(this.simulation);
      this.audio.play(event);
    };
    this.sync();
  }

  private frame = (time: number): void => {
    const delta = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.1) : 0;
    this.lastTime = time;
    if (!this.simulation.paused) {
      this.updateInput();
      this.accumulator += delta;
      while (this.accumulator >= FIXED_DELTA) {
        this.simulation.tick();
        this.accumulator -= FIXED_DELTA;
      }
    } else this.accumulator = 0;
    this.view.draw(this.simulation);
    this.frameId = requestAnimationFrame(this.frame);
  };

  private bindInputs(): void {
    const options = { signal: this.abort.signal };
    window.addEventListener('resize', () => this.view.resize(), options);
    window.addEventListener('keydown', event => {
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Space', 'Escape'].includes(event.code)) return;
      event.preventDefault();
      if (event.code === 'Escape' && !event.repeat) this.pause(!this.simulation.paused);
      this.keys.add(event.code);
      this.updateInput();
    }, options);
    window.addEventListener('keyup', event => { this.keys.delete(event.code); this.updateInput(); }, options);
    this.canvas.addEventListener('pointermove', event => {
      const target = this.view.aim(event.clientX, event.clientY);
      this.aimTarget = { x: target.x, z: target.z };
      this.updateInput();
    }, options);
    this.canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
    // 鼠标组合按键各自触发 mousedown；pointerdown 仅在首个按钮按下时触发。
    this.canvas.addEventListener('mousedown', event => {
      if (event.button === 0) this.attacking = true;
      if (event.button === 2) this.charging = true;
      this.audio.unlock();
      this.updateInput();
    }, options);
    window.addEventListener('mouseup', event => {
      if (event.button === 0) this.attacking = false;
      if (event.button === 2) this.charging = false;
      this.updateInput();
    }, options);
    window.addEventListener('blur', () => this.pause(true), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(true); }, options);
  }

  private updateInput(): void {
    let { aimX, aimZ } = this.simulation.input;
    if (this.aimTarget) {
      const dx = this.aimTarget.x - this.simulation.player.x[0];
      const dz = this.aimTarget.z - this.simulation.player.z[0];
      if (Math.hypot(dx, dz) > 0.001) { aimX = dx; aimZ = dz; }
    }
    this.simulation.setInput({
      ...this.simulation.input,
      aimX, aimZ,
      moveX: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
      moveZ: Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW')),
      attack: this.attacking, dash: this.keys.has('Space'), charge: this.charging || this.keys.has('KeyE'),
    });
  }

  pause(paused: boolean, menu = paused): void {
    this.simulation.paused = paused;
    this.accumulator = 0;
    this.lastTime = 0;
    this.keys.clear();
    this.attacking = false;
    this.charging = false;
    this.aimTarget = null;
    if (paused && menu) this.simulation.cancelCharge();
    this.updateInput();
    this.bridge.store.set(pausedAtom, menu);
    this.bridge.publish(this.simulation);
  }

  start(): void {
    this.audio.unlock();
    this.bridge.store.set(startedAtom, true);
    this.pause(false);
  }

  reset(seed = 42, roomId = 'moss-hall'): void {
    const next = new Simulation(seed, roomId);
    this.pause(true);
    this.simulation = next;
    this.connect();
  }

  sync(): void {
    this.bridge.publish(this.simulation);
    this.view.draw(this.simulation);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.abort.abort();
    this.view.dispose();
    this.audio.dispose();
  }
}
