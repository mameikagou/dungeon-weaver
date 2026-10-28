export interface FireContext { shots: number; damage: number; speed: number }
export interface BulletContext { bounce: number }
export interface HitContext { healing: number }
export interface DashContext { duration: number }

export interface Boon {
  id: string;
  name: string;
  icon: string;
  description: string;
  onFire?: (context: FireContext) => void;
  onSpawnBullet?: (context: BulletContext) => void;
  onHit?: (context: HitContext) => void;
  onDash?: (context: DashContext) => void;
}

export const boons: readonly Boon[] = [
  { id: 'split-shot', name: '分岔之光', icon: '⋔', description: '每次攻击向三个方向发射灵弹。', onFire: context => { context.shots += 2; } },
  { id: 'bounce', name: '回声石', icon: '◇', description: '灵弹碰到墙壁后，最多反弹两次。', onSpawnBullet: context => { context.bounce += 2; } },
  { id: 'leech', name: '苔心', icon: '❧', description: '每次命中恢复 1 点生命。', onHit: context => { context.healing += 1; } },
  { id: 'rush', name: '流风', icon: '↝', description: '冲刺持续时间增加，沿途保持无敌。', onDash: context => { context.duration += 5; } },
  { id: 'power', name: '余烬', icon: '✦', description: '灵弹伤害提升 50%。', onFire: context => { context.damage *= 1.5; } },
];

export function calcPlayerStats(ids: readonly string[]): FireContext {
  const stats = { shots: 1, damage: 18, speed: 18 };
  for (const boon of boons) if (ids.includes(boon.id)) boon.onFire?.(stats);
  return stats;
}
