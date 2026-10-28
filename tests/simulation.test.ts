import { describe, expect, test } from 'bun:test';
import { Simulation, type GameInput } from '../src/engine/simulation';
import { EntityPool } from '../src/engine/pool';
import { driveBot } from '../src/engine/bot';
import { validateRooms } from '../src/content/rooms';
import { boons, boonChoices } from '../src/content/boons';
import { createUiBridge, hpAtom, goldAtom, computedStatsAtom } from '../src/ui/store';
import { shootingScene, trainingScene } from './scenario';
import { ROLL_TICKS } from '../src/content/weapons';

function advance(simulation: Simulation, frames: number): void {
  for (let frame = 0; frame < frames; frame++) simulation.tick();
}

function input(simulation: Simulation, values: Partial<GameInput>): void {
  simulation.setInput({ ...simulation.input, ...values });
}

function training(): Simulation {
  return trainingScene('focus');
}

describe('真实游戏规则', () => {
  test('固定种子和输入在不同步进分段下完全一致', () => {
    const whole = shootingScene();
    const split = shootingScene();
    advance(whole, 180);
    advance(split, 90);
    advance(split, 90);
    expect(whole.getState()).toEqual(split.getState());
    expect(whole.phase).toBe('reward');
    expect(whole.kills).toBe(1);
    expect(whole.gold).toBe(5);
  });

  test('反弹强化逐次结算，次数和寿命有界', () => {
    const simulation = training();
    simulation.grantBoon('bounce');
    simulation.grantBoon('ricochet');
    input(simulation, { aimX: 1, aimZ: 0, attack: true });
    advance(simulation, 1);
    input(simulation, { attack: false });
    advance(simulation, 32);
    const bullet = simulation.getState().projectiles[0];
    expect(bullet.bounce).toBe(1);
    expect(bullet.vx).toBeLessThan(0);
    expect(bullet.damage).toBe(27);
    advance(simulation, 59);
    expect(simulation.getState().projectiles[0].damage).toBe(40.5);
    advance(simulation, 30);
    expect(simulation.bullets.count).toBe(0);
  });

  test('蓄力减速，满蓄力贯穿两个目标且不重复命中同一目标', () => {
    const simulation = training();
    simulation.spawnEnemy('bomber', 12.5, 7.5);
    simulation.spawnEnemy('bomber', 16.5, 7.5);
    input(simulation, { aimX: 1, aimZ: 0, charge: true });
    advance(simulation, 60);
    expect(simulation.chargeTicks).toBe(60);
    expect(simulation.damageDealt).toBe(0);
    input(simulation, { charge: false });
    advance(simulation, 35);
    expect(simulation.kills).toBe(2);
    expect(simulation.damageDealt).toBe(180);
    const moving = training();
    input(moving, { charge: true, moveX: 1 });
    advance(moving, 30);
    expect(moving.player.x[0] - 10.5).toBeCloseTo(1.25, 3);
  });

  test('冲刺取消蓄力，持续按键只触发一次，无法穿墙', () => {
    const simulation = training();
    input(simulation, { aimX: -1, aimZ: 0, charge: true });
    advance(simulation, 40);
    input(simulation, { moveX: -1, dash: true });
    advance(simulation, 12);
    input(simulation, { charge: false });
    advance(simulation, 100);
    expect(simulation.bullets.count).toBe(0);
    expect(simulation.damageDealt).toBe(0);
    expect(simulation.player.x[0]).toBeGreaterThanOrEqual(1.3);
    expect(simulation.dashCooldown).toBe(0);
    input(simulation, { dash: false });
    advance(simulation, 1);
    input(simulation, { dash: true });
    advance(simulation, 1);
    expect(simulation.dashCooldown).toBe(48);
  });

  test('冲刺强化只作用于下一次射击，并可强化蓄力', () => {
    const simulation = training();
    simulation.grantBoon('dash-shot');
    input(simulation, { aimX: 1, aimZ: 0, dash: true });
    advance(simulation, ROLL_TICKS + 1);
    input(simulation, { dash: false, charge: true });
    advance(simulation, 60);
    input(simulation, { charge: false });
    advance(simulation, 1);
    expect(simulation.getState().projectiles[0].damage).toBe(180);
    expect(simulation.empoweredTicks).toBe(0);
  });

  test('烬行真实伤害具有共享间隔，轨迹到期回收', () => {
    const simulation = training();
    simulation.spawnEnemy('guard', 11.5, 7.5);
    simulation.grantBoon('trail');
    input(simulation, { aimX: 1, aimZ: 0, moveX: 1, dash: true });
    advance(simulation, 12);
    expect(simulation.zones.some((zone) => zone.kind === 'trail')).toBe(true);
    expect(simulation.damageDealt).toBeGreaterThan(0);
    expect(simulation.damageDealt).toBeLessThanOrEqual(12);
    input(simulation, { dash: false, moveX: 0 });
    advance(simulation, 90);
    expect(simulation.zones.filter((zone) => zone.kind === 'trail')).toHaveLength(0);
  });

  test('近距离真实击杀恢复冲刺', () => {
    const simulation = training();
    simulation.spawnEnemy('bomber', 12, 7.5);
    simulation.grantBoon('reset-dash');
    simulation.grantBoon('dash-shot');
    input(simulation, { aimX: 1, aimZ: 0, attack: true });
    for (let frame = 0; frame < 90 && simulation.damageDealt < 54; frame++) simulation.tick();
    input(simulation, { attack: false, dash: true });
    advance(simulation, 10);
    input(simulation, { dash: false, aimX: -1, attack: true });
    for (let frame = 0; frame < 40 && !simulation.kills; frame++) simulation.tick();
    expect(simulation.kills).toBe(1);
    expect(simulation.dashCooldown).toBe(0);
  });

  test('冲锋兽有前摇，前摇期间锁定冲撞方向', () => {
    const simulation = training();
    simulation.spawnEnemy('charger', 14.5, 7.5);
    advance(simulation, 60);
    const before = simulation.getState().enemies[0];
    expect(before.action).toBe('windup');
    input(simulation, { moveZ: -1 });
    advance(simulation, 35);
    const after = simulation.getState().enemies[0];
    expect(after.action).toBe('windup');
    expect(after.facingX).toBe(before.facingX);
    expect(after.facingZ).toBe(before.facingZ);
    advance(simulation, 20);
    expect(simulation.getState().enemies[0].action).toBe('attack');
    expect(simulation.damageTaken).toBe(0);
  });

  test('投弹先预告后伤害，离开落点可以规避', () => {
    const stationary = training();
    stationary.spawnEnemy('bomber', 15.5, 7.5);
    advance(stationary, 61);
    expect(stationary.zones).toHaveLength(1);
    expect(stationary.damageTaken).toBe(0);
    const moving = training();
    moving.spawnEnemy('bomber', 15.5, 7.5);
    advance(moving, 61);
    input(moving, { moveZ: -1 });
    advance(moving, 75);
    advance(stationary, 75);
    expect(stationary.damageTaken).toBeGreaterThan(0);
    expect(moving.damageTaken).toBe(0);
  });

  test('卫兵正面抵挡，挥击后恢复阶段可受伤', () => {
    const simulation = training();
    simulation.spawnEnemy('guard', 12.5, 7.5);
    input(simulation, { aimX: 1, aimZ: 0, attack: true });
    advance(simulation, 50);
    expect(simulation.damageDealt).toBe(0);
    advance(simulation, 100);
    expect(simulation.damageDealt).toBeGreaterThan(0);
  });

  test('冲刺无敌覆盖投弹生效瞬间', () => {
    const simulation = training();
    simulation.spawnEnemy('bomber', 15.5, 7.5);
    advance(simulation, 118);
    input(simulation, { dash: true, aimX: 0, aimZ: -1 });
    advance(simulation, 8);
    expect(simulation.damageTaken).toBe(0);
    expect(simulation.dashTicks).toBeGreaterThan(0);
  });

  test('Boss 使用冲撞、落弹和扇形弹幕', () => {
    const simulation = training();
    simulation.spawnEnemy('warden', 14.5, 7.5);
    const seen = new Set<number>();
    let sawBomb = false;
    let sawBullet = false;
    for (let frame = 0; frame < 900; frame++) {
      driveBot(simulation);
      input(simulation, { attack: false });
      simulation.tick();
      const state = simulation.getState();
      if (state.enemies[0]?.action === 'windup') seen.add(state.enemies[0].attack % 3);
      if (state.zones.some((zone) => zone.kind === 'blast')) sawBomb = true;
      if (state.projectiles.some((bullet) => bullet.kind === 2)) sawBullet = true;
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(sawBomb).toBe(true);
    expect(sawBullet).toBe(true);
  });

  test('错误参数和未提供的奖励不会部分改变状态', () => {
    const simulation = shootingScene();
    const before = simulation.getState();
    expect(() => simulation.spawnEnemy('unknown', 3, 3)).toThrow();
    expect(() => simulation.spawnEnemy('charger', NaN, 3)).toThrow();
    expect(() => simulation.grantBoon('split-shot')).toThrow();
    expect(() => simulation.teleport(9, 0)).toThrow();
    expect(simulation.getState()).toEqual(before);
    advance(simulation, 180);
    const reward = simulation.getState();
    expect(() => simulation.chooseBoon('reset-dash')).toThrow();
    expect(simulation.getState()).toEqual(reward);
  });

  test('对象池重用槽位时清空动作状态并分配新实体 ID', () => {
    const pool = new EntityPool(2);
    const first = pool.allocate();
    const id = pool.id[first];
    pool.allocate();
    expect(pool.allocate()).toBe(-1);
    pool.state[first] = 3;
    pool.remove(first);
    expect(pool.allocate()).toBe(first);
    expect(pool.id[first]).toBeGreaterThan(id);
    expect(pool.state[first]).toBe(0);
  });

  test('高频移动不会更新 HUD 原子，派生属性与真实祝福共用规则', () => {
    const simulation = training();
    const bridge = createUiBridge();
    bridge.publish(simulation);
    simulation.onEvent = () => bridge.publish(simulation);
    let notifications = 0;
    bridge.store.sub(hpAtom, () => notifications++);
    bridge.store.sub(goldAtom, () => notifications++);
    input(simulation, { moveX: 1 });
    advance(simulation, 60);
    expect(notifications).toBe(0);
    simulation.grantBoon('split-shot');
    expect(bridge.store.get(computedStatsAtom)).toMatchObject({ shots: 3, damage: 18 });
  });

  test('全部祝福已拥有时可以继续，换房清理攻击和危险区域', () => {
    const simulation = shootingScene();
    for (const boon of boons) if (!simulation.boonIds.includes(boon.id)) simulation.grantBoon(boon.id);
    advance(simulation, 180);
    expect(boonChoices(simulation.boonIds, 0)).toHaveLength(0);
    simulation.continueJourney();
    expect(simulation.room.id).toBe('ember-vault');
    expect(simulation.zones).toHaveLength(0);
    expect(simulation.bullets.count).toBe(0);
  });

  test('房间配置可通行，真实输入完成多波遭遇并获得奖励', () => {
    expect(validateRooms()).toEqual([]);
    const simulation = new Simulation(42);
    for (let frame = 0; frame < 7200 && simulation.phase === 'playing'; frame++) {
      driveBot(simulation);
      simulation.tick();
    }
    expect(simulation.phase).toBe('reward');
    expect(simulation.kills).toBe(4);
    expect(simulation.wave).toBe(1);
    expect(simulation.getState().rewardChoices).toHaveLength(3);
  });

  test('真实 Bot 完成六房路线，Boss 半血后进入狂怒，通关状态冻结', () => {
    const simulation = new Simulation(42);
    let enraged = false;
    for (let frame = 0; frame < 36000 && simulation.phase !== 'won' && simulation.phase !== 'dead'; frame++) {
      driveBot(simulation);
      simulation.tick();
      for (let index = 0; index < simulation.enemies.count; index++) {
        const slot = simulation.enemies.active[index];
        if (simulation.enemies.kind[slot] === 3 && simulation.enemies.hp[slot] < simulation.enemies.maxHp[slot] / 2)
          enraged = true;
      }
    }
    expect(enraged).toBe(true);
    expect(simulation.phase).toBe('won');
    expect(simulation.kills).toBe(46);
    expect(simulation.boonIds).toHaveLength(5);
    expect(simulation.player.hp[0]).toBeGreaterThan(0);
    const combatTick = simulation.combatTick;
    advance(simulation, 60);
    expect(simulation.combatTick).toBe(combatTick);
    expect(simulation.zones).toHaveLength(0);
  });

  test('真实投弹使玩家死亡，结束后生命与伤害保持不变', () => {
    const simulation = training();
    simulation.spawnEnemy('bomber', 15.5, 7.5);
    advance(simulation, 2400);
    expect(simulation.phase).toBe('dead');
    expect(simulation.player.hp[0]).toBe(0);
    expect(simulation.damageTaken).toBe(100);
    advance(simulation, 100);
    expect(simulation.player.hp[0]).toBe(0);
    expect(simulation.damageTaken).toBe(100);
  });
});
