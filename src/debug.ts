import { flushSync } from 'react-dom';
import type { GameInput } from './engine/simulation';
import type { Weapon } from './content/weapons';
import type { GameRuntime } from './runtime';
import { startedAtom, pausedAtom } from './ui/store';

function createDebugApi(runtime: GameRuntime) {
  function sync() {
    flushSync(() => runtime.sync());
    return runtime.simulation.getState();
  }

  return {
    getState: () => runtime.simulation.getState(),
    equipWeapon(weapon: Weapon) {
      const equipped = runtime.simulation.equipWeapon(weapon);
      return { equipped, state: sync() };
    },
    step(frames: number) {
      if (!Number.isInteger(frames) || frames < 0 || frames > 3600) throw new Error('帧数必须是 0～3600 的整数');
      // 保留测试输入，暂停真人输入和自动时间累计。
      const input = { ...runtime.simulation.input };
      runtime.pause(true, false);
      runtime.simulation.setInput(input);
      for (let frame = 0; frame < frames; frame++) runtime.simulation.tick();
      return sync();
    },
    pause() {
      runtime.pause(true, false);
      return sync();
    },
    resume() {
      runtime.pause(false);
      return sync();
    },
    reset(options: { seed: number; roomId: string }) {
      runtime.reset(options.seed, options.roomId);
      runtime.bridge.store.set(startedAtom, true);
      runtime.bridge.store.set(pausedAtom, false);
      return sync();
    },
    setInput(input: GameInput) {
      runtime.simulation.setInput(input);
      const normalized = { ...runtime.simulation.input };
      runtime.pause(true, false);
      runtime.simulation.setInput(normalized);
      return sync();
    },
    teleport(roomX: number, roomY: number) {
      runtime.simulation.teleport(roomX, roomY);
      runtime.pause(true, false);
      return sync();
    },
    grantBoon(id: string) {
      runtime.simulation.grantBoon(id);
      runtime.pause(true, false);
      return sync();
    },
    spawnEnemy(id: string, x: number, z: number) {
      const entityId = runtime.simulation.spawnEnemy(id, x, z);
      runtime.pause(true, false);
      return { entityId, state: sync() };
    },
  };
}

export function installDebug(runtime: GameRuntime) {
  window.__DEBUG__ = createDebugApi(runtime);
  return () => {
    delete window.__DEBUG__;
  };
}

declare global {
  interface Window {
    __DEBUG__?: ReturnType<typeof createDebugApi>;
  }
}
