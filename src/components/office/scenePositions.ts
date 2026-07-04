/**
 * 3D 场景坐标系统 v2 · 显式工位槽位表
 * 此前用 2D 百分比坐标投影 → 工位散乱重叠。现在每个工位在分区局部坐标系
 * 里有确定的槽位（dx/dz 相对分区中心 + 朝向），布局是建筑化的网格阵列。
 */
import { workstations } from '../../data/workstations';
import { ZONE_SPECS } from './ZonePlatform';

export type SlotVariant = 'desk' | 'exec' | 'table' | 'lounge' | 'pod' | 'standing';

export interface WsSlot {
  zone: string;      // 所属平台（可与数据里的 zone 不同，如训练位归充电区）
  dx: number;        // 相对分区中心 x
  dz: number;        // 相对分区中心 z
  rotY: number;      // 朝向（0 = 面向 +z 即镜头）
  variant: SlotVariant;
}

/** 每个工位 id → 槽位。业务区 3×4 网格；支持区 2×2；会议圆桌；老板独桌；休息沙发；充电舱 */
export const WS_SLOTS: Record<string, WsSlot> = {
  // ── 决策中心（抬高平台 · 独桌居中）──
  'ws-exec-1': { zone: 'boss', dx: 0,    dz: -0.4, rotY: 0, variant: 'exec' },
  'ws-exec-2': { zone: 'boss', dx: 2.3,  dz: 1.0,  rotY: 0, variant: 'desk' },

  // ── 业务办公区 · 3 行 × 4 列，全部面向镜头 ──
  'ws-biz-1':  { zone: 'business', dx: -3.9, dz: -2.0, rotY: 0, variant: 'desk' },
  'ws-biz-2':  { zone: 'business', dx: -1.3, dz: -2.0, rotY: 0, variant: 'desk' },
  'ws-biz-3':  { zone: 'business', dx: 1.3,  dz: -2.0, rotY: 0, variant: 'desk' },
  'ws-biz-4':  { zone: 'business', dx: 3.9,  dz: -2.0, rotY: 0, variant: 'desk' },
  'ws-biz-5':  { zone: 'business', dx: -3.9, dz: -0.1, rotY: 0, variant: 'desk' },
  'ws-biz-6':  { zone: 'business', dx: -1.3, dz: -0.1, rotY: 0, variant: 'desk' },
  'ws-biz-7':  { zone: 'business', dx: 1.3,  dz: -0.1, rotY: 0, variant: 'desk' },
  'ws-biz-8':  { zone: 'business', dx: 3.9,  dz: -0.1, rotY: 0, variant: 'desk' },
  'ws-prod-1': { zone: 'business', dx: -3.9, dz: 1.8,  rotY: 0, variant: 'desk' },
  'ws-prod-2': { zone: 'business', dx: -1.3, dz: 1.8,  rotY: 0, variant: 'desk' },
  'ws-prod-3': { zone: 'business', dx: 1.3,  dz: 1.8,  rotY: 0, variant: 'desk' },
  'ws-prod-4': { zone: 'business', dx: 3.9,  dz: 1.8,  rotY: 0, variant: 'desk' },

  // ── 行政支持 · 2×2 ──
  'ws-sup-1': { zone: 'support', dx: -1.2, dz: -1.2, rotY: 0, variant: 'desk' },
  'ws-sup-2': { zone: 'support', dx: 1.2,  dz: -1.2, rotY: 0, variant: 'desk' },
  'ws-sup-3': { zone: 'support', dx: -1.2, dz: 0.9,  rotY: 0, variant: 'desk' },
  'ws-sup-4': { zone: 'support', dx: 1.2,  dz: 0.9,  rotY: 0, variant: 'desk' },

  // ── 会议室 · 圆桌对坐（桌子本体由 Workstations 在分区中心渲染一次）──
  'ws-meet-1': { zone: 'meeting', dx: -1.7, dz: 0.1, rotY: -Math.PI / 2, variant: 'table' },
  'ws-meet-2': { zone: 'meeting', dx: 1.7,  dz: 0.1, rotY: Math.PI / 2,  variant: 'table' },

  // ── 休息区 · 沙发 ──
  'ws-lounge-1': { zone: 'rest', dx: -0.9, dz: 0.3, rotY: 0.35,  variant: 'lounge' },
  'ws-lounge-2': { zone: 'rest', dx: 1.1,  dz: 0.6, rotY: -0.35, variant: 'lounge' },

  // ── 充电进化区 · 训练舱（璇 归位到这里）──
  'ws-train-1': { zone: 'learn', dx: 0, dz: 0.1, rotY: 0, variant: 'pod' },

  // ── 中央过渡 · 站立位 ──
  'ws-transit': { zone: 'hex', dx: 0, dz: 3.4, rotY: 0, variant: 'standing' },
};

export interface ResolvedSlot {
  pos: [number, number, number];
  rotY: number;
  variant: SlotVariant;
}

export function resolveSlot(wsId: string): ResolvedSlot | null {
  const slot = WS_SLOTS[wsId];
  if (!slot) return null;
  if (slot.zone === 'hex') {
    return { pos: [slot.dx, 0.02, slot.dz], rotY: slot.rotY, variant: slot.variant };
  }
  const spec = ZONE_SPECS.find((s) => s.id === slot.zone);
  if (!spec) return null;
  return {
    pos: [spec.center[0] + slot.dx, spec.elevation + 0.02, spec.center[1] + slot.dz],
    rotY: slot.rotY,
    variant: slot.variant,
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
