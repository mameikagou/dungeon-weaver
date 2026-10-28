export interface FireContext {
  shots: number;
  damage: number;
  speed: number;
}
export interface BulletContext {
  bounce: number;
  bounceBoost: number;
}
export interface DashContext {
  trail: boolean;
  empower: boolean;
}
export interface KillContext {
  distance: number;
  resetDash: boolean;
}

export interface Boon {
  id: string;
  name: string;
  icon: string;
  route: '弹幕' | '突进';
  description: string;
  onFire?: (context: FireContext) => void;
  onSpawnBullet?: (context: BulletContext) => void;
  onDash?: (context: DashContext) => void;
  onKill?: (context: KillContext) => void;
}

export const boons: readonly Boon[] = [
  {
    id: 'split-shot',
    name: '分岔之光',
    icon: '⋔',
    route: '弹幕',
    description: '普通射击和蓄力射击都增加两发散射灵弹。',
    onFire: (context) => {
      context.shots += 2;
    },
  },
  {
    id: 'trail',
    name: '烬行',
    icon: '↝',
    route: '突进',
    description: '冲刺留下燃烧轨迹，持续 1 秒；敌人每 0.25 秒受到 12 点伤害。',
    onDash: (context) => {
      context.trail = true;
    },
  },
  {
    id: 'bounce',
    name: '回声石',
    icon: '◇',
    route: '弹幕',
    description: '灵弹碰墙最多反弹两次。',
    onSpawnBullet: (context) => {
      context.bounce = 2;
    },
  },
  {
    id: 'dash-shot',
    name: '破晓',
    icon: '✦',
    route: '突进',
    description: '翻滚后 2 秒内的下一次大剑或灵弹攻击伤害翻倍，包括蓄力攻击。',
    onDash: (context) => {
      context.empower = true;
    },
  },
  {
    id: 'ricochet',
    name: '折光',
    icon: '⟐',
    route: '弹幕',
    description: '灵弹至少反弹一次；每次反弹伤害增加 50%，最多生效两次。',
    onSpawnBullet: (context) => {
      context.bounce = Math.max(1, context.bounce);
      context.bounceBoost = 1.5;
    },
  },
  {
    id: 'reset-dash',
    name: '追猎',
    icon: '⌁',
    route: '突进',
    description: '击杀 3 格内的敌人立即恢复冲刺，生命恢复 3 点。',
    onKill: (context) => {
      context.resetDash = context.distance <= 3;
    },
  },
];

export function calcPlayerStats(ids: readonly string[]): FireContext {
  const stats = { shots: 1, damage: 18, speed: 18 };
  for (const boon of boons) if (ids.includes(boon.id)) boon.onFire?.(stats);
  return stats;
}

export function boonChoices(ids: readonly string[], roomIndex: number): Boon[] {
  const available = boons.filter((boon) => !ids.includes(boon.id));
  if (!available.length) return [];
  const offset = Math.max(0, roomIndex) % available.length;
  return [...available.slice(offset), ...available.slice(0, offset)].slice(0, 3);
}
