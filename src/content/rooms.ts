import { enemySymbols } from './enemies';

export const ROOM_WIDTH = 20;
export const ROOM_HEIGHT = 15;

export const rooms = [
  {
    id: 'moss-hall', name: '苔光回廊', waves: 2, hint: '冲锋兽蓄力时锁定方向，横向闪避。',
    rows: [
      '####################',
      '#..................#',
      '#.....C......C.....#',
      '#..................#',
      '#...##........##...#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#...##........##...#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#.........P........#',
      '#..................#',
      '####################',
    ],
  },
  {
    id: 'ember-vault', name: '余烬密室', waves: 2, hint: '投弹落点提前出现，离开紫色圆环。',
    rows: [
      '####################',
      '#..................#',
      '#..T......C.....T..#',
      '#..................#',
      '#....##.....##.....#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#....##.....##.....#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#.........P........#',
      '#..................#',
      '####################',
    ],
  },
  {
    id: 'shield-court', name: '守誓庭院', waves: 2, hint: '卫兵正面持盾，绕到侧后方，或等待挥击后的破绽。',
    rows: [
      '####################',
      '#..................#',
      '#....G........G....#',
      '#..................#',
      '#......##..##......#',
      '#..................#',
      '#..C............C..#',
      '#..................#',
      '#......##..##......#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#.........P........#',
      '#..................#',
      '####################',
    ],
  },
  {
    id: 'crossroads', name: '交错之径', waves: 3, hint: '让冲锋兽撞向掩体，先处理远处的投弹怪。',
    rows: [
      '####################',
      '#..................#',
      '#...T.........T....#',
      '#..................#',
      '#..###......###....#',
      '#..................#',
      '#......G....C......#',
      '#..................#',
      '#....###......###..#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#.........P........#',
      '#..................#',
      '####################',
    ],
  },
  {
    id: 'crown-gate', name: '苔冠之门', waves: 3, hint: '用蓄力贯穿聚集的敌人，给自己留下闪避空间。',
    rows: [
      '####################',
      '#..................#',
      '#..G......T.....G..#',
      '#..................#',
      '#.....##....##.....#',
      '#..................#',
      '#..C............C..#',
      '#..................#',
      '#.....##....##.....#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#.........P........#',
      '#..................#',
      '####################',
    ],
  },
  {
    id: 'warden-sanctum', name: '守望者圣所', waves: 1, hint: '冲撞、落弹、扇形灵弹。守望者半血后会加快连招。',
    rows: [
      '####################',
      '#..................#',
      '#..................#',
      '#.........B........#',
      '#..................#',
      '#...##........##...#',
      '#..................#',
      '#..................#',
      '#...##........##...#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#.........P........#',
      '#..................#',
      '####################',
    ],
  },
  {
    id: 'training-room', name: '静谧庭院', waves: 1, hint: '练习普通射击、E 键蓄力和空格闪避。',
    rows: [
      '####################',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#.........P........#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '####################',
    ],
  },
] as const;

export type Room = typeof rooms[number];
export const dungeonRooms = rooms.filter(room => room.id !== 'training-room');

export function canStand(room: Room, x: number, z: number, radius: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  for (let row = Math.floor(z - radius); row <= Math.floor(z + radius); row++) {
    for (let column = Math.floor(x - radius); column <= Math.floor(x + radius); column++) {
      if (!room.rows[row]?.[column] || room.rows[row][column] === '#') return false;
    }
  }
  return true;
}

export function validateRooms(): string[] {
  const errors: string[] = [];
  for (const room of rooms) {
    if (room.rows.length !== ROOM_HEIGHT) errors.push(`${room.id}: 房间高度错误`);
    let spawnCount = 0;
    const walkable: number[] = [];
    let spawn = -1;
    room.rows.forEach((row, rowIndex) => {
      if (row.length !== ROOM_WIDTH) errors.push(`${room.id}: 第 ${rowIndex} 行宽度错误`);
      [...row].forEach((cell, column) => {
        if (!'#.P'.includes(cell) && !enemySymbols[cell]) errors.push(`${room.id}: 未知符号 ${cell}`);
        if (cell !== '#') walkable.push(rowIndex * ROOM_WIDTH + column);
        if (cell === 'P') { spawnCount++; spawn = rowIndex * ROOM_WIDTH + column; }
      });
    });
    if (spawnCount !== 1) errors.push(`${room.id}: 需要一个出生点`);
    const remaining = new Set(walkable);
    const queue = [spawn];
    remaining.delete(spawn);
    for (let index = 0; index < queue.length; index++) {
      for (const neighbor of [queue[index] - 1, queue[index] + 1, queue[index] - ROOM_WIDTH, queue[index] + ROOM_WIDTH]) {
        if (remaining.delete(neighbor)) queue.push(neighbor);
      }
    }
    if (remaining.size) errors.push(`${room.id}: 存在不可达地面`);
  }
  return errors;
}
