/**
 * ROI 经营月报 + 账单中心 mock 数据（Phase 0）
 * 口径与 data/employees.ts 的 tokensToday / costToday 保持一致：
 * 月度账单 = costToday(USD) × USD_TO_CNY × WORKDAYS，员工名单直接取自 employees。
 */
import { employees } from './employees';

export const USD_TO_CNY = 7.2;
export const WORKDAYS = 22;

// ── 经营 ROI 月报 ────────────────────────────────────────────────

export interface RoiSummary {
  monthLabel: string;
  tasksDone: number;          // 本月完成任务数
  deliverablesAccepted: number; // 验收通过交付物数
  savedHours: number;         // 等效人时节省
  savedValue: number;         // 等效人力成本（¥）
  expertInterventions: number; // 专家介入次数
}

export const roiSummary: RoiSummary = {
  monthLabel: '7 月',
  tasksDone: 1284,
  deliverablesAccepted: 342,
  savedHours: 412,
  savedValue: 86_000,
  expertInterventions: 9,
};

export interface DeptRoiSeed {
  dept: string;
  tasksDone: number;
  savedHours: number;
  humanCost: number; // 同岗位人力等效成本（¥/月）
}

const deptRoiSeeds: DeptRoiSeed[] = [
  { dept: '决策中心',     tasksDone: 96,  savedHours: 58,  humanCost: 16_000 },
  { dept: '业务办公区',   tasksDone: 684, savedHours: 186, humanCost: 40_000 },
  { dept: '行政支持中心', tasksDone: 402, savedHours: 121, humanCost: 19_000 },
  { dept: '会议室',       tasksDone: 62,  savedHours: 27,  humanCost: 6_000 },
  { dept: '休息区',       tasksDone: 40,  savedHours: 20,  humanCost: 5_000 },
];

export interface TrendMonth {
  month: string;
  tasks: number;
  savedHours: number;
}

export const monthlyTrend: TrendMonth[] = [
  { month: '2月', tasks: 310,  savedHours: 96 },
  { month: '3月', tasks: 520,  savedHours: 168 },
  { month: '4月', tasks: 700,  savedHours: 224 },
  { month: '5月', tasks: 890,  savedHours: 287 },
  { month: '6月', tasks: 1120, savedHours: 358 },
  { month: '7月', tasks: 1284, savedHours: 412 },
];

// ── 账单中心：部门 → 员工 → 任务 三级归因 ────────────────────────

export type BudgetStatus = 'ok' | 'near' | 'exceeded';

export interface BillingTask {
  id: string;
  title: string;
  tokens: number;
  cost: number;              // ¥，failed 任务此值为免计费金额
  status: 'ok' | 'failed';
}

export interface BillingEmployee {
  id: string;
  name: string;
  role: string;
  dept: string;
  model: string;
  tokensToday: number;
  costTodayUsd: number;
  monthCost: number;         // ¥
  budgetCap: number;         // ¥ 预算硬顶
  budgetStatus: BudgetStatus;
  fused: boolean;            // 超限熔断 → 已转人工
  tasks: BillingTask[];
}

export interface BillingDept {
  dept: string;
  monthCost: number;
  employees: BillingEmployee[];
}

// 预算硬顶（¥/月），按员工手工设定以演示三种状态
const budgetCaps: Record<string, number> = {
  'emp-ceo': 3000, 'emp-sales-1': 800, 'emp-ops': 600, 'emp-finance': 850,
  'emp-hr': 300, 'emp-legal': 800, 'emp-cs': 600, 'emp-dev': 1200,
  'emp-data': 500, 'emp-doc': 200, 'emp-meeting-1': 1000, 'emp-design': 700,
  'emp-pm': 1600, 'emp-sec': 1200, 'emp-rest-1': 600,
};

// 任务归因：ok 任务按份额分摊月成本；failed 任务不计费（waived = 免计费金额 ¥）
const taskSeeds: Record<string, { ok: { title: string; share: number }[]; failed?: { title: string; waived: number }[] }> = {
  'emp-ceo':       { ok: [{ title: 'Q3 OKR 拆解与跟踪', share: 0.5 }, { title: '审批路由与风险熔断', share: 0.3 }, { title: '战略 A2A 协调下发', share: 0.2 }] },
  'emp-sales-1':   { ok: [{ title: '鲲鹏制造 BD 跟进', share: 0.45 }, { title: 'Top-A 客户邮件批处理', share: 0.35 }, { title: '报价单生成', share: 0.2 }] },
  'emp-ops':       { ok: [{ title: '618 复盘报告 v4.1', share: 0.5 }, { title: '广告投放监控与调优', share: 0.5 }], failed: [{ title: '跨渠道归因重跑（BI 数据缺失）', waived: 52 }] },
  'emp-finance':   { ok: [{ title: '供应商对账批处理 23 条', share: 0.6 }, { title: '发票核验', share: 0.4 }], failed: [{ title: '138w 调拨复核（Guardian 阻断）', waived: 86 }] },
  'emp-hr':        { ok: [{ title: '简历筛选 12 份', share: 0.7 }, { title: '面试评估卡生成', share: 0.3 }] },
  'emp-legal':     { ok: [{ title: '主合同 v4 风险审阅', share: 0.55 }, { title: '法规检索与条款 diff', share: 0.45 }] },
  'emp-cs':        { ok: [{ title: '工单自动响应 28 条/时', share: 0.65 }, { title: '升级路由与人工标注', share: 0.35 }], failed: [{ title: '中英混合情绪分类批次（准确率不达标）', waived: 37 }] },
  'emp-dev':       { ok: [{ title: 'fix/order-p1 修复', share: 0.5 }, { title: '单测与 diff 生成', share: 0.3 }, { title: 'API 文档对齐 v2.1', share: 0.2 }] },
  'emp-data':      { ok: [{ title: '自动化报表 v5 训练', share: 0.6 }, { title: 'SQL 优化', share: 0.4 }] },
  'emp-doc':       { ok: [{ title: '周会纪要生成与发布', share: 1 }] },
  'emp-meeting-1': { ok: [{ title: 'Q3 增长策略会主持', share: 0.6 }, { title: '实时纪要与行动项提取', share: 0.4 }] },
  'emp-design':    { ok: [{ title: 'Q3 大客户主视觉 6 张', share: 0.7 }, { title: '品牌资产整理', share: 0.3 }] },
  'emp-pm':        { ok: [{ title: 'PRD v0.3 撰写', share: 0.5 }, { title: '需求评审会组织', share: 0.3 }, { title: '业务方反馈归集 9 条', share: 0.2 }] },
  'emp-sec':       { ok: [{ title: '全员 Skill 签名巡检', share: 0.5 }, { title: 'MCP Server 扫描 23 个', share: 0.5 }] },
  'emp-rest-1':    { ok: [{ title: '推文 3 篇 + 海报 1 套', share: 1 }] },
};

