import { expect, test } from 'bun:test';
import { Simulation, RIPOSTE_TICKS, STANCE_BREAK_TICKS } from '../src/engine/simulation';
import { driveBot } from '../src/engine/bot';
import { trainingScene } from './scenario';

function until(simulation: Simulation, condition: () => boolean, limit = 1200): void {
  for (let tick = 0; tick < limit && !condition(); tick++) simulation.tick();
  expect(condition()).toBe(true);
}

function combatFrames(simulation: Simulation, frames: number): void {
  const end = simulation.combatTick + frames;
  until(simulation, () => simulation.combatTick === end, frames * 10 + 10);
}

function brokenCharger(): Simulation {
  const simulation = trainingScene('focus');
  simulation.spawnEnemy('charger', 12, 7.5);
  simulation.setInput({ ...simulation.input, aimX: 1, aimZ: 0, attack: true });
  until(simulation, () => simulation.enemies.state[0] === 4);
  simulation.setInput({ ...simulation.input, attack: false });
  return simulation;
}

function approach(simulation: Simulation): void {
  const enemy = simulation.enemies.active[0];
  const dx = simulation.enemies.x[enemy] - simulation.player.x[0];
  const dz = simulation.enemies.z[enemy] - simulation.player.z[0];
  simulation.setInput({ ...simulation.input, moveX: dx, moveZ: dz, aimX: dx || 0.001, aimZ: dz, attack: false });
  until(simulation, () => simulation.getRiposteTarget() >= 0, 120);
  simulation.setInput({ ...simulation.input, moveX: 0, moveZ: 0 });
  combatFrames(simulation, 1);
}

test('三发灵弹削空 15 韧性，停止动作与接触伤害，120 战斗帧后起身', () => {
  const simulation = brokenCharger();
  expect(simulation.enemies.hp[0]).toBe(46);
  expect(simulation.enemies.poise[0]).toBe(0);
  expect(simulation.enemies.timer[0]).toBe(STANCE_BREAK_TICKS);
  const position = [simulation.enemies.x[0], simulation.enemies.z[0]];
  combatFrames(simulation, STANCE_BREAK_TICKS - 1);
  expect(simulation.enemies.state[0]).toBe(4);
  expect([simulation.enemies.x[0], simulation.enemies.z[0]]).toEqual(position);
  combatFrames(simulation, 1);
  expect(simulation.enemies.state[0]).toBe(3);
  expect(simulation.enemies.poise[0]).toBe(15);
});

test('蓄力造成 30 削韧，正面盾牌承受一半削韧并抵挡生命伤害', () => {
  const simulation = trainingScene('focus');
  simulation.spawnEnemy('guard', 17, 7.5);
  simulation.setInput({ ...simulation.input, aimX: 1, aimZ: 0, charge: true });
  combatFrames(simulation, 60);
  simulation.setInput({ ...simulation.input, charge: false });
  until(simulation, () => simulation.enemies.poise[0] < 30);
  expect(simulation.enemies.poise[0]).toBe(15);
  expect(simulation.enemies.hp[0]).toBe(160);
});

test('五秒未受削韧恢复全部韧性，再次命中重新计时', () => {
  const simulation = trainingScene('focus');
  simulation.spawnEnemy('bomber', 15.5, 7.5);
  simulation.setInput({ ...simulation.input, aimX: 1, aimZ: 0, attack: true });
  combatFrames(simulation, 1);
  simulation.setInput({ ...simulation.input, attack: false });
  until(simulation, () => simulation.enemies.poise[0] === 10);
  combatFrames(simulation, 120);
  simulation.setInput({ ...simulation.input, attack: true });
  combatFrames(simulation, 1);
  simulation.setInput({ ...simulation.input, attack: false, moveZ: -1 });
  until(simulation, () => simulation.enemies.poise[0] === 5);
  expect(simulation.enemies.poiseDelay[0]).toBe(300);
  combatFrames(simulation, 299);
  expect(simulation.enemies.poise[0]).toBe(5);
  combatFrames(simulation, 1);
  expect(simulation.enemies.poise[0]).toBe(15);
});

test('重新按下攻击触发处决，第 24 帧命中一次，第 48 帧后才结算房间', () => {
  const simulation = brokenCharger();
  approach(simulation);
  simulation.setInput({ ...simulation.input, attack: true });
  combatFrames(simulation, RIPOSTE_TICKS / 2 - 1);
  expect(simulation.ripostes).toBe(1);
  expect(simulation.kills).toBe(0);
  const position = [simulation.player.x[0], simulation.player.z[0]];
  simulation.setInput({ ...simulation.input, moveX: 1, dash: true, charge: true });
  combatFrames(simulation, 1);
  expect(simulation.kills).toBe(1);
  expect(simulation.damageDealt).toBe(100);
  expect(simulation.phase).toBe('playing');
  combatFrames(simulation, RIPOSTE_TICKS / 2);
  expect(simulation.phase).toBe('reward');
  expect(simulation.riposteTicks).toBe(0);
  expect(simulation.gold).toBe(5);
  expect([simulation.player.x[0], simulation.player.z[0]]).toEqual(position);
  expect(simulation.dashTicks).toBe(0);
  expect(simulation.chargeTicks).toBe(0);
});

