/**
 * 3D 场景坐标共享模块
 * 2D 工位百分比坐标 → 3D 平台坐标的唯一映射（此前在 Workstations / CameraRig3D 各存一份）
 */
import { workstations } from '../../data/workstations';
import { ZONE_SPECS } from './ZonePlatform';

export const ZONE_2D_CENTERS: Record<string, { x: number; y: number }> = {
  boss:     { x: 81, y: 19 },
  business: { x: 47, y: 45 },
  support:  { x: 18, y: 42 },
  meeting:  { x: 69, y: 61 },
  rest:     { x: 88, y: 54 },
  learn:    { x: 17, y: 21 },
  transit:  { x: 55, y: 73 },
};

export function getPos3D(ws: { x: number; y: number; zone: string }): [number, number, number] {
  const c2d = ZONE_2D_CENTERS[ws.zone] ?? { x: 50, y: 50 };
  const spec = ZONE_SPECS.find((s) => s.id === ws.zone);
  if (!spec) return [0, 0.4, 6];
  const dx = ws.x - c2d.x;
  const dy = ws.y - c2d.y;
  const scaleX = (spec.size[0] * 0.35) / 10;
  const scaleZ = (spec.size[1] * 0.35) / 8;
  return [spec.center[0] + dx * scaleX, spec.elevation + 0.02, spec.center[1] + dy * scaleZ];
}

/** 员工 → 其工位的 3D 坐标（无工位返回 null） */
export function getEmployeePos3D(employeeId: string): [number, number, number] | null {
  const ws = workstations.find((w) => w.employeeId === employeeId);
  if (!ws) return null;
  return getPos3D(ws);
}
