export const ROOM_WIDTH = 20;
export const ROOM_HEIGHT = 15;

export const rooms = [
  {
    id: 'moss-hall', name: '苔光回廊',
    rows: [
      '####################',
      '#..................#',
      '#.....E......E.....#',
      '#..................#',
      '#...##........##...#',
      '#..................#',
      '#.........E........#',
      '#..................#',
      '#...##........##...#',
      '#..................#',
      '#.....E......E.....#',
      '#..................#',
      '#.........P........#',
      '#..................#',
      '####################',
    ],
  },
  {
    id: 'ember-vault', name: '余烬密室',
    rows: [
      '####################',
      '#..................#',
      '#..E......E.....E..#',
      '#..................#',
      '#....##.....##.....#',
      '#..................#',
      '#..E............E..#',
      '#..................#',
      '#....##.....##.....#',
      '#..................#',
      '#..E......E.....E..#',
      '#..................#',
      '#.........P........#',
      '#..................#',
      '####################',
    ],
  },
  {
    id: 'training-room', name: '静谧庭院',
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
        if (!'#.PE'.includes(cell)) errors.push(`${room.id}: 未知符号 ${cell}`);
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
