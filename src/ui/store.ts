import { atom, createStore } from 'jotai/vanilla';
import { calcPlayerStats } from '../content/boons';
import type { Simulation, Phase } from '../engine/simulation';
import type { Weapon } from '../content/weapons';

export const hpAtom = atom(100);
export const poiseAtom = atom(40);
export const staminaAtom = atom(100);
export const weaponAtom = atom<Weapon>('greatsword');
export const combatPromptAtom = atom('');
export const goldAtom = atom(0);
export const enemiesAtom = atom(0);
export const boonsAtom = atom<readonly string[]>([]);
export const roomAtom = atom('苔光回廊');
export const floorAtom = atom(0);
export const waveAtom = atom('');
export const hintAtom = atom('');
export const bossHpAtom = atom(0);
export const phaseAtom = atom<Phase>('playing');
export const pausedAtom = atom(true);
export const startedAtom = atom(false);
export const mutedAtom = atom(false);
export const computedStatsAtom = atom((get) => calcPlayerStats(get(boonsAtom)));

export function createUiBridge() {
  const store = createStore();
  return {
    store,
    publish(simulation: Simulation) {
      if (store.get(hpAtom) !== simulation.player.hp[0]) store.set(hpAtom, simulation.player.hp[0]);
      if (store.get(poiseAtom) !== simulation.player.poise[0]) store.set(poiseAtom, simulation.player.poise[0]);
      if (store.get(staminaAtom) !== simulation.stamina) store.set(staminaAtom, simulation.stamina);
      if (store.get(weaponAtom) !== simulation.weapon) store.set(weaponAtom, simulation.weapon);
      let prompt = '';
      if (simulation.riposteTicks) prompt = '致命处决 · 全程无敌';
      else if (simulation.getRiposteTarget() >= 0) prompt = '✦ 左键处决 · 松开连射后重新点击';
      else if (simulation.staggerTicks) prompt = '韧性耗尽 · 短暂硬直';
      else if (
        simulation.enemies.active
          .subarray(0, simulation.enemies.count)
          .some((slot) => simulation.enemies.state[slot] === 4)
      )
        prompt = '✦ 敌人失衡 · 靠近金色弱点，点击左键处决';
      if (store.get(combatPromptAtom) !== prompt) store.set(combatPromptAtom, prompt);
      if (store.get(goldAtom) !== simulation.gold) store.set(goldAtom, simulation.gold);
      if (store.get(enemiesAtom) !== simulation.enemies.count) store.set(enemiesAtom, simulation.enemies.count);
      if (store.get(roomAtom) !== simulation.room.name) store.set(roomAtom, simulation.room.name);
      if (store.get(floorAtom) !== simulation.roomX) store.set(floorAtom, simulation.roomX);
      const wave = simulation.waveDelay ? '下一波即将出现' : `第 ${simulation.wave + 1} / ${simulation.room.waves} 波`;
      if (store.get(waveAtom) !== wave) store.set(waveAtom, wave);
      if (store.get(hintAtom) !== simulation.room.hint) store.set(hintAtom, simulation.room.hint);
      let bossHp = 0;
      for (let index = 0; index < simulation.enemies.count; index++) {
        const slot = simulation.enemies.active[index];
        if (simulation.enemies.kind[slot] === 3) bossHp = simulation.enemies.hp[slot];
      }
      if (store.get(bossHpAtom) !== bossHp) store.set(bossHpAtom, bossHp);
      if (store.get(phaseAtom) !== simulation.phase) store.set(phaseAtom, simulation.phase);
      const current = store.get(boonsAtom);
      if (
        current.length !== simulation.boonIds.length ||
        current.some((id, index) => id !== simulation.boonIds[index])
      ) {
        store.set(boonsAtom, [...simulation.boonIds]);
      }
    },
  };
}

export type UiBridge = ReturnType<typeof createUiBridge>;
