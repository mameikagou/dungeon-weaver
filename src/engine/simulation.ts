import { boons, calcPlayerStats, type Boon } from '../content/boons';
import { canStand, rooms, ROOM_HEIGHT, ROOM_WIDTH, type Room } from '../content/rooms';
import { EntityPool } from './pool';
import { SeededRNG } from './random';
import { SpatialGrid } from './spatial-grid';

export const FIXED_DELTA = 1 / 60;
const NEIGHBORS = [-1, 1, -ROOM_WIDTH, ROOM_WIDTH];
export interface GameInput {
  moveX: number; moveZ: number; aimX: number; aimZ: number; attack: boolean; dash: boolean;
}
export type GameEvent = 'hud' | 'fire' | 'hit' | 'dash' | 'clear';
export type Phase = 'playing' | 'reward' | 'dead' | 'won';

export class Simulation {
  readonly player = new EntityPool(1);
  readonly enemies = new EntityPool(2000);
  readonly bullets = new EntityPool(5000);
  private readonly grid = new SpatialGrid(ROOM_WIDTH, ROOM_HEIGHT, this.enemies.capacity);
  private readonly distances = new Int16Array(ROOM_WIDTH * ROOM_HEIGHT);
  private readonly queue = new Int16Array(ROOM_WIDTH * ROOM_HEIGHT);
  readonly input: GameInput = { moveX: 0, moveZ: 0, aimX: 0, aimZ: -1, attack: false, dash: false };
  readonly boonIds: string[] = [];
  private readonly effects: Boon[] = [];
  readonly rng: SeededRNG;
  room: Room;
  roomX = 0;
  roomY = 0;
  tickCount = 0;
  combatTick = 0;
  paused = true;
  phase: Phase = 'playing';
  gold = 0;
  kills = 0;
  damageDealt = 0;
  damageTaken = 0;
  rejectedBullets = 0;
  hitstop = 0;
  dashTicks = 0;
  dashCooldown = 0;
  private dashHeld = false;
  private dashX = 0;
  private dashZ = -1;
  private fireCooldown = 0;
  private invulnerable = 0;
  private encounter = false;
  onEvent: (event: GameEvent) => void = () => {};

  constructor(readonly seed = 42, roomId: string = 'moss-hall') {
    this.rng = new SeededRNG(seed);
    const room = rooms.find(room => room.id === roomId);
    if (!room) throw new Error(`未知房间: ${roomId}`);
    this.room = room;
    this.roomX = room.id === 'ember-vault' ? 1 : 0;
    this.player.allocate();
    this.player.hp[0] = 100;
    this.player.radius[0] = 0.3;
    this.loadRoom(room);
  }

  setInput(input: GameInput): void {
    if (![input.moveX, input.moveZ, input.aimX, input.aimZ].every(Number.isFinite)) throw new Error('输入必须有限');
    const aimLength = Math.hypot(input.aimX, input.aimZ);
    if (aimLength < 0.0001 || typeof input.attack !== 'boolean' || typeof input.dash !== 'boolean') throw new Error('输入无效');
    const moveLength = Math.max(1, Math.hypot(input.moveX, input.moveZ));
    Object.assign(this.input, input, {
      moveX: input.moveX / moveLength, moveZ: input.moveZ / moveLength,
      aimX: input.aimX / aimLength, aimZ: input.aimZ / aimLength,
    });
  }

  tick(): void {
    this.tickCount++;
    if (this.phase !== 'playing') return;
    if (this.hitstop > 0) { this.hitstop--; return; }
    this.combatTick++;
    if (this.combatTick % 15 === 1) this.updatePaths();
    this.updatePlayer();
    this.updateEnemies();
    this.grid.rebuild(this.enemies);
    this.updateBullets();
    if (this.encounter && !this.enemies.count && this.phase === 'playing') {
      this.phase = this.roomX === 1 ? 'won' : 'reward';
      this.bullets.clear();
      this.onEvent('clear');
    }
  }

