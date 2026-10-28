import { Simulation } from '../src/engine/simulation';

export function shootingScene(): Simulation {
  const simulation = new Simulation(42, 'training-room');
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
