import { boons, boonChoices, calcPlayerStats, type Boon } from '../content/boons';
import { canStand, rooms, dungeonRooms, ROOM_HEIGHT, ROOM_WIDTH, type Room } from '../content/rooms';
import { enemyTypes, enemySymbols, enemyStates } from '../content/enemies';
import { EntityPool } from './pool';
import { SeededRNG } from './random';
import { SpatialGrid } from './spatial-grid';

export const FIXED_DELTA = 1 / 60;
const NEIGHBORS = [-1, 1, -ROOM_WIDTH, ROOM_WIDTH];
export interface GameInput {
  moveX: number;
  moveZ: number;
  aimX: number;
  aimZ: number;
  attack: boolean;
  dash: boolean;
  charge: boolean;
}
export type GameEvent = 'hud' | 'fire' | 'heavy' | 'hit' | 'hurt' | 'block' | 'dash' | 'clear' | 'warning';
export type Phase = 'playing' | 'reward' | 'dead' | 'won';
export interface Zone {
  x: number;
  z: number;
  radius: number;
  startsAt: number;
  endsAt: number;
  kind: 'blast' | 'trail';
}
export interface VisualEffect {
  x: number;
  z: number;
  born: number;
  duration: number;
  kind: 'impact' | 'death' | 'afterimage' | 'block';
}

export class Simulation {
  readonly player = new EntityPool(1);
  readonly enemies = new EntityPool(2000);
  readonly bullets = new EntityPool(5000);
  private readonly grid = new SpatialGrid(ROOM_WIDTH, ROOM_HEIGHT, this.enemies.capacity);
  private readonly distances = new Int16Array(ROOM_WIDTH * ROOM_HEIGHT);
  private readonly queue = new Int16Array(ROOM_WIDTH * ROOM_HEIGHT);
  readonly input: GameInput = { moveX: 0, moveZ: 0, aimX: 0, aimZ: -1, attack: false, dash: false, charge: false };
  readonly boonIds: string[] = [];
  private readonly effects: Boon[] = [];
  readonly zones: Zone[] = [];
  readonly visuals: VisualEffect[] = [];
  private readonly pierced = new Map<number, Set<number>>();
  private readonly trailHitTick = new Int32Array(this.enemies.capacity);
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
  chargeTicks = 0;
  recoilTicks = 0;
  empoweredTicks = 0;
  shakeTicks = 0;
  wave = 0;
  waveDelay = 0;
  private chargeHeld = false;
  private chargeCancelled = false;
  private dashTrail = false;
  private dashHeld = false;
  private dashX = 0;
  private dashZ = -1;
  private fireCooldown = 0;
  private invulnerable = 0;
  private encounter = false;
  onEvent: (event: GameEvent) => void = () => {};

  constructor(
    readonly seed = 42,
    roomId: string = 'moss-hall',
  ) {
    this.rng = new SeededRNG(seed);
    const room = rooms.find((room) => room.id === roomId);
    if (!room) throw new Error(`未知房间: ${roomId}`);
    this.room = room;
    this.roomX = Math.max(
      0,
      dungeonRooms.findIndex((candidate) => candidate.id === room.id),
    );
    this.player.allocate();
    this.player.hp[0] = 100;
    this.player.radius[0] = 0.3;
    this.loadRoom(room);
  }

  setInput(input: GameInput): void {
    if (![input.moveX, input.moveZ, input.aimX, input.aimZ].every(Number.isFinite)) throw new Error('输入必须有限');
    const aimLength = Math.hypot(input.aimX, input.aimZ);
    if (aimLength < 0.0001 || [input.attack, input.dash, input.charge].some((value) => typeof value !== 'boolean'))
      throw new Error('输入无效');
    const moveLength = Math.max(1, Math.hypot(input.moveX, input.moveZ));
    Object.assign(this.input, input, {
      moveX: input.moveX / moveLength,
      moveZ: input.moveZ / moveLength,
      aimX: input.aimX / aimLength,
      aimZ: input.aimZ / aimLength,
    });
  }

