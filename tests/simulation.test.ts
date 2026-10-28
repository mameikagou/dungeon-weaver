import { describe, expect, test } from 'bun:test';
import { Simulation } from '../src/engine/simulation';
import { EntityPool } from '../src/engine/pool';
import { driveBot } from '../src/engine/bot';
import { validateRooms } from '../src/content/rooms';
import { createUiBridge, hpAtom, goldAtom, computedStatsAtom } from '../src/ui/store';
import { shootingScene } from './scenario';

function advance(simulation: Simulation, frames: number): void {
  for (let frame = 0; frame < frames; frame++) simulation.tick();
}

describe('真实游戏规则', () => {
  test('相同种子、输入和不同分段得到相同状态', () => {
    const whole = shootingScene();
    const split = shootingScene();
    advance(whole, 60);
    advance(split, 30);
    advance(split, 30);
    expect(whole.getState()).toEqual(split.getState());
    expect(whole.tickCount).toBe(60);
    expect(whole.kills).toBe(1);
    expect(whole.phase).toBe('reward');
    expect(whole.gold).toBe(5);
  });

  test('真实弹幕碰墙反弹，有限次数生效', () => {
    const simulation = new Simulation(42, 'training-room');
    simulation.grantBoon('bounce');
    simulation.setInput({ moveX: 0, moveZ: 0, aimX: 1, aimZ: 0, attack: true, dash: false });
    advance(simulation, 1);
    simulation.setInput({ ...simulation.input, attack: false });
    advance(simulation, 32);
    const bullet = simulation.getState().projectiles[0];
    expect(bullet.bounce).toBe(1);
    expect(bullet.vx).toBeLessThan(0);
    advance(simulation, 100);
    expect(simulation.bullets.count).toBe(0);
  });

  test('冲刺不能穿过墙壁，持续按下只触发一次', () => {
    const simulation = new Simulation(42, 'training-room');
    simulation.setInput({ moveX: -1, moveZ: 0, aimX: -1, aimZ: 0, attack: false, dash: true });
    advance(simulation, 100);
    expect(simulation.player.x[0]).toBeGreaterThanOrEqual(1.3);
    expect(simulation.dashCooldown).toBe(0);
    expect(simulation.dashTicks).toBe(0);
    simulation.setInput({ ...simulation.input, dash: false });
    advance(simulation, 1);
    simulation.setInput({ ...simulation.input, dash: true });
    advance(simulation, 1);
    expect(simulation.dashCooldown).toBe(48);
  });

  test('错误 ID 与非法位置不改变游戏状态', () => {
    const simulation = shootingScene();
    const before = simulation.getState();
    expect(() => simulation.spawnEnemy('unknown', 3, 3)).toThrow();
    expect(() => simulation.spawnEnemy('melee', NaN, 3)).toThrow();
    expect(() => simulation.grantBoon('split-shot')).toThrow();
    expect(() => simulation.teleport(9, 0)).toThrow();
    expect(simulation.getState()).toEqual(before);
  });

  test('对象池回收槽位，分配新实体 ID，容量不足明确返回', () => {
    const pool = new EntityPool(2);
    const first = pool.allocate();
    const id = pool.id[first];
    pool.allocate();
    expect(pool.allocate()).toBe(-1);
    pool.remove(first);
    expect(pool.allocate()).toBe(first);
    expect(pool.id[first]).toBeGreaterThan(id);
    expect(pool.count).toBe(2);
  });

  test('60 帧坐标变化不触发 HUD 原子更新，属性派生与核心一致', () => {
    const simulation = new Simulation(42, 'training-room');
    const bridge = createUiBridge();
    bridge.publish(simulation);
    simulation.onEvent = () => bridge.publish(simulation);
    let notifications = 0;
    bridge.store.sub(hpAtom, () => notifications++);
    bridge.store.sub(goldAtom, () => notifications++);
    simulation.setInput({ moveX: 1, moveZ: 0, aimX: 1, aimZ: 0, attack: false, dash: false });
    advance(simulation, 60);
    expect(notifications).toBe(0);
    expect(simulation.player.x[0]).toBeGreaterThan(10.5);
    simulation.grantBoon('split-shot');
    simulation.grantBoon('power');
    expect(bridge.store.get(computedStatsAtom)).toMatchObject({ shots: 3, damage: 27 });
  });

  test('真实 Bot 清房、选祝福并完成两间房间', () => {
    const simulation = new Simulation(42);
    for (let frame = 0; frame < 7200 && simulation.phase !== 'won' && simulation.phase !== 'dead'; frame++) {
      driveBot(simulation);
      simulation.tick();
    }
    expect(simulation.phase).toBe('won');
    expect(simulation.kills).toBe(13);
    expect(simulation.boonIds).toContain('split-shot');
  });

  test('所有房间的出生点与地面可达', () => {
    expect(validateRooms()).toEqual([]);
  });

  test('持续接触扣血至死亡，承伤记录实际扣除的生命', () => {
    const simulation = new Simulation(42, 'training-room');
    simulation.spawnEnemy('melee', 10.5, 7.5);
    advance(simulation, 500);
    expect(simulation.phase).toBe('dead');
    expect(simulation.player.hp[0]).toBe(0);
    expect(simulation.damageTaken).toBe(100);
  });

  test('吸血祝福通过真实命中恢复生命', () => {
    const simulation = new Simulation(42, 'training-room');
    simulation.spawnEnemy('melee', 11, 7.5);
    simulation.grantBoon('leech');
    advance(simulation, 31);
    const hp = simulation.player.hp[0];
    expect(hp).toBeLessThan(100);
    simulation.setInput({ moveX: 0, moveZ: 0, aimX: 1, aimZ: 0, attack: true, dash: false });
    advance(simulation, 1);
    expect(simulation.player.hp[0]).toBe(hp + 1);
  });

  test('冲刺祝福延长移动，冲刺期间接触敌人不会扣血', () => {
    const simulation = new Simulation(42, 'training-room');
    simulation.spawnEnemy('melee', 10.5, 7.5);
    simulation.grantBoon('rush');
    advance(simulation, 29);
    simulation.setInput({ moveX: 1, moveZ: 0, aimX: 1, aimZ: 0, attack: false, dash: true });
    advance(simulation, 1);
    expect(simulation.dashTicks).toBe(14);
    expect(simulation.player.hp[0]).toBe(100);
  });
});
