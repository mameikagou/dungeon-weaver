export class SeededRNG {
  state: number;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) throw new Error('种子必须是安全整数');
    this.state = ((seed % 2147483646) + 2147483646) % 2147483646 + 1;
  }

  next(): number {
    this.state = this.state * 16807 % 2147483647;
    return (this.state - 1) / 2147483646;
  }
}
