import { parseArgs } from 'node:util';
import { Simulation } from '../src/engine/simulation';
import { driveBot } from '../src/engine/bot';

const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
  seed: { type: 'string', default: '42' },
  room: { type: 'string', default: 'moss-hall' },
  boons: { type: 'string', default: '' },
  ticks: { type: 'string', default: '36000' },
  state: { type: 'boolean', default: false },
} });
const limit = Number(values.ticks);
if (!Number.isInteger(limit) || limit < 1 || limit > 360000) throw new Error('ticks 必须为 1～360000 的整数');
const simulation = new Simulation(Number(values.seed), values.room);
for (const boon of values.boons.split(',').filter(Boolean)) simulation.grantBoon(boon);
const started = performance.now();
for (let tick = 0; tick < limit; tick++) {
  driveBot(simulation);
  simulation.tick();
  if (simulation.phase === 'won' || simulation.phase === 'dead') break;
}
const wallTimeMs = performance.now() - started;
const result = {
  seed: simulation.seed, result: simulation.phase === 'playing' ? 'incomplete' : simulation.phase,
  tick: simulation.tickCount, combatTick: simulation.combatTick,
  hp: simulation.player.hp[0], kills: simulation.kills, damage: simulation.damageDealt,
  damageTaken: simulation.damageTaken, rejectedBullets: simulation.rejectedBullets,
  wallTimeMs, dps: simulation.combatTick ? simulation.damageDealt / (simulation.combatTick / 60) : 0,
};
console.log(JSON.stringify(values.state ? simulation.getState() : result, null, 2));
