import type { Simulation } from './simulation';

export function driveBot(simulation: Simulation): void {
  if (simulation.phase === 'reward') {
    simulation.chooseBoon(simulation.boonIds.includes('split-shot') ? 'power' : 'split-shot');
  }
  let nearest = -1;
  let distance = Infinity;
  for (let index = 0; index < simulation.enemies.count; index++) {
    const slot = simulation.enemies.active[index];
    const candidate = Math.hypot(simulation.enemies.x[slot] - simulation.player.x[0], simulation.enemies.z[slot] - simulation.player.z[0]);
    if (candidate < distance) { distance = candidate; nearest = slot; }
  }
  if (nearest < 0) return;
  const aimX = simulation.enemies.x[nearest] - simulation.player.x[0];
  const aimZ = simulation.enemies.z[nearest] - simulation.player.z[0];
  simulation.setInput({ moveX: 0, moveZ: 0, aimX, aimZ, attack: true, dash: false });
}
