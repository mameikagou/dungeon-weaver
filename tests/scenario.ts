import { Simulation } from '../src/engine/simulation';
import type { Weapon } from '../src/content/weapons';

export function trainingScene(weapon: Weapon = 'greatsword'): Simulation {
  const simulation = new Simulation(42, 'training-room');
  simulation.equipWeapon(weapon);
  return simulation;
}

export function advanceCombat(simulation: Simulation, frames: number): void {
  const end = simulation.combatTick + frames;
  for (let tick = 0; tick < frames * 10 + 10 && simulation.combatTick < end; tick++) simulation.tick();
  if (simulation.combatTick !== end) throw new Error('对局结束前未走完指定战斗帧');
}

export function shootingScene(): Simulation {
  const simulation = trainingScene('focus');
  simulation.spawnEnemy('charger', 14.5, 7.5);
  simulation.grantBoon('split-shot');
  simulation.setInput({ moveX: 0, moveZ: 0, aimX: 1, aimZ: 0, attack: true, dash: false, charge: false });
  return simulation;
}

if (import.meta.main) {
  const simulation = shootingScene();
  for (let frame = 0; frame < 180; frame++) simulation.tick();
  console.log(JSON.stringify(simulation.getState(), null, 2));
}
