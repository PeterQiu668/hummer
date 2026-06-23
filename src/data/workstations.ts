/**
 * 25 个工位坐标 · 百分比定位（基于 1024×558 背景图）
 * 坐标按 codex 版的 zone center 标定 + 围绕各区中心做小簇分布
 * 15 个绑定命名 Agent（默认显示），10 个空位（默认隐藏）
 */
import type { ZoneId } from '../lib/types';

export interface Workstation {
  id: string;
  x: number; // % of image width
  y: number; // % of image height
  zone: ZoneId | 'transit';
  employeeId?: string;
  variant?: 'desk' | 'monitor' | 'standing' | 'lounge' | 'table' | 'pod';
}

export const workstations: Workstation[] = [
  // ── EXECUTIVE SUITE / B3 · 右上抬高平台（zone center 81,19） ───────────
  { id: 'ws-exec-1', x: 80, y: 18, zone: 'boss', employeeId: 'emp-ceo', variant: 'desk' },
  { id: 'ws-exec-2', x: 86, y: 20, zone: 'boss', variant: 'desk' }, // 空

  // ── TRAINING / EVOLUTION · 左上训练区（zone center 17,21） ─────────────
  { id: 'ws-train-1', x: 16, y: 22, zone: 'business', employeeId: 'emp-data', variant: 'pod' }, // 璇 训练

  // ── SUPPORT CENTER · 中左支持中心（zone center 18,42） ─────────────────
  { id: 'ws-sup-1',  x: 13, y: 39, zone: 'support', employeeId: 'emp-hr',    variant: 'desk' },
  { id: 'ws-sup-2',  x: 20, y: 38, zone: 'support', employeeId: 'emp-legal', variant: 'desk' },
  { id: 'ws-sup-3',  x: 14, y: 46, zone: 'support', employeeId: 'emp-cs',    variant: 'desk' },
  { id: 'ws-sup-4',  x: 21, y: 47, zone: 'support', variant: 'desk' }, // 空

  // ── OPEN OFFICE / BUSINESS · 中央主区（zone center 47,45） ────────────
  { id: 'ws-biz-1',  x: 36, y: 41, zone: 'business', employeeId: 'emp-sales-1', variant: 'desk' },
  { id: 'ws-biz-2',  x: 44, y: 40, zone: 'business', employeeId: 'emp-ops',     variant: 'desk' },
  { id: 'ws-biz-3',  x: 52, y: 40, zone: 'business', employeeId: 'emp-finance', variant: 'desk' },
  { id: 'ws-biz-4',  x: 60, y: 42, zone: 'business', employeeId: 'emp-design',  variant: 'desk' },
  { id: 'ws-biz-5',  x: 36, y: 49, zone: 'business', employeeId: 'emp-sec',     variant: 'desk' },
  { id: 'ws-biz-6',  x: 44, y: 49, zone: 'business', variant: 'desk' }, // 空
  { id: 'ws-biz-7',  x: 52, y: 49, zone: 'business', variant: 'desk' }, // 空
  { id: 'ws-biz-8',  x: 60, y: 50, zone: 'business', variant: 'desk' }, // 空

  // ── PRODUCT / RESEARCH · 中左下研发区（zone center 34,67） ────────────
  { id: 'ws-prod-1', x: 28, y: 63, zone: 'business', employeeId: 'emp-dev', variant: 'desk' },
  { id: 'ws-prod-2', x: 35, y: 64, zone: 'business', employeeId: 'emp-doc', variant: 'desk' },
  { id: 'ws-prod-3', x: 42, y: 67, zone: 'business', variant: 'desk' }, // 空
  { id: 'ws-prod-4', x: 30, y: 70, zone: 'business', variant: 'desk' }, // 空

  // ── CONFERENCE HUB · 中右下圆桌（zone center 69,61） ──────────────────
  { id: 'ws-meet-1', x: 67, y: 60, zone: 'meeting', employeeId: 'emp-meeting-1', variant: 'table' },
  { id: 'ws-meet-2', x: 71, y: 63, zone: 'meeting', employeeId: 'emp-pm', variant: 'table' }, // 衍 开会

  // ── LOUNGE · 右下休息（zone center 88,54） ────────────────────────────
  { id: 'ws-lounge-1', x: 86, y: 53, zone: 'rest', employeeId: 'emp-rest-1', variant: 'lounge' },
  { id: 'ws-lounge-2', x: 91, y: 60, zone: 'rest', variant: 'lounge' }, // 空

  // ── 中央楼梯/过渡 · 1 空位 ────────────────────────────────────────────
  { id: 'ws-transit', x: 55, y: 73, zone: 'transit', variant: 'standing' }, // 空
];

export const getWorkstationByEmployee = (employeeId: string) =>
  workstations.find((w) => w.employeeId === employeeId);
