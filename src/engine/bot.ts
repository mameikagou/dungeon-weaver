import type { Simulation } from './simulation';
import { boonChoices } from '../content/boons';
import { canStand } from '../content/rooms';

const recoveringStamina = new WeakMap<Simulation, boolean>();

export function driveBot(simulation: Simulation): void {
  if (simulation.phase === 'reward') {
    const choices = boonChoices(simulation.boonIds, simulation.roomX);
    const priority = ['split-shot', 'dash-shot', 'reset-dash', 'trail', 'bounce', 'ricochet'];
    const choice = priority.find((id) => choices.some((boon) => boon.id === id));
    if (choice) simulation.chooseBoon(choice);
    else simulation.continueJourney();
  }
  let nearest = -1;
  let distance = Infinity;
  for (let index = 0; index < simulation.enemies.count; index++) {
    const slot = simulation.enemies.active[index];
    const candidate = Math.hypot(
      simulation.enemies.x[slot] - simulation.player.x[0],
      simulation.enemies.z[slot] - simulation.player.z[0],
    );
    if (candidate < distance) {
      distance = candidate;
      nearest = slot;
    }
  }
  if (nearest < 0) {
    simulation.setInput({ ...simulation.input, attack: false, charge: false, dash: false });
    return;
  }
  const aimX = simulation.enemies.x[nearest] - simulation.player.x[0];
  const aimZ = simulation.enemies.z[nearest] - simulation.player.z[0];
  const desiredWeapon = distance > 3.2 ? 'focus' : 'greatsword';
  const switching = desiredWeapon !== simulation.weapon && !simulation.equipWeapon(desiredWeapon);
  const melee = simulation.weapon === 'greatsword';
  const broken = simulation.enemies.state[nearest] === 4;
  if (simulation.riposteTicks || simulation.getRiposteTarget() >= 0) {
    simulation.setInput({
      moveX: 0,
      moveZ: 0,
      aimX: aimX || 0.001,
      aimZ,
      attack: !simulation.input.attack,
      dash: false,
      charge: false,
    });
    return;
  }
  const resting = simulation.stamina < 24 || (recoveringStamina.get(simulation) === true && simulation.stamina < 80);
  recoveringStamina.set(simulation, resting);
  let bestScore = -Infinity;
  let moveX = 0;
  let moveZ = 0;
  const playerX = simulation.player.x[0];
  const playerZ = simulation.player.z[0];
  const fightingGuard = simulation.enemies.kind[nearest] === 2;
  const guardAttacking =
    fightingGuard && (simulation.enemies.state[nearest] === 1 || simulation.enemies.state[nearest] === 2);
  for (let direction = 0; direction < 8; direction++) {
    const dx = Math.cos((direction * Math.PI) / 4);
    const dz = Math.sin((direction * Math.PI) / 4);
    const x = playerX + dx * 0.7;
    const z = playerZ + dz * 0.7;
    if (!canStand(simulation.room, x, z, 0.32)) continue;
    const targetDistance = Math.hypot(simulation.enemies.x[nearest] - x, simulation.enemies.z[nearest] - z);
    let score =
      -Math.abs(
        targetDistance - (broken ? 1.1 : guardAttacking ? 3.4 : resting ? 4 : melee ? 1.5 : fightingGuard ? 1.7 : 4),
      ) +
      ((-aimZ * dx + aimX * dz) / Math.max(0.01, distance)) * 0.7;
    for (let index = 0; index < simulation.enemies.count; index++) {
      const slot = simulation.enemies.active[index];
      if (simulation.enemies.state[slot] >= 4) continue;
      const separation = Math.hypot(simulation.enemies.x[slot] - x, simulation.enemies.z[slot] - z);
      const safeDistance = melee ? 1.1 : simulation.enemies.kind[slot] === 2 ? 1 : 2.5;
      score -= Math.max(0, safeDistance - separation) * 6;
      const charging =
        simulation.enemies.kind[slot] === 0 ||
        (simulation.enemies.kind[slot] === 3 && simulation.enemies.attack[slot] % 3 === 0);
      if (charging && (simulation.enemies.state[slot] === 1 || simulation.enemies.state[slot] === 2)) {
        const lateral = Math.abs(
          (x - simulation.enemies.x[slot]) * simulation.enemies.facingZ[slot] -
            (z - simulation.enemies.z[slot]) * simulation.enemies.facingX[slot],
        );
        if (lateral < 1 && separation < 7) score -= 5;
      }
    }
    for (const zone of simulation.zones) {
      if (zone.kind === 'blast' && Math.hypot(zone.x - x, zone.z - z) < zone.radius + 0.6) score -= 12;
    }
    if (score > bestScore) {
      bestScore = score;
      moveX = dx;
      moveZ = dz;
    }
  }
  let enemyDanger = false;
  for (let index = 0; index < simulation.enemies.count; index++) {
    const slot = simulation.enemies.active[index];
    if (simulation.enemies.state[slot] >= 3) continue;
    const separation = Math.hypot(simulation.enemies.x[slot] - playerX, simulation.enemies.z[slot] - playerZ);
    if (
      separation < 0.9 ||
      (separation < 3 &&
        (simulation.enemies.state[slot] === 2 ||
          (simulation.enemies.state[slot] === 1 && simulation.enemies.timer[slot] < 8)))
    )
      enemyDanger = true;
  }
  const danger =
    enemyDanger ||
    simulation.zones.some(
      (zone) =>
        zone.kind === 'blast' &&
        zone.startsAt <= simulation.combatTick + 8 &&
        Math.hypot(zone.x - playerX, zone.z - playerZ) < zone.radius + 0.5,
    );
  simulation.setInput({
    moveX,
    moveZ,
    aimX: aimX || 0.001,
    aimZ,
    attack:
      !switching &&
      !resting &&
      (melee
        ? !broken &&
          distance < 2.3 &&
          (simulation.enemies.state[nearest] === 3 ||
            simulation.enemies.state[nearest] === 0 ||
            (simulation.enemies.state[nearest] === 1 && simulation.enemies.timer[nearest] > 32))
        : true),
    charge: false,
    dash: danger && !simulation.input.dash && simulation.dashCooldown === 0,
  });
}