  tick(): void {
    this.tickCount++;
    if (this.phase !== 'playing') return;
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    this.combatTick++;
    if (this.shakeTicks > 0) this.shakeTicks--;
    for (let index = this.visuals.length - 1; index >= 0; index--) {
      const effect = this.visuals[index];
      if (this.combatTick >= effect.born + effect.duration) this.visuals.splice(index, 1);
    }
    if (this.combatTick % 15 === 1) this.updatePaths();
    this.updatePlayer();
    this.updateEnemies();
    if (this.phase !== 'playing') return;
    this.grid.rebuild(this.enemies);
    this.updateBullets();
    this.updateZones();
    if (this.encounter && !this.enemies.count && this.phase === 'playing') {
      this.finishWave();
    }
  }

  private updatePlayer(): void {
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.dashCooldown > 0) this.dashCooldown--;
    if (this.player.flash[0] > 0) this.player.flash[0]--;
    if (this.recoilTicks > 0) this.recoilTicks--;
    if (this.empoweredTicks > 0) this.empoweredTicks--;
    if (this.input.dash && !this.dashHeld && !this.dashCooldown) this.startDash();
    this.dashHeld = this.input.dash;
    const dashing = this.dashTicks > 0;
    if (!this.input.charge && !this.chargeHeld) this.chargeCancelled = false;
    const charging = this.input.charge && !this.chargeCancelled && !dashing;
    const speed = dashing ? 15 : charging ? 2.5 : 4.8;
    this.player.vx[0] = (dashing ? this.dashX : this.input.moveX) * speed;
    this.player.vz[0] = (dashing ? this.dashZ : this.input.moveZ) * speed;
    this.move(this.player, 0);
    if (dashing && this.combatTick % 2 === 0) this.addVisual('afterimage', this.player.x[0], this.player.z[0]);
    if (dashing && this.dashTrail && this.combatTick % 3 === 0) {
      this.zones.push({
        x: this.player.x[0],
        z: this.player.z[0],
        radius: 0.6,
        kind: 'trail',
        startsAt: this.combatTick,
        endsAt: this.combatTick + 60,
      });
    }
    if (this.dashTicks > 0) this.dashTicks--;
    if (this.fireCooldown > 0) this.fireCooldown--;
    if (charging) this.chargeTicks = Math.min(60, this.chargeTicks + 1);
    if (!this.input.charge && this.chargeHeld) {
      if (this.chargeTicks >= 12 && !this.chargeCancelled && !dashing) this.fire(this.chargeTicks / 60);
      this.chargeTicks = 0;
      this.chargeCancelled = false;
    }
    this.chargeHeld = this.input.charge;
    if (this.input.attack && !this.input.charge && !dashing && !this.fireCooldown) this.fire(0);
  }

  cancelCharge(): void {
    this.chargeTicks = 0;
    this.chargeHeld = false;
    this.chargeCancelled = false;
  }

  private startDash(): void {
    const context = { trail: false, empower: false };
    for (const effect of this.effects) effect.onDash?.(context);
    this.dashTicks = 10;
    this.invulnerable = 11;
    this.dashCooldown = 48;
    this.dashTrail = context.trail;
    if (context.empower) this.empoweredTicks = 120;
    this.chargeCancelled = true;
    this.chargeTicks = 0;
    const moving = Math.hypot(this.input.moveX, this.input.moveZ) > 0;
    this.dashX = moving ? this.input.moveX : this.input.aimX;
    this.dashZ = moving ? this.input.moveZ : this.input.aimZ;
    this.onEvent('dash');
  }

  private fire(charge: number): void {
    const stats = calcPlayerStats(this.boonIds);
    const context = { bounce: 0, bounceBoost: 1 };
    for (const effect of this.effects) effect.onSpawnBullet?.(context);
    const aim = Math.atan2(this.input.aimZ, this.input.aimX);
    for (let shot = 0; shot < stats.shots; shot++) {
      const slot = this.bullets.allocate();
      if (slot < 0) {
        this.rejectedBullets++;
        continue;
      }
      const angle = aim + (shot - (stats.shots - 1) / 2) * 0.22;
      this.bullets.x[slot] = this.player.x[0];
      this.bullets.z[slot] = this.player.z[0];
      const speed = stats.speed * (charge ? 1.5 : 1);
      this.bullets.vx[slot] = Math.cos(angle) * speed;
      this.bullets.vz[slot] = Math.sin(angle) * speed;
      this.bullets.damage[slot] = stats.damage * (charge ? 1 + 4 * charge : 1) * (this.empoweredTicks ? 2 : 1);
      this.bullets.radius[slot] = charge ? 0.22 : 0.12;
      this.bullets.life[slot] = 100;
      this.bullets.bounce[slot] = context.bounce;
      this.bullets.speed[slot] = context.bounceBoost;
      this.bullets.kind[slot] = charge ? 1 : 0;
      this.bullets.pierce[slot] = charge ? 8 : 1;
      if (charge) this.pierced.set(this.bullets.id[slot], new Set());
    }
    this.fireCooldown = 12;
    this.empoweredTicks = 0;
    this.recoilTicks = charge ? 10 : 5;
    if (charge) this.shakeTicks = 5;
    this.onEvent(charge ? 'heavy' : 'fire');
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
      this.updateEnemyAction(slot);
      this.move(this.enemies, slot);
      const distance = Math.hypot(this.enemies.x[slot] - this.player.x[0], this.enemies.z[slot] - this.player.z[0]);
      if (distance < this.enemies.radius[slot] + 0.3 && this.enemies.state[slot] !== 3)
        this.hurtPlayer(this.enemies.damage[slot]);
    }
  }

  private updateEnemyAction(slot: number): void {
    const pool = this.enemies;
    const kind = pool.kind[slot];
    const distance = Math.hypot(this.player.x[0] - pool.x[slot], this.player.z[0] - pool.z[slot]);
    pool.vx[slot] = pool.vz[slot] = 0;
    if (pool.timer[slot] > 0) pool.timer[slot]--;
    if (pool.state[slot] === 0) {
      this.steerEnemy(slot);
      pool.facingX[slot] = (this.player.x[0] - pool.x[slot]) / Math.max(0.001, distance);
      pool.facingZ[slot] = (this.player.z[0] - pool.z[slot]) / Math.max(0.001, distance);
      if (kind === 1 && distance < 7) pool.vx[slot] = pool.vz[slot] = 0;
      const range = kind === 2 ? 2.2 : kind === 3 ? 30 : 8;
      if (!pool.timer[slot] && distance < range && this.lineOfSight(pool.x[slot], pool.z[slot])) this.windupEnemy(slot);
    } else if (pool.state[slot] === 1 && !pool.timer[slot]) {
      this.attackEnemy(slot);
    } else if (pool.state[slot] === 2) {
      const charging = kind === 0 || (kind === 3 && pool.attack[slot] % 3 === 0);
      if (charging) {
        pool.vx[slot] = pool.facingX[slot] * 10;
        pool.vz[slot] = pool.facingZ[slot] * 10;
        if (
          !canStand(this.room, pool.x[slot] + pool.vx[slot] / 60, pool.z[slot] + pool.vz[slot] / 60, pool.radius[slot])
        )
          pool.timer[slot] = 0;
      }
      if (!pool.timer[slot]) {
        pool.state[slot] = 3;
        pool.timer[slot] = kind === 3 && pool.hp[slot] < pool.maxHp[slot] / 2 ? 28 : 65;
        pool.vx[slot] = pool.vz[slot] = 0;
      }
    } else if (pool.state[slot] === 3 && !pool.timer[slot]) {
      pool.state[slot] = 0;
      pool.timer[slot] = 25;
      pool.attack[slot]++;
    }
  }

  private lineOfSight(x: number, z: number): boolean {
    const steps = Math.ceil(Math.hypot(this.player.x[0] - x, this.player.z[0] - z) * 5);
    for (let step = 1; step <= steps; step++) {
      if (
        !canStand(
          this.room,
          x + ((this.player.x[0] - x) * step) / steps,
          z + ((this.player.z[0] - z) * step) / steps,
          0.05,
        )
      )
        return false;
    }
    return true;
  }

  private windupEnemy(slot: number): void {
    const pool = this.enemies;
    const kind = pool.kind[slot];
    pool.state[slot] = 1;
    pool.timer[slot] = kind === 2 ? 38 : 48;
    pool.vx[slot] = pool.vz[slot] = 0;
    if (kind === 1 || (kind === 3 && pool.attack[slot] % 3 === 1)) {
      const offsets = kind === 3 ? [-2.2, 0, 2.2] : [0];
      for (const offset of offsets) {
        const x = Math.max(2, Math.min(18, this.player.x[0] + offset));
        const z = this.player.z[0];
        this.zones.push({
          x,
          z,
          radius: kind === 3 ? 1.55 : 1.25,
          kind: 'blast',
          startsAt: this.combatTick + 60,
          endsAt: this.combatTick + 120,
        });
      }
    }
    this.onEvent('warning');
  }

  private attackEnemy(slot: number): void {
    const pool = this.enemies;
    const kind = pool.kind[slot];
    pool.state[slot] = 2;
    pool.timer[slot] = kind === 0 || kind === 3 ? 40 : 12;
    if (kind === 2) {
      const dx = this.player.x[0] - pool.x[slot];
      const dz = this.player.z[0] - pool.z[slot];
      const distance = Math.hypot(dx, dz);
      if (distance < 2.5 && (dx * pool.facingX[slot] + dz * pool.facingZ[slot]) / Math.max(0.001, distance) > 0.2)
        this.hurtPlayer(18);
    }
    if (kind === 3 && pool.attack[slot] % 3 === 2) this.fireFan(slot);
  }

  private fireFan(enemy: number): void {
    const angle = Math.atan2(this.enemies.facingZ[enemy], this.enemies.facingX[enemy]);
    const enraged = this.enemies.hp[enemy] < this.enemies.maxHp[enemy] / 2;
    for (let index = -4; index <= 4; index++) {
      const slot = this.bullets.allocate();
      if (slot < 0) {
        this.rejectedBullets++;
        continue;
      }
      this.bullets.x[slot] = this.enemies.x[enemy];
      this.bullets.z[slot] = this.enemies.z[enemy];
      this.bullets.vx[slot] = Math.cos(angle + index * 0.22) * (enraged ? 8 : 6);
      this.bullets.vz[slot] = Math.sin(angle + index * 0.22) * (enraged ? 8 : 6);
      this.bullets.kind[slot] = 2;
      this.bullets.radius[slot] = 0.18;
      this.bullets.damage[slot] = 16;
      this.bullets.life[slot] = 200;
    }
  }

  private hurtPlayer(amount: number): void {
    if (this.invulnerable || this.phase !== 'playing') return;
    const damage = Math.min(this.player.hp[0], amount);
    this.player.hp[0] -= damage;
    this.damageTaken += damage;
    this.player.flash[0] = 12;
    this.invulnerable = 45;
    this.shakeTicks = 8;
    this.hitstop = 3;
    if (!this.player.hp[0]) {
      this.phase = 'dead';
      this.chargeTicks = 0;
    }
    this.onEvent('hurt');
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
    const targetX = close ? this.player.x[0] : (best % ROOM_WIDTH) + 0.5;
    const targetZ = close ? this.player.z[0] : Math.floor(best / ROOM_WIDTH) + 0.5;
    const distance = Math.max(0.01, Math.hypot(targetX - x, targetZ - z));
    const speed = this.enemies.speed[slot];
    this.enemies.vx[slot] = ((targetX - x) / distance) * speed;
    this.enemies.vz[slot] = ((targetZ - z) / distance) * speed;
  }

  private updateBullets(): void {
    for (let index = this.bullets.count - 1; index >= 0; index--) {
      if (this.phase !== 'playing') return;
      const slot = this.bullets.active[index];
      if (--this.bullets.life[slot] <= 0) {
        this.removeBullet(slot);
        continue;
      }
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
      if (!pool.bounce[slot]) {
        this.removeBullet(slot);
        return;
      }
      pool.bounce[slot]--;
      pool.damage[slot] *= pool.speed[slot];
      const blockedX = !canStand(this.room, nextX, pool.z[slot], pool.radius[slot]);
      const blockedZ = !canStand(this.room, pool.x[slot], nextZ, pool.radius[slot]);
      if (blockedX || !blockedZ) pool.vx[slot] *= -1;
      if (blockedZ || !blockedX) pool.vz[slot] *= -1;
      return;
    }
    pool.x[slot] = nextX;
    pool.z[slot] = nextZ;
    if (pool.kind[slot] === 2) {
      if (Math.hypot(this.player.x[0] - nextX, this.player.z[0] - nextZ) < 0.3 + pool.radius[slot]) {
        this.hurtPlayer(pool.damage[slot]);
        this.removeBullet(slot);
      }
      return;
    }
    const hits = this.pierced.get(pool.id[slot]);
    const count = this.grid.query(nextX, nextZ, 0.7 + pool.radius[slot]);
    for (let index = 0; index < count; index++) {
      const enemy = this.grid.results[index];
      if (!this.enemies.id[enemy] || hits?.has(this.enemies.id[enemy])) continue;
      if (
        Math.hypot(this.enemies.x[enemy] - nextX, this.enemies.z[enemy] - nextZ) >
        this.enemies.radius[enemy] + pool.radius[slot]
      )
        continue;
      const facing = pool.vx[slot] * this.enemies.facingX[enemy] + pool.vz[slot] * this.enemies.facingZ[enemy];
      if (
        this.enemies.kind[enemy] === 2 &&
        this.enemies.state[enemy] !== 3 &&
        facing < -0.5 * Math.hypot(pool.vx[slot], pool.vz[slot])
      ) {
        this.addVisual('block', nextX, nextZ);
        this.onEvent('block');
        this.removeBullet(slot);
        break;
      }
      hits?.add(this.enemies.id[enemy]);
      this.hitEnemy(enemy, pool.damage[slot], pool.kind[slot] === 1);
      if (--pool.pierce[slot] <= 0) {
        this.removeBullet(slot);
        break;
      }
    }
  }

  private removeBullet(slot: number): void {
    this.pierced.delete(this.bullets.id[slot]);
    this.bullets.remove(slot);
  }

  private hitEnemy(slot: number, damage: number, heavy = false): void {
    this.damageDealt += Math.min(this.enemies.hp[slot], damage);
    this.enemies.hp[slot] -= damage;
    this.enemies.flash[slot] = 7;
    this.hitstop = heavy ? 4 : 1;
    if (heavy) this.shakeTicks = 6;
    const x = this.enemies.x[slot];
    const z = this.enemies.z[slot];
    const distance = Math.max(0.01, Math.hypot(x - this.player.x[0], z - this.player.z[0]));
    const push = heavy ? 0.5 : 0.12;
    const pushedX = x + ((x - this.player.x[0]) / distance) * push;
    const pushedZ = z + ((z - this.player.z[0]) / distance) * push;
    if (this.enemies.kind[slot] !== 3 && canStand(this.room, pushedX, pushedZ, this.enemies.radius[slot])) {
      this.enemies.x[slot] = pushedX;
      this.enemies.z[slot] = pushedZ;
    }
    this.addVisual('impact', x, z);
    if (this.enemies.hp[slot] <= 0) {
      const context = { distance, resetDash: false };
      for (const effect of this.effects) effect.onKill?.(context);
      if (context.resetDash) {
        this.dashCooldown = 0;
        this.player.hp[0] = Math.min(100, this.player.hp[0] + 3);
      }
      this.addVisual('death', x, z);
      this.enemies.remove(slot);
      this.gold += 5;
      this.kills++;
    }
    this.onEvent('hit');
  }

  spawnEnemy(id: string, x: number, z: number): number {
    const kind = enemyTypes.findIndex((type) => type.id === id);
    if (kind < 0) throw new Error(`未知敌人: ${id}`);
    const definition = enemyTypes[kind];
    if (!canStand(this.room, x, z, definition.radius)) throw new Error('敌人位置不可通行');
    const slot = this.enemies.allocate();
    if (slot < 0) throw new Error('敌人对象池已满');
    this.enemies.x[slot] = x;
    this.enemies.z[slot] = z;
    this.enemies.hp[slot] = this.enemies.maxHp[slot] = definition.hp;
    this.enemies.radius[slot] = definition.radius;
    this.enemies.speed[slot] = definition.speed * (0.95 + this.rng.next() * 0.1);
    this.enemies.damage[slot] = definition.damage;
    this.enemies.kind[slot] = kind;
    this.enemies.timer[slot] = 60;
    this.enemies.facingZ[slot] = 1;
    this.trailHitTick[slot] = 0;
    this.encounter = true;
    this.phase = 'playing';
    this.onEvent('hud');
    return this.enemies.id[slot];
  }

  grantBoon(id: string): void {
    const boon = boons.find((boon) => boon.id === id);
    if (!boon) throw new Error(`未知祝福: ${id}`);
    if (this.boonIds.includes(id)) throw new Error('祝福已达到层数上限');
    this.boonIds.push(id);
    this.effects.push(boon);
    this.effects.sort((first, second) => boons.indexOf(first) - boons.indexOf(second));
    this.onEvent('hud');
  }

  chooseBoon(id: string): void {
    if (this.phase !== 'reward') throw new Error('当前不能选择奖励');
    if (!boonChoices(this.boonIds, this.roomX).some((boon) => boon.id === id)) throw new Error('该祝福不在本次奖励中');
    this.grantBoon(id);
    this.teleport(this.roomX + 1, 0);
  }

  continueJourney(): void {
    if (this.phase !== 'reward' || boonChoices(this.boonIds, this.roomX).length) throw new Error('请先选择祝福');
    this.teleport(this.roomX + 1, 0);
  }

  teleport(roomX: number, roomY: number): void {
    if (!Number.isInteger(roomX) || roomX < 0 || roomX >= dungeonRooms.length || roomY !== 0)
      throw new Error('房间坐标不存在');
    this.roomX = roomX;
    this.roomY = roomY;
    this.loadRoom(dungeonRooms[roomX]);
  }

  private loadRoom(room: Room): void {
    this.room = room;
    this.phase = 'playing';
    this.enemies.clear();
    this.bullets.clear();
    this.pierced.clear();
    this.zones.length = this.visuals.length = 0;
    this.encounter = false;
    this.dashTicks = this.dashCooldown = this.fireCooldown = this.hitstop = 0;
    this.wave = this.waveDelay = this.chargeTicks = this.recoilTicks = this.empoweredTicks = this.shakeTicks = 0;
    this.chargeHeld = this.dashHeld = this.chargeCancelled = this.dashTrail = false;
    this.player.flash[0] = 0;
    this.invulnerable = 30;
    this.player.vx[0] = this.player.vz[0] = 0;
    room.rows.forEach((row, z) =>
      [...row].forEach((cell, x) => {
        if (cell === 'P') {
          this.player.x[0] = x + 0.5;
          this.player.z[0] = z + 0.5;
        }
      }),
    );
    this.spawnWave();
    this.updatePaths();
    this.onEvent('hud');
  }

  private spawnWave(): void {
    this.room.rows.forEach((row, z) =>
      [...row].forEach((cell, x) => {
        if (enemySymbols[cell]) this.spawnEnemy(enemySymbols[cell], x + 0.5, z + 0.5);
      }),
    );
    this.invulnerable = 60;
    this.onEvent('hud');
  }

  private finishWave(): void {
    if (this.wave + 1 < this.room.waves) {
      if (!this.waveDelay) {
        this.waveDelay = 90;
        this.bullets.clear();
        this.pierced.clear();
        this.zones.length = 0;
        this.onEvent('hud');
      } else if (--this.waveDelay === 0) {
        this.wave++;
        this.spawnWave();
      }
      return;
    }
    this.phase = this.roomX === dungeonRooms.length - 1 ? 'won' : 'reward';
    this.player.hp[0] = Math.min(100, this.player.hp[0] + 12);
    this.bullets.clear();
    this.pierced.clear();
    this.zones.length = 0;
    this.chargeTicks = this.empoweredTicks = 0;
    this.onEvent('clear');
  }

  private updateZones(): void {
    for (let index = this.zones.length - 1; index >= 0; index--) {
      if (this.phase !== 'playing') return;
      const zone = this.zones[index];
      if (this.combatTick >= zone.endsAt) {
        this.zones.splice(index, 1);
        continue;
      }
      if (this.combatTick < zone.startsAt) continue;
      if (zone.kind === 'blast') {
        if (Math.hypot(this.player.x[0] - zone.x, this.player.z[0] - zone.z) < zone.radius + 0.3) this.hurtPlayer(16);
      } else {
        for (let enemyIndex = this.enemies.count - 1; enemyIndex >= 0; enemyIndex--) {
          const slot = this.enemies.active[enemyIndex];
          if (this.combatTick < this.trailHitTick[slot]) continue;
          if (
            Math.hypot(this.enemies.x[slot] - zone.x, this.enemies.z[slot] - zone.z) >
            zone.radius + this.enemies.radius[slot]
          )
            continue;
          this.trailHitTick[slot] = this.combatTick + 15;
          this.hitEnemy(slot, 12);
        }
      }
    }
  }

  private addVisual(kind: VisualEffect['kind'], x: number, z: number): void {
    if (this.visuals.length >= 128) this.visuals.shift();
    this.visuals.push({ kind, x, z, born: this.combatTick, duration: kind === 'death' ? 24 : 14 });
  }

  getState() {
    return {
      ready: true,
      seed: this.seed,
      tick: this.tickCount,
      combatTick: this.combatTick,
      paused: this.paused,
      phase: this.phase,
      rng: this.rng.state,
      fixedDeltaSeconds: FIXED_DELTA,
      simulationTimeSeconds: this.combatTick * FIXED_DELTA,
      hitstopTicksRemaining: this.hitstop,
      dashTicks: this.dashTicks,
      dashCooldown: this.dashCooldown,
      invulnerableTicksRemaining: this.invulnerable,
      chargeTicks: this.chargeTicks,
      empoweredTicks: this.empoweredTicks,
      recoilTicks: this.recoilTicks,
      room: {
        id: this.room.id,
        roomX: this.roomX,
        roomY: this.roomY,
        cleared: this.phase === 'reward' || this.phase === 'won',
        wave: this.wave + 1,
        waves: this.room.waves,
        nextWaveTicks: this.waveDelay,
      },
      player: this.serialize(this.player)[0],
      enemies: this.serialize(this.enemies).map((enemy) => ({
        ...enemy,
        type: enemyTypes[enemy.kind].id,
        action: enemyStates[enemy.state],
        enraged: enemy.kind === 3 && enemy.hp < enemy.maxHp / 2,
      })),
      projectiles: this.serialize(this.bullets),
      zones: this.zones.map((zone) => ({ ...zone })),
      rewardChoices: this.phase === 'reward' ? boonChoices(this.boonIds, this.roomX).map((boon) => boon.id) : [],
      boons: [...this.boonIds],
      gold: this.gold,
      kills: this.kills,
      damageDealt: this.damageDealt,
      damageTaken: this.damageTaken,
      rejectedBullets: this.rejectedBullets,
    };
  }

  private serialize(pool: EntityPool) {
    return Array.from(pool.active.subarray(0, pool.count), (slot) => ({
      entityId: pool.id[slot],
      x: pool.x[slot],
      z: pool.z[slot],
      vx: pool.vx[slot],
      vz: pool.vz[slot],
      hp: pool.hp[slot],
      life: pool.life[slot],
      flash: pool.flash[slot],
      bounce: pool.bounce[slot],
      damage: pool.damage[slot],
      speed: pool.speed[slot],
      kind: pool.kind[slot],
      state: pool.state[slot],
      timer: pool.timer[slot],
      facingX: pool.facingX[slot],
      facingZ: pool.facingZ[slot],
      maxHp: pool.maxHp[slot],
      attack: pool.attack[slot],
      pierce: pool.pierce[slot],
    })).sort((first, second) => first.entityId - second.entityId);
  }
}
