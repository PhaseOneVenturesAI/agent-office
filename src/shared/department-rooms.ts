import type { DeptPreset } from './protocol.js';

/** Permanent studios around the existing pods: IDs and seated workers never move. */
export interface DepartmentRoom {
  preset: DeptPreset;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Opening on the wall facing the common east–west corridor. */
  door: { side: 'north' | 'south'; x: number; width: number };
  desks: readonly string[];
}

export const DEPARTMENT_ROOMS: readonly DepartmentRoom[] = [
  { preset: 'marketing', name: 'Marketing studio', minX: -14.8, maxX: -6.7, minZ: -7.2, maxZ: -1.2, door: { side: 'south', x: -10.5, width: 2 }, desks: ['desk-1', 'desk-2', 'desk-3', 'desk-4'] },
  { preset: 'product', name: 'Product & Engineering', minX: -5.3, maxX: 2.8, minZ: -7.2, maxZ: -1.2, door: { side: 'south', x: -1.5, width: 2 }, desks: ['desk-5', 'desk-6', 'desk-7', 'desk-8'] },
  { preset: 'review', name: 'Review room', minX: -14.8, maxX: -6.7, minZ: 1.2, maxZ: 7.2, door: { side: 'north', x: -10.5, width: 2 }, desks: ['desk-9', 'desk-10', 'desk-11', 'desk-12'] },
];

export const ROOM_HEIGHT = 2.7;
export const ROOM_WALL = 0.1;
export function roomDeskIds(preset: DeptPreset): readonly string[] {
  return DEPARTMENT_ROOMS.find((room) => room.preset === preset)?.desks ?? [];
}

/** Shared by the physical walls and navigation: door openings stay genuinely walkable. */
export function departmentRoomWalls(room: DepartmentRoom): [number, number, number, number][] {
  const { minX, maxX, minZ, maxZ, door } = room;
  const h = ROOM_WALL / 2;
  const front = door.side === 'north' ? minZ : maxZ;
  const back = door.side === 'north' ? maxZ : minZ;
  return [
    [minX - h, minX + h, minZ, maxZ],
    [maxX - h, maxX + h, minZ, maxZ],
    [minX, maxX, back - h, back + h],
    [minX, door.x - door.width / 2, front - h, front + h],
    [door.x + door.width / 2, maxX, front - h, front + h],
  ];
}
