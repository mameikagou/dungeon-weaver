export class EntityPool {
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vz: Float32Array;
  readonly hp: Float32Array;
  readonly radius: Float32Array;
  readonly damage: Float32Array;
  readonly speed: Float32Array;
  readonly life: Int32Array;
  readonly flash: Int32Array;
  readonly bounce: Int32Array;
  readonly id: Uint32Array;
  readonly active: Int32Array;
  readonly kind: Uint8Array;
  readonly state: Uint8Array;
  readonly timer: Int32Array;
  readonly facingX: Float32Array;
  readonly facingZ: Float32Array;
  readonly maxHp: Float32Array;
  readonly attack: Int32Array;
  readonly pierce: Int32Array;
  readonly poise: Float32Array;
  readonly maxPoise: Float32Array;
  readonly poiseDelay: Int32Array;
  readonly poiseDamage: Float32Array;
  private readonly free: Int32Array;
  private readonly index: Int32Array;
  private freeCount: number;
  private serial = 0;
  count = 0;

  constructor(readonly capacity: number) {
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.hp = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.damage = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.life = new Int32Array(capacity);
    this.flash = new Int32Array(capacity);
    this.bounce = new Int32Array(capacity);
    this.id = new Uint32Array(capacity);
    this.active = new Int32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.state = new Uint8Array(capacity);
    this.timer = new Int32Array(capacity);
    this.facingX = new Float32Array(capacity);
    this.facingZ = new Float32Array(capacity);
    this.maxHp = new Float32Array(capacity);
    this.attack = new Int32Array(capacity);
    this.pierce = new Int32Array(capacity);
    this.poise = new Float32Array(capacity);
    this.maxPoise = new Float32Array(capacity);
    this.poiseDelay = new Int32Array(capacity);
    this.poiseDamage = new Float32Array(capacity);
    this.index = new Int32Array(capacity).fill(-1);
    this.free = Int32Array.from({ length: capacity }, (_, slot) => capacity - slot - 1);
    this.freeCount = capacity;
  }

  allocate(): number {
    if (!this.freeCount) return -1;
    const slot = this.free[--this.freeCount];
    this.id[slot] = ++this.serial;
    this.index[slot] = this.count;
    this.active[this.count++] = slot;
    this.x[slot] = this.z[slot] = this.vx[slot] = this.vz[slot] = 0;
    this.hp[slot] = this.damage[slot] = this.radius[slot] = this.speed[slot] = 0;
    this.life[slot] = this.flash[slot] = this.bounce[slot] = 0;
    this.kind[slot] = this.state[slot] = this.timer[slot] = this.attack[slot] = this.pierce[slot] = 0;
    this.facingX[slot] = this.facingZ[slot] = this.maxHp[slot] = 0;
    this.poise[slot] = this.maxPoise[slot] = this.poiseDelay[slot] = this.poiseDamage[slot] = 0;
    return slot;
  }

  remove(slot: number): void {
    const index = this.index[slot];
    if (index < 0) return;
    const tail = this.active[--this.count];
    this.active[index] = tail;
    this.index[tail] = index;
    this.index[slot] = -1;
    this.id[slot] = 0;
    this.free[this.freeCount++] = slot;
  }

  clear(): void {
    while (this.count) this.remove(this.active[this.count - 1]);
  }
}
