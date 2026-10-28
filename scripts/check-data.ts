import { validateRooms, rooms } from '../src/content/rooms';
import { boons } from '../src/content/boons';

const errors = validateRooms();
const seen = new Set<string>();
for (const boon of boons) {
  if (seen.has(boon.id)) errors.push(`重复祝福: ${boon.id}`);
  seen.add(boon.id);
}
console.log(JSON.stringify({ rooms: rooms.length, boons: boons.length, errors }, null, 2));
process.exitCode = errors.length ? 1 : 0;
