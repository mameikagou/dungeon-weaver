export const swordMoves = [
  { name: '横斩', startup: 8, active: 6, recovery: 12, damage: 60, poise: 12, cost: 14, reach: 2.1, arc: 2.2 },
  { name: '回斩', startup: 9, active: 6, recovery: 14, damage: 70, poise: 15, cost: 16, reach: 2.2, arc: 2.6 },
  { name: '终结斩', startup: 13, active: 8, recovery: 18, damage: 100, poise: 25, cost: 22, reach: 2.5, arc: 2.8 },
  { name: '蓄力重斩', startup: 12, active: 10, recovery: 24, damage: 90, poise: 18, cost: 28, reach: 2.6, arc: 2.8 },
] as const;

export type Weapon = 'greatsword' | 'focus';
export interface SwordSwing {
  move: number;
  age: number;
  angle: number;
  damage: number;
  poise: number;
}

export function swingAngle(swing: SwordSwing, age = swing.age): number {
  const move = swordMoves[swing.move];
  const progress = Math.max(0, Math.min(1, (age - move.startup + 1) / move.active));
  const direction = swing.move === 1 ? -1 : 1;
  if (age < move.startup) return swing.angle - ((direction * move.arc) / 2) * (age / (move.startup - 1));
  if (age >= move.startup + move.active) {
    const recovery = (age - move.startup - move.active) / move.recovery;
    return swing.angle + ((direction * move.arc) / 2) * (1 - recovery);
  }
  return swing.angle + direction * (progress - 0.5) * move.arc;
}

export const STAMINA_MAX = 100;
export const ROLL_COST = 24;
export const ROLL_TICKS = 18;
export const STAMINA_DELAY = 45;
