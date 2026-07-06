/**
 * 3D 场景坐标共享模块
 * 2D 工位百分比坐标 → 3D 平台坐标的唯一映射（此前在 Workstations / CameraRig3D 各存一份）
 */
import { workstations } from '../../data/workstations';
import { ZONE_SPECS } from './ZonePlatform';

export const ZONE_2D_CENTERS: Record<string, { x: number; y: number }> = {
  boss:     { x: 81, y: 19 },
  business: { x: 46, y: 52 }, // B-1（y≈40-50）与 B-2 研发簇（y≈63-70）两簇的中点
  support:  { x: 18, y: 42 },
  meeting:  { x: 69, y: 61 },
  rest:     { x: 88, y: 54 },
  learn:    { x: 17, y: 21 },
  transit:  { x: 55, y: 73 },
};

/** business 区覆盖 B-1/B-2 两簇（2D y 跨度 ±18%），用更小的系数压进 13×10 平台 */
const SPREAD: Record<string, number> = { business: 0.2 };

export function getPos3D(ws: { x: number; y: number; zone: string }): [number, number, number] {
  const c2d = ZONE_2D_CENTERS[ws.zone] ?? { x: 50, y: 50 };
  const spec = ZONE_SPECS.find((s) => s.id === ws.zone);
  if (!spec) return [0, 0.02, 2.6]; // transit 空位 → 主走道旁
  const dx = ws.x - c2d.x;
  const dy = ws.y - c2d.y;
  const k = SPREAD[ws.zone] ?? 0.35;
  const scaleX = (spec.size[0] * k) / 10;
  const scaleZ = (spec.size[1] * k) / 8;
  return [spec.center[0] + dx * scaleX, spec.elevation + 0.02, spec.center[1] + dy * scaleZ];
}

/** 员工 → 其工位的 3D 坐标（无工位返回 null） */
export function getEmployeePos3D(employeeId: string): [number, number, number] | null {
  const ws = workstations.find((w) => w.employeeId === employeeId);
  if (!ws) return null;
  return getPos3D(ws);
}
