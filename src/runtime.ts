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
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Escape'].includes(event.code)) return;
      event.preventDefault();
      if (event.code === 'Escape' && !event.repeat) this.pause(!this.simulation.paused);
      this.keys.add(event.code);
      this.updateInput();
    }, options);
    window.addEventListener('keyup', event => { this.keys.delete(event.code); this.updateInput(); }, options);
    this.canvas.addEventListener('pointermove', event => {
      const target = this.view.aim(event.clientX, event.clientY);
      const aimX = target.x - this.simulation.player.x[0];
      const aimZ = target.z - this.simulation.player.z[0];
      if (Math.hypot(aimX, aimZ) > 0.001) this.simulation.setInput({ ...this.simulation.input, aimX, aimZ });
    }, options);
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.attacking = true;
      this.audio.unlock();
      this.updateInput();
    }, options);
    window.addEventListener('pointerup', () => { this.attacking = false; this.updateInput(); }, options);
    window.addEventListener('blur', () => this.pause(true), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(true); }, options);
  }

  private updateInput(): void {
    this.simulation.setInput({
      ...this.simulation.input,
      moveX: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
      moveZ: Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW')),
      attack: this.attacking, dash: this.keys.has('Space'),
    });
  }

  pause(paused: boolean, menu = paused): void {
    this.simulation.paused = paused;
    this.accumulator = 0;
    this.lastTime = 0;
    this.keys.clear();
    this.attacking = false;
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
