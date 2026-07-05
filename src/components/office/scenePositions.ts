/**
 * 3D 场景坐标系统 v3 · SYBERNETIC HQ 1:1 布局
 * 岛式工位 Pod（2 排 × 4 席对坐）+ 特殊席位（高管台/会议舱/休闲区/健身角）
 * 坐标系：主楼板 x∈[-17,17] z∈[-13,7]，镜头在 +z 侧
 */
import { workstations } from '../../data/workstations';

export type SlotVariant = 'desk' | 'exec' | 'table' | 'lounge' | 'gym' | 'standing';

export interface PodDef {
  id: 'A-1' | 'A-2' | 'B-1' | 'B-2';
  center: [number, number]; // x,z
  y: number;
  rotY: number;
  section: 'A' | 'B';
}

/** 4 座办公岛（参考图 A-1/A-2/B-1/B-2） */
export const PODS: PodDef[] = [
  { id: 'A-1', center: [-13.0, -0.5], y: 0,   rotY: 0.2, section: 'A' },
  { id: 'A-2', center: [-6.5, -3.5],  y: 0,   rotY: 0.2, section: 'A' },
  { id: 'B-1', center: [-4.2, -8.8],  y: 0.3, rotY: 0,   section: 'B' },
  { id: 'B-2', center: [1.8, -8.3],   y: 0.3, rotY: 0,   section: 'B' },
];

const SEAT_X = [-1.65, -0.55, 0.55, 1.65];

/** 席位局部坐标：0-3 前排（+z 侧，面向 -z），4-7 后排（-z 侧，面向 +z 即镜头） */
export function seatLocal(seat: number): { dx: number; dz: number; rotY: number } {
  const front = seat < 4;
  return { dx: SEAT_X[seat % 4], dz: front ? 1.35 : -1.35, rotY: front ? Math.PI : 0 };
}

/** 工位 id → Pod 席位 */
export const POD_SEAT_ASSIGN: Record<string, { pod: PodDef['id']; seat: number }> = {
  'ws-biz-1':  { pod: 'A-1', seat: 5 }, // 雪·销售官（面向镜头）
  'ws-biz-2':  { pod: 'A-1', seat: 6 }, // 岚·运营官
  'ws-biz-3':  { pod: 'A-1', seat: 1 }, // 砚·财务官（前排 · blocked）
  'ws-biz-4':  { pod: 'A-1', seat: 4 }, // 染·设计师
  'ws-biz-5':  { pod: 'A-2', seat: 5 }, // 戟·安全官
  'ws-biz-6':  { pod: 'A-2', seat: 1 },
  'ws-biz-7':  { pod: 'A-2', seat: 2 },
  'ws-biz-8':  { pod: 'A-1', seat: 2 },
  'ws-prod-1': { pod: 'A-2', seat: 6 }, // 炅·研发官
  'ws-prod-2': { pod: 'A-2', seat: 4 }, // 芸·文档官
  'ws-prod-3': { pod: 'A-1', seat: 0 },
  'ws-prod-4': { pod: 'A-2', seat: 7 },
  'ws-sup-1':  { pod: 'B-1', seat: 5 }, // 荷·人事官
  'ws-sup-2':  { pod: 'B-1', seat: 6 }, // 律·法务官
  'ws-sup-3':  { pod: 'B-1', seat: 4 }, // 苓·客服官
  'ws-sup-4':  { pod: 'B-1', seat: 1 },
  'ws-exec-2': { pod: 'B-2', seat: 5 },
};

/** 会议舱席位（圆桌 R2.15，绕中心 [3.5,3.5]，避开 +z 门口） */
const CONF_CENTER: [number, number] = [3.5, 3.5];
function confSeat(angleDeg: number): { pos: [number, number, number]; rotY: number } {
  const a = (angleDeg * Math.PI) / 180;
  const x = CONF_CENTER[0] + Math.cos(a) * 2.15;
  const z = CONF_CENTER[1] + Math.sin(a) * 2.15;
  // 面向圆心
  const rotY = Math.atan2(CONF_CENTER[0] - x, CONF_CENTER[1] - z);
  return { pos: [x, 0.45, z], rotY };
}

/** 特殊席位 */
const SPECIALS: Record<string, { pos: [number, number, number]; rotY: number; variant: SlotVariant }> = {
  'ws-exec-1':   { pos: [12, 2.7, -10.15], rotY: 0, variant: 'exec' },       // 决策官 · 高管台
  'ws-meet-1':   { ...confSeat(160), variant: 'table' },                      // 会议主持
  'ws-meet-2':   { ...confSeat(20), variant: 'table' },                       // 产品经理
  'ws-lounge-1': { pos: [10.8, 0.35, 2.2], rotY: Math.PI / 2, variant: 'lounge' },  // 营销官 · 沙发
  'ws-lounge-2': { pos: [12.5, 0.35, 4.6], rotY: Math.PI, variant: 'lounge' },
  'ws-train-1':  { pos: [-14.5, -1.35, 8.0], rotY: 0.26, variant: 'gym' },    // 数据官 · 跑步机充电
  'ws-transit':  { pos: [-3, -1.35, 10.5], rotY: 0, variant: 'standing' },
};

export interface ResolvedSlot {
  pos: [number, number, number];
  rotY: number;
  variant: SlotVariant;
  pod?: PodDef['id'];
  seat?: number;
}

export function resolveSlot(wsId: string): ResolvedSlot | null {
  const special = SPECIALS[wsId];
  if (special) return { ...special };
  const assign = POD_SEAT_ASSIGN[wsId];
  if (!assign) return null;
  const pod = PODS.find((p) => p.id === assign.pod)!;
  const { dx, dz, rotY } = seatLocal(assign.seat);
  const c = Math.cos(pod.rotY);
  const s = Math.sin(pod.rotY);
  return {
    pos: [pod.center[0] + dx * c + dz * s, pod.y, pod.center[1] - dx * s + dz * c],
    rotY: pod.rotY + rotY,
    variant: 'desk',
    pod: pod.id,
    seat: assign.seat,
  };
}

export function getPos3D(ws: { id: string }): [number, number, number] {
  return resolveSlot(ws.id)?.pos ?? [0, 0.02, 6];
}

/** 员工 → 其工位的 3D 坐标（无工位返回 null） */
export function getEmployeePos3D(employeeId: string): [number, number, number] | null {
  const ws = workstations.find((w) => w.employeeId === employeeId);
  if (!ws) return null;
  return resolveSlot(ws.id)?.pos ?? null;
}