test('按住连射不会自动处决，远处点击只会射击', () => {
  const simulation = trainingScene('focus');
  simulation.spawnEnemy('charger', 11.4, 7.5);
  simulation.setInput({ ...simulation.input, aimX: 1, aimZ: 0, attack: true });
  until(simulation, () => simulation.enemies.state[0] === 4);
  combatFrames(simulation, 12);
  expect(simulation.ripostes).toBe(0);
  const distant = brokenCharger();
  distant.setInput({ ...distant.input, moveX: -1 });
  combatFrames(distant, 20);
  distant.setInput({ ...distant.input, moveX: 0, attack: true });
  combatFrames(distant, 1);
  expect(distant.ripostes).toBe(0);
  expect(distant.bullets.count).toBeGreaterThan(0);
});

test('打断投弹前摇撤销尚未生效的爆炸', () => {
  const simulation = trainingScene('focus');
  simulation.spawnEnemy('bomber', 12, 7.5);
  combatFrames(simulation, 60);
  expect(simulation.zones).toHaveLength(1);
  simulation.setInput({ ...simulation.input, aimX: 1, aimZ: 0, attack: true });
  until(simulation, () => simulation.enemies.state[0] === 4);
  simulation.setInput({ ...simulation.input, attack: false });
  expect(simulation.zones).toHaveLength(0);
  combatFrames(simulation, 70);
  expect(simulation.damageTaken).toBe(0);
});

test('处决全程免疫真实落弹，实体槽位复用不会锁住新敌人', () => {
  const simulation = brokenCharger();
  approach(simulation);
  simulation.spawnEnemy('bomber', 16, 7.5);
  combatFrames(simulation, 85);
  expect(simulation.getRiposteTarget()).toBeGreaterThanOrEqual(0);
  const hp = simulation.player.hp[0];
  simulation.setInput({ ...simulation.input, attack: true });
  combatFrames(simulation, 24);
  expect(simulation.kills).toBe(1);
  const id = simulation.spawnEnemy('guard', 18, 12);
  simulation.setInput({ ...simulation.input, attack: false });
  combatFrames(simulation, 24);
  const guard = simulation.getState().enemies.find((enemy) => enemy.entityId === id)!;
  expect(guard.action).toBe('approach');
  expect(guard.hp).toBe(160);
  expect(simulation.player.hp[0]).toBe(hp);
  expect(simulation.zones.some((zone) => zone.startsAt <= simulation.combatTick)).toBe(true);
  combatFrames(simulation, 1);
  expect(simulation.player.hp[0]).toBe(hp - 16);
});

test('Boss 破韧处决造成 270 伤害，存活后恢复韧性；换房清空处决', () => {
  const simulation = trainingScene('focus');
  simulation.spawnEnemy('warden', 14.5, 7.5);
  for (let tick = 0; tick < 1800 && simulation.enemies.state[0] !== 4; tick++) {
    driveBot(simulation);
    simulation.tick();
  }
  expect(simulation.enemies.state[0]).toBe(4);
  approach(simulation);
  const hp = simulation.enemies.hp[0];
  simulation.setInput({ ...simulation.input, attack: true, dash: false });
  combatFrames(simulation, 48);
  expect(simulation.enemies.hp[0]).toBe(hp - 270);
  expect(simulation.enemies.poise[0]).toBe(120);
  expect(simulation.enemies.state[0]).toBe(3);
  const changing = brokenCharger();
  approach(changing);
  changing.setInput({ ...changing.input, attack: true });
  combatFrames(changing, 5);
  changing.teleport(0, 0);
  expect(changing.riposteTicks).toBe(0);
  expect(changing.riposteTarget).toBe(0);
});

test('玩家韧性耗尽时中断蓄力并硬直 30 帧', () => {
  const simulation = trainingScene('focus');
  simulation.spawnEnemy('bomber', 15.5, 7.5);
  simulation.setInput({ ...simulation.input, charge: true });
  until(simulation, () => simulation.staggerTicks > 0);
  expect(simulation.player.poise[0]).toBe(0);
  expect(simulation.chargeTicks).toBe(0);
  expect(simulation.staggerTicks).toBe(30);
  simulation.setInput({ ...simulation.input, charge: false, moveX: 1 });
  const x = simulation.player.x[0];
  combatFrames(simulation, 30);
  expect(simulation.player.x[0]).toBe(x);
  expect(simulation.player.poise[0]).toBe(40);
});