const NEAR_THRESHOLD = 0.8;

function buildBilling(): { depts: BillingDept[]; total: number; waived: number } {
  const deptOrder: string[] = [];
  const byDept = new Map<string, BillingEmployee[]>();
  let total = 0;
  let waived = 0;

  for (const emp of employees) {
    const monthCost = Math.round(emp.costToday * USD_TO_CNY * WORKDAYS);
    const cap = budgetCaps[emp.id] ?? Math.round(monthCost * 1.5);
    const ratio = monthCost / cap;
    const status: BudgetStatus = ratio > 1 ? 'exceeded' : ratio >= NEAR_THRESHOLD ? 'near' : 'ok';
    const seed = taskSeeds[emp.id] ?? { ok: [{ title: '日常任务批处理', share: 1 }] };

    const okTasks: BillingTask[] = seed.ok.map((t, i) => ({
      id: `${emp.id}-t${i}`,
      title: t.title,
      tokens: Math.round(emp.tokensToday * WORKDAYS * t.share),
      cost: Math.round(monthCost * t.share),
      status: 'ok' as const,
    }));
    const failedTasks: BillingTask[] = (seed.failed ?? []).map((t, i) => ({
      id: `${emp.id}-f${i}`,
      title: t.title,
      tokens: Math.round(t.waived / USD_TO_CNY * 26_000),
      cost: t.waived,
      status: 'failed' as const,
    }));
    waived += failedTasks.reduce((s, t) => s + t.cost, 0);
    total += monthCost;

    const row: BillingEmployee = {
      id: emp.id, name: emp.name, role: emp.role, dept: emp.department, model: emp.model,
      tokensToday: emp.tokensToday, costTodayUsd: emp.costToday,
      monthCost, budgetCap: cap, budgetStatus: status, fused: status === 'exceeded',
      tasks: [...okTasks, ...failedTasks],
    };
    if (!byDept.has(emp.department)) {
      byDept.set(emp.department, []);
      deptOrder.push(emp.department);
    }
    byDept.get(emp.department)!.push(row);
  }

  const depts: BillingDept[] = deptOrder.map((dept) => {
    const emps = byDept.get(dept)!;
    return { dept, monthCost: emps.reduce((s, e) => s + e.monthCost, 0), employees: emps };
  });
  return { depts, total, waived };
}

const billing = buildBilling();
export const billingDepts: BillingDept[] = billing.depts;
export const billingTotal: number = billing.total;
export const waivedTotal: number = billing.waived;

// ── 部门 ROI 卡片（成本取自账单归因，保证口径一致） ──────────────

export interface DeptRoi extends DeptRoiSeed {
  aiCost: number;
  roiX: number; // 人力成本 / AI 成本
}

export const deptRoiCards: DeptRoi[] = deptRoiSeeds.map((seed) => {
  const aiCost = billingDepts.find((d) => d.dept === seed.dept)?.monthCost ?? 1;
  return { ...seed, aiCost, roiX: Math.round((seed.humanCost / aiCost) * 10) / 10 };
});

// ── 对比同岗位人力成本 ──────────────────────────────────────────

export interface HumanCompareRow {
  position: string;       // 同岗位
  agentName: string;      // 对应 AI 员工
  agentCost: number;      // AI 月成本（¥，取自账单）
  humanCost: number;      // 人力月成本（¥）
}

const findMonthCost = (id: string): number =>
  billingDepts.flatMap((d) => d.employees).find((e) => e.id === id)?.monthCost ?? 0;

export const humanCompare: HumanCompareRow[] = [
  { position: '销售 BD 专员',      agentName: '雪·销售官', agentCost: findMonthCost('emp-sales-1'), humanCost: 15_000 },
  { position: '运营分析师',        agentName: '岚·运营官', agentCost: findMonthCost('emp-ops'),     humanCost: 14_000 },
  { position: '法务合规审阅',      agentName: '律·法务官', agentCost: findMonthCost('emp-legal'),   humanCost: 25_000 },
  { position: '客服坐席 ×3',       agentName: '苓·客服官', agentCost: findMonthCost('emp-cs'),      humanCost: 18_000 },
  { position: '中级研发工程师',    agentName: '炅·研发官', agentCost: findMonthCost('emp-dev'),     humanCost: 30_000 },
  { position: '文档 / 行政助理',   agentName: '芸·文档官', agentCost: findMonthCost('emp-doc'),     humanCost: 8_000 },
];

export const fmtYuan = (n: number): string =>
  n >= 10_000 ? `¥${(n / 10_000).toFixed(1)} 万` : `¥${n.toLocaleString('zh-CN')}`;

export const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${n}`;
