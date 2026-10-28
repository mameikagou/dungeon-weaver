import { atom, createStore } from 'jotai/vanilla';
import { calcPlayerStats } from '../content/boons';
import type { Simulation, Phase } from '../engine/simulation';

export const hpAtom = atom(100);
export const goldAtom = atom(0);
export const enemiesAtom = atom(0);
export const boonsAtom = atom<readonly string[]>([]);
export const roomAtom = atom('苔光回廊');
export const floorAtom = atom(0);
export const phaseAtom = atom<Phase>('playing');
export const pausedAtom = atom(true);
export const startedAtom = atom(false);
export const mutedAtom = atom(false);
export const computedStatsAtom = atom(get => calcPlayerStats(get(boonsAtom)));

export function createUiBridge() {
  const store = createStore();
  return {
    store,
    publish(simulation: Simulation) {
      if (store.get(hpAtom) !== simulation.player.hp[0]) store.set(hpAtom, simulation.player.hp[0]);
      if (store.get(goldAtom) !== simulation.gold) store.set(goldAtom, simulation.gold);
      if (store.get(enemiesAtom) !== simulation.enemies.count) store.set(enemiesAtom, simulation.enemies.count);
      if (store.get(roomAtom) !== simulation.room.name) store.set(roomAtom, simulation.room.name);
      if (store.get(floorAtom) !== simulation.roomX) store.set(floorAtom, simulation.roomX);
      if (store.get(phaseAtom) !== simulation.phase) store.set(phaseAtom, simulation.phase);
      const current = store.get(boonsAtom);
      if (current.length !== simulation.boonIds.length || current.some((id, index) => id !== simulation.boonIds[index])) {
        store.set(boonsAtom, [...simulation.boonIds]);
      }
    },
  };
}

export type UiBridge = ReturnType<typeof createUiBridge>;