  private updatePlayer(): void {
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.dashCooldown > 0) this.dashCooldown--;
    if (this.player.flash[0] > 0) this.player.flash[0]--;
    if (this.input.dash && !this.dashHeld && !this.dashCooldown) this.startDash();
    this.dashHeld = this.input.dash;
    const dashing = this.dashTicks > 0;
    const speed = dashing ? 15 : 4.8;
    this.player.vx[0] = (dashing ? this.dashX : this.input.moveX) * speed;
    this.player.vz[0] = (dashing ? this.dashZ : this.input.moveZ) * speed;
    this.move(this.player, 0);
    if (this.dashTicks > 0) this.dashTicks--;
    if (this.fireCooldown > 0) this.fireCooldown--;
    if (this.input.attack && !this.fireCooldown) this.fire();
  }

  private startDash(): void {
    const context = { duration: 10 };
    for (const effect of this.effects) effect.onDash?.(context);
    this.dashTicks = context.duration;
    this.invulnerable = context.duration + 1;
    this.dashCooldown = 48;
    const moving = Math.hypot(this.input.moveX, this.input.moveZ) > 0;
    this.dashX = moving ? this.input.moveX : this.input.aimX;
    this.dashZ = moving ? this.input.moveZ : this.input.aimZ;
    this.onEvent('dash');
  }

  private fire(): void {
    const stats = calcPlayerStats(this.boonIds);
    const context = { bounce: 0 };
    for (const effect of this.effects) effect.onSpawnBullet?.(context);
    const aim = Math.atan2(this.input.aimZ, this.input.aimX);
    for (let shot = 0; shot < stats.shots; shot++) {
      const slot = this.bullets.allocate();
      if (slot < 0) { this.rejectedBullets++; continue; }
      const angle = aim + (shot - (stats.shots - 1) / 2) * 0.22;
      this.bullets.x[slot] = this.player.x[0];
      this.bullets.z[slot] = this.player.z[0];
      this.bullets.vx[slot] = Math.cos(angle) * stats.speed;
      this.bullets.vz[slot] = Math.sin(angle) * stats.speed;
      this.bullets.damage[slot] = stats.damage;
      this.bullets.radius[slot] = 0.12;
      this.bullets.life[slot] = 100;
      this.bullets.bounce[slot] = context.bounce;
    }
    this.fireCooldown = 12;
    this.onEvent('fire');
  }

  private move(pool: EntityPool, slot: number): void {
    const x = pool.x[slot] + pool.vx[slot] * FIXED_DELTA;
    const z = pool.z[slot] + pool.vz[slot] * FIXED_DELTA;
    if (canStand(this.room, x, pool.z[slot], pool.radius[slot])) pool.x[slot] = x;
    if (canStand(this.room, pool.x[slot], z, pool.radius[slot])) pool.z[slot] = z;
  }

  private updatePaths(): void {
    this.distances.fill(-1);
    const start = Math.floor(this.player.z[0]) * ROOM_WIDTH + Math.floor(this.player.x[0]);
    this.distances[start] = 0;
    this.queue[0] = start;
    let count = 1;
    for (let index = 0; index < count; index++) {
      const cell = this.queue[index];
      for (const offset of NEIGHBORS) {
        const next = cell + offset;
        if (next < 0 || next >= this.distances.length || this.distances[next] >= 0) continue;
        if (this.room.rows[Math.floor(next / ROOM_WIDTH)][next % ROOM_WIDTH] === '#') continue;
        this.distances[next] = this.distances[cell] + 1;
        this.queue[count++] = next;
      }
    }
  }

  private updateEnemies(): void {
    for (let index = 0; index < this.enemies.count; index++) {
      const slot = this.enemies.active[index];
      if (this.enemies.flash[slot] > 0) this.enemies.flash[slot]--;
      this.steerEnemy(slot);
      this.move(this.enemies, slot);
      const distance = Math.hypot(this.enemies.x[slot] - this.player.x[0], this.enemies.z[slot] - this.player.z[0]);
      if (distance < 0.67 && !this.invulnerable && this.phase === 'playing') {
        const damage = Math.min(this.player.hp[0], this.enemies.damage[slot]);
        this.player.hp[0] -= damage;
        this.damageTaken += damage;
        this.player.flash[0] = 10;
        this.invulnerable = 45;
        if (!this.player.hp[0]) this.phase = 'dead';
        this.onEvent('hud');
      }
    }
  }

  private steerEnemy(slot: number): void {
    const x = this.enemies.x[slot];
    const z = this.enemies.z[slot];
    const cell = Math.floor(z) * ROOM_WIDTH + Math.floor(x);
    let best = cell;
    for (const offset of NEIGHBORS) {
      const neighbor = cell + offset;
      if (this.distances[neighbor] >= 0 && this.distances[neighbor] < this.distances[best]) best = neighbor;
    }
    const close = Math.hypot(x - this.player.x[0], z - this.player.z[0]) < 1.7;
    const targetX = close ? this.player.x[0] : best % ROOM_WIDTH + 0.5;
    const targetZ = close ? this.player.z[0] : Math.floor(best / ROOM_WIDTH) + 0.5;
    const distance = Math.max(0.01, Math.hypot(targetX - x, targetZ - z));
    const speed = this.enemies.speed[slot];
    this.enemies.vx[slot] = (targetX - x) / distance * speed;
    this.enemies.vz[slot] = (targetZ - z) / distance * speed;
  }

  private updateBullets(): void {
    for (let index = this.bullets.count - 1; index >= 0; index--) {
      const slot = this.bullets.active[index];
      if (--this.bullets.life[slot] <= 0) { this.bullets.remove(slot); continue; }
      const travel = Math.hypot(this.bullets.vx[slot], this.bullets.vz[slot]) * FIXED_DELTA;
      const steps = Math.max(1, Math.ceil(travel / 0.1));
      for (let substep = 0; substep < steps && this.bullets.id[slot]; substep++) {
        this.advanceBullet(slot, FIXED_DELTA / steps);
      }
    }
  }

  private advanceBullet(slot: number, delta: number): void {
    const pool = this.bullets;
    const nextX = pool.x[slot] + pool.vx[slot] * delta;
    const nextZ = pool.z[slot] + pool.vz[slot] * delta;
    if (!canStand(this.room, nextX, nextZ, pool.radius[slot])) {
      if (!pool.bounce[slot]) { pool.remove(slot); return; }
      pool.bounce[slot]--;
      if (!canStand(this.room, nextX, pool.z[slot], pool.radius[slot])) pool.vx[slot] *= -1;
      if (!canStand(this.room, pool.x[slot], nextZ, pool.radius[slot])) pool.vz[slot] *= -1;
      return;
    }
    pool.x[slot] = nextX;
    pool.z[slot] = nextZ;
    const count = this.grid.query(nextX, nextZ, 0.55);
    for (let index = 0; index < count; index++) {
      const enemy = this.grid.results[index];
      if (!this.enemies.id[enemy]) continue;
      if (Math.hypot(this.enemies.x[enemy] - nextX, this.enemies.z[enemy] - nextZ) > 0.48) continue;
      this.hitEnemy(enemy, pool.damage[slot]);
      pool.remove(slot);
      break;
    }
  }

  private hitEnemy(slot: number, damage: number): void {
    this.damageDealt += Math.min(this.enemies.hp[slot], damage);
    this.enemies.hp[slot] -= damage;
    this.enemies.flash[slot] = 7;
    this.hitstop = 2;
    const context = { healing: 0 };
    for (const effect of this.effects) effect.onHit?.(context);
    this.player.hp[0] = Math.min(100, this.player.hp[0] + context.healing);
    if (this.enemies.hp[slot] <= 0) {
      this.enemies.remove(slot);
      this.gold += 5;
      this.kills++;
    }
    this.onEvent('hit');
  }

  spawnEnemy(id: string, x: number, z: number): number {
    if (id !== 'melee') throw new Error(`未知敌人: ${id}`);
    if (!canStand(this.room, x, z, 0.34)) throw new Error('敌人位置不可通行');
    const slot = this.enemies.allocate();
    if (slot < 0) throw new Error('敌人对象池已满');
    this.enemies.x[slot] = x;
    this.enemies.z[slot] = z;
    this.enemies.hp[slot] = this.roomX === 1 ? 54 : 36;
    this.enemies.radius[slot] = 0.34;
    this.enemies.speed[slot] = 1.1 + this.rng.next() * 0.45;
    this.enemies.damage[slot] = 12;
    this.encounter = true;
    this.phase = 'playing';
    this.onEvent('hud');
    return this.enemies.id[slot];
  }

  grantBoon(id: string): void {
    const boon = boons.find(boon => boon.id === id);
    if (!boon) throw new Error(`未知祝福: ${id}`);
    if (this.boonIds.includes(id)) throw new Error('祝福已达到层数上限');
    this.boonIds.push(id);
    this.effects.push(boon);
    this.effects.sort((first, second) => boons.indexOf(first) - boons.indexOf(second));
    this.onEvent('hud');
  }

  chooseBoon(id: string): void {
    if (this.phase !== 'reward') throw new Error('当前不能选择奖励');
    this.grantBoon(id);
    this.teleport(1, 0);
  }

  teleport(roomX: number, roomY: number): void {
    if (!Number.isInteger(roomX) || roomX < 0 || roomX > 1 || roomY !== 0) throw new Error('房间坐标不存在');
    this.roomX = roomX;
    this.roomY = roomY;
    this.loadRoom(rooms[roomX]);
  }

  private loadRoom(room: Room): void {
    this.room = room;
    this.phase = 'playing';
    this.enemies.clear();
    this.bullets.clear();
    this.encounter = false;
    this.dashTicks = this.dashCooldown = this.fireCooldown = this.hitstop = 0;
    this.invulnerable = 30;
    this.player.vx[0] = this.player.vz[0] = 0;
    room.rows.forEach((row, z) => [...row].forEach((cell, x) => {
      if (cell === 'P') { this.player.x[0] = x + 0.5; this.player.z[0] = z + 0.5; }
      if (cell === 'E') this.spawnEnemy('melee', x + 0.5, z + 0.5);
    }));
    this.updatePaths();
    this.onEvent('hud');
  }

  getState() {
    return {
      ready: true, seed: this.seed, tick: this.tickCount, combatTick: this.combatTick,
      paused: this.paused, phase: this.phase, rng: this.rng.state,
      fixedDeltaSeconds: FIXED_DELTA, simulationTimeSeconds: this.combatTick * FIXED_DELTA,
      hitstopTicksRemaining: this.hitstop, dashTicks: this.dashTicks, dashCooldown: this.dashCooldown,
      invulnerableTicksRemaining: this.invulnerable,
      room: { id: this.room.id, roomX: this.roomX, roomY: this.roomY, cleared: !this.enemies.count },
      player: this.serialize(this.player)[0], enemies: this.serialize(this.enemies), projectiles: this.serialize(this.bullets),
      boons: [...this.boonIds], gold: this.gold, kills: this.kills,
      damageDealt: this.damageDealt, damageTaken: this.damageTaken, rejectedBullets: this.rejectedBullets,
    };
  }

  private serialize(pool: EntityPool) {
    return Array.from(pool.active.subarray(0, pool.count), slot => ({
      entityId: pool.id[slot], x: pool.x[slot], z: pool.z[slot], vx: pool.vx[slot], vz: pool.vz[slot],
      hp: pool.hp[slot], life: pool.life[slot], flash: pool.flash[slot], bounce: pool.bounce[slot], damage: pool.damage[slot],
      speed: pool.speed[slot],
    })).sort((first, second) => first.entityId - second.entityId);
  }
}
