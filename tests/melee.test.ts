import { expect, test } from 'bun:test';
import { Simulation } from '../src/engine/simulation';
import { ROLL_TICKS, swordMoves } from '../src/content/weapons';
import { trainingScene, advanceCombat } from './scenario';
import { createUiBridge, staminaAtom } from '../src/ui/store';

test('三段连击循环，共用动作参数且每段只扣一次精力', () => {
  const simulation = trainingScene();
  simulation.setInput({ ...simulation.input, attack: true });
  advanceCombat(simulation, 1);
  expect(simulation.swing?.move).toBe(0);
  expect(simulation.stamina).toBe(86);
  for (let move = 0; move < 3; move++) {
    const action = swordMoves[move];
    advanceCombat(simulation, action.startup + action.active + action.recovery);
    expect(simulation.swing?.move).toBe((move + 1) % 3);
  }
  expect(simulation.stamina).toBe(34);
  expect(simulation.bullets.count).toBe(0);
});

test('大剑前摇不伤害，同一挥击只命中一次，背后目标不受伤', () => {
  const simulation = trainingScene();
  simulation.spawnEnemy('bomber', 12, 7.5);
  simulation.spawnEnemy('bomber', 9, 7.5);
  simulation.setInput({ ...simulation.input, aimX: 1, aimZ: 0, attack: true });
  advanceCombat(simulation, 7);
  expect(simulation.damageDealt).toBe(0);
  simulation.setInput({ ...simulation.input, attack: false });
  advanceCombat(simulation, 7);
  expect(simulation.enemies.hp[0]).toBe(30);
  expect(simulation.enemies.hp[1]).toBe(90);
  expect(simulation.enemies.poise[0]).toBe(3);
  advanceCombat(simulation, 12);
  expect(simulation.damageDealt).toBe(60);
});

test('完整三连斩对 Boss 造成 230 伤害与 52 削韧', () => {
  const simulation = trainingScene();
  simulation.spawnEnemy('warden', 12.5, 7.5);
  simulation.setInput({ ...simulation.input, aimX: 1, aimZ: 0, attack: true });
  advanceCombat(simulation, 80);
  simulation.setInput({ ...simulation.input, attack: false });
  advanceCombat(simulation, 14);
  expect(simulation.damageDealt).toBe(230);
  expect(simulation.enemies.poise[0]).toBe(68);
});

test('满蓄力重斩造成 150 伤害、40 削韧，盾牌正面抵挡生命伤害', () => {
  for (const enemy of ['warden', 'guard']) {
    const simulation = trainingScene();
    simulation.spawnEnemy(enemy, 12.5, 7.5);
    simulation.setInput({ ...simulation.input, aimX: 1, aimZ: 0, charge: true });
    advanceCombat(simulation, 60);
    simulation.setInput({ ...simulation.input, charge: false });
    advanceCombat(simulation, 22);
    expect(simulation.stamina).toBe(72);
    expect(simulation.damageDealt).toBe(enemy === 'warden' ? 150 : 0);
    expect(simulation.enemies.poise[0]).toBe(enemy === 'warden' ? 80 : 10);
  }
});

test('精力不足阻止翻滚，动作结束并等待 45 帧后才恢复', () => {
  const simulation = trainingScene();
  simulation.setInput({ ...simulation.input, attack: true });
  for (let tick = 0; tick < 600 && !(simulation.stamina < 14 && !simulation.swing); tick++) simulation.tick();
  expect(simulation.stamina).toBeLessThan(14);
  const stamina = simulation.stamina;
  simulation.setInput({ ...simulation.input, attack: false, dash: true });
  advanceCombat(simulation, 1);
  expect(simulation.dashTicks).toBe(0);
  expect(simulation.stamina).toBe(stamina);
  simulation.setInput({ ...simulation.input, dash: false });
  advanceCombat(simulation, simulation.staminaDelay);
  expect(simulation.stamina).toBe(stamina);
  advanceCombat(simulation, 6);
  expect(simulation.stamina).toBe(stamina + 3);
});

test('挥击前摇不能翻滚取消，后摇末段可以取消且不重复命中', () => {
  const simulation = trainingScene();
  simulation.spawnEnemy('warden', 12.5, 7.5);
  simulation.setInput({ ...simulation.input, aimX: 1, aimZ: 0, attack: true });
  advanceCombat(simulation, 2);
  simulation.setInput({ ...simulation.input, attack: false, dash: true });
  advanceCombat(simulation, 1);
  expect(simulation.dashTicks).toBe(0);
  expect(simulation.stamina).toBe(86);
  simulation.setInput({ ...simulation.input, dash: false });
  advanceCombat(simulation, 15);
  simulation.setInput({ ...simulation.input, dash: true });
  advanceCombat(simulation, 1);
  expect(simulation.swing).toBeNull();
  expect(simulation.dashTicks).toBe(ROLL_TICKS - 1);
  expect(simulation.stamina).toBe(62);
  expect(simulation.damageDealt).toBe(60);
});

test('顶墙翻滚免疫持续爆炸 18 帧，动作结束下一帧正常受伤', () => {
  const simulation = trainingScene();
  simulation.setInput({ ...simulation.input, moveX: -1, aimX: -1, aimZ: 0 });
  advanceCombat(simulation, 140);
  simulation.setInput({ ...simulation.input, moveX: 0 });
  simulation.spawnEnemy('bomber', 5, 7.5);
  advanceCombat(simulation, 118);
  simulation.setInput({ ...simulation.input, dash: true });
  advanceCombat(simulation, ROLL_TICKS);
  expect(simulation.damageTaken).toBe(0);
  expect(simulation.stamina).toBe(76);
  advanceCombat(simulation, 1);
  expect(simulation.damageTaken).toBe(16);
});

test('近战无法隔墙命中，换武器不能跳过动作恢复', () => {
  const simulation = new Simulation(42, 'moss-hall');
  simulation.setInput({ ...simulation.input, moveZ: -1 });
  advanceCombat(simulation, 37);
  simulation.setInput({ ...simulation.input, moveX: -1, moveZ: 0 });
  advanceCombat(simulation, 62);
  const id = simulation.spawnEnemy('bomber', 5.5, 7.5);
  simulation.setInput({ ...simulation.input, moveX: 0, aimX: 0, aimZ: -1, attack: true });
  advanceCombat(simulation, 1);
  expect(simulation.equipWeapon('focus')).toBe(false);
  simulation.setInput({ ...simulation.input, attack: false });
  advanceCombat(simulation, 27);
  expect(simulation.getState().enemies.find((enemy) => enemy.entityId === id)?.hp).toBe(90);
  expect(simulation.equipWeapon('focus')).toBe(true);
  expect(() => simulation.equipWeapon('unknown' as 'focus')).toThrow();
});

test('精力恢复最多每六帧通知一次 HUD，满精力移动不触发通知', () => {
  const simulation = trainingScene();
  const bridge = createUiBridge();
  simulation.onEvent = () => bridge.publish(simulation);
  let notifications = 0;
  bridge.store.sub(staminaAtom, () => notifications++);
  simulation.setInput({ ...simulation.input, moveX: 1 });
  advanceCombat(simulation, 20);
  expect(notifications).toBe(0);
  simulation.setInput({ ...simulation.input, moveX: 0, dash: true });
  advanceCombat(simulation, 1);
  expect(bridge.store.get(staminaAtom)).toBe(76);
  advanceCombat(simulation, 200);
  expect(bridge.store.get(staminaAtom)).toBe(100);
  expect(notifications).toBe(9);
});
