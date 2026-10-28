export const enemyTypes = [
  { id: 'charger', name: '冲锋兽', hp: 100, poise: 15, speed: 1.5, radius: 0.36, damage: 14, color: '#f2ad71' },
  { id: 'bomber', name: '投弹怪', hp: 90, poise: 15, speed: 1.1, radius: 0.34, damage: 12, color: '#d9a1f5' },
  { id: 'guard', name: '持盾卫兵', hp: 160, poise: 30, speed: 1.2, radius: 0.42, damage: 18, color: '#a8bcee' },
  { id: 'warden', name: '苔冠守望者', hp: 2200, poise: 120, speed: 1.2, radius: 0.7, damage: 20, color: '#ffca89' },
] as const;

export const enemySymbols: Readonly<Record<string, string>> = { C: 'charger', T: 'bomber', G: 'guard', B: 'warden' };
export const enemyStates = ['approach', 'windup', 'attack', 'recover', 'stance-broken', 'riposte'] as const;
