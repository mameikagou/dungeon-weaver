import type { EntityPool } from './pool';

export class SpatialGrid {
  private readonly heads: Int32Array;
  private readonly next: Int32Array;
  readonly results: Int32Array;

  constructor(readonly width: number, readonly height: number, capacity: number) {
    this.heads = new Int32Array(width * height);
    this.next = new Int32Array(capacity);
    this.results = new Int32Array(capacity);
  }

  rebuild(pool: EntityPool): void {
    this.heads.fill(-1);
    for (let index = 0; index < pool.count; index++) {
      const slot = pool.active[index];
      const cell = Math.floor(pool.z[slot]) * this.width + Math.floor(pool.x[slot]);
      this.next[slot] = this.heads[cell];
      this.heads[cell] = slot;
    }
  }

  query(x: number, z: number, radius: number): number {
    let count = 0;
    const left = Math.max(0, Math.floor(x - radius));
    const right = Math.min(this.width - 1, Math.floor(x + radius));
    const top = Math.max(0, Math.floor(z - radius));
    const bottom = Math.min(this.height - 1, Math.floor(z + radius));
    for (let row = top; row <= bottom; row++) {
      for (let column = left; column <= right; column++) {
        let slot = this.heads[row * this.width + column];
        while (slot >= 0) {
          this.results[count++] = slot;
          slot = this.next[slot];
        }
      }
    }
    return count;
  }
}
