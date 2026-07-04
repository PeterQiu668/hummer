/**
 * 专家门户运营数据（Phase 0 mock，林知远视角）
 * - 介入工单 seed（页面挂载时注入 store，防重复）
 * - SOP 共创资产（草稿 → 沙箱 → 认证 → 上架）
 * - 收入分成 / 声誉评级 mock
 */
import type { ExpertTicket } from '../lib/types';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const hhmm = (d: Date) => d.toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5);

/** 工单 → 协作频道（ExpertTicket 无 channel 字段，处置通报按此路由） */
export const ticketChannels: Record<string, string> = {
  'et-1': 'ch-q3',
  'et-2': 'ch-q3',
  'et-3': 'ch-incident',
  'et-4': 'ch-q3',
};

/** 每次调用基于当前时间生成，保证 SLA 倒计时演示效果稳定 */
export function seedExpertTickets(): ExpertTicket[] {
  const t1 = hoursAgo(1.2);
  const t2 = hoursAgo(2);
  const t3 = hoursAgo(6);
  const t4 = hoursAgo(20);
  return [
    {
      id: 'et-1',
      title: 'BD 邮件误用旧价格表，客户已收到错误报价',
      expertId: 'ex-lin', expertName: '林知远',
      agentName: '雪·销售官', taskId: 'tk-sales-q3',
      severity: 'high', slaHours: 4, status: 'open',
      createdAt: t1.toISOString(),
      timeline: [
        { ts: hhmm(t1), actor: 'HiClaw 治理舱', note: '检测到报价与价格表 v2026Q3 不一致，自动升级为专家介入工单' },
        { ts: hhmm(hoursAgo(1.1)), actor: '系统', note: '按保障协议派单至签约专家 林知远（SLA 4 小时）' },
      ],
    },
    {
      id: 'et-2',
      title: '合同风险条款漏检 2 处（付款周期 / 违约金）',
      expertId: 'ex-lin', expertName: '林知远',
      agentName: '律·法务官', taskId: 'tk-legal-review',
      severity: 'medium', slaHours: 8, status: 'open',
      createdAt: t2.toISOString(),
      timeline: [
        { ts: hhmm(t2), actor: '人审抽检', note: '律师复核发现 2 处高风险条款未标记，判定为 bad case' },
        { ts: hhmm(hoursAgo(1.8)), actor: 'Hermes', note: '归因：合同模板 v4 新增条款未纳入 SOP 检查清单' },
      ],
    },
    {
      id: 'et-3',
      title: '客服官情绪识别连续误判，已触发 3 起客诉升级',
      expertId: 'ex-lin', expertName: '林知远',
      agentName: '苓·客服官', taskId: 'tk-sec-audit',
      severity: 'high', slaHours: 4, status: 'open',
      createdAt: t3.toISOString(),
      timeline: [
        { ts: hhmm(t3), actor: 'HiClaw 治理舱', note: '1 小时内情绪误判率 12% → 31%，超过熔断阈值' },
        { ts: hhmm(hoursAgo(5.5)), actor: '系统', note: '相关会话已切换人工兜底，等待专家介入' },
      ],
    },
    {
      id: 'et-4',
      title: '618 复盘数据口径与财务对不上，需专家复核',
      expertId: 'ex-lin', expertName: '林知远',
      agentName: '岚·运营官', taskId: 'tk-ops-roi',
      severity: 'low', slaHours: 24, status: 'resolved',
      createdAt: t4.toISOString(),
      timeline: [
        { ts: hhmm(t4), actor: '吴帆（销售 VP）', note: '复盘 GMV 与金蝶 ERP 差 3.2%，发起专家介入' },
        { ts: hhmm(hoursAgo(19)), actor: '林知远', note: '专家已接入，开始排查根因' },
        { ts: hhmm(hoursAgo(17)), actor: '林知远', note: '定位：退款口径未剔除跨月冲正单，非模型问题' },
        { ts: hhmm(hoursAgo(16.5)), actor: '林知远', note: '处置结论：修订 BI 取数 SOP v2.4，回归验证通过，工单关闭' },
      ],
    },
  ];
}

/* ============ 共创工作台：SOP 资产 ============ */

export type SopStatus = 'draft' | 'sandbox' | 'review' | 'listed';

export interface SopAsset {
  id: string;
  name: string;
  version: string;
  status: SopStatus;
  desc: string;
  updatedAt: string;
  hires: number;          // 上架态：被雇佣数
  steps: string[];
}

export const SOP_STATUS_LABEL: Record<SopStatus, string> = {
  draft: '草稿', sandbox: '沙箱', review: '认证中', listed: '已上架',
};

export const sopAssets: SopAsset[] = [
  {
    id: 'sop-1', name: '组织健康度诊断 SOP', version: 'v2.3', status: 'listed',
    desc: '面向 50-500 人企业的组织效能体检，输出诊断报告 + 改进优先级',
    updatedAt: '2026-06-21', hires: 286,
    steps: [
      '拉取组织架构 / 在离职 / 绩效分布三类数据（只读 HR 系统）',
      '按 6 维健康度模型计算部门得分（活力 / 协同 / 梯队 / 负荷 / 流失 / 文化）',
      '对 P10 以下低分维度做归因下钻，引用 KG 中同行业基准',
      '生成诊断报告初稿，标注 3 个改进优先级与预期收益',
      '报告送人审（HRD），确认后归档至知识中枢',
    ],
  },
  {
    id: 'sop-2', name: '季度战略复盘 SOP', version: 'v3.1', status: 'listed',
    desc: 'OKR 达成度 → 差距归因 → 下季度策略输入的标准复盘流程',
    updatedAt: '2026-06-14', hires: 612,
    steps: [
      '汇总本季度 OKR 达成度与关键项目里程碑（BI + 项目系统）',
      '对未达成 KR 做三层归因：目标设定 / 执行资源 / 外部环境',
      '生成复盘纪要草稿，附数据引用与责任人确认清单',
      '组织复盘会议材料包，行动项转任务并指派',
    ],
  },
  {
    id: 'sop-3', name: '校招面试评估 SOP', version: 'v1.4', status: 'review',
    desc: '结构化面评：简历初筛 → 面试记录结构化 → 梯队画像匹配',
    updatedAt: '2026-06-28', hires: 0,
    steps: [
      '简历按岗位模型初筛，输出匹配度与风险点',
      '面试录音转写并结构化为 STAR 记录',
      '按人才梯队画像打分，标注争议项供面试官复核',
      '生成录用建议，全程留痕可追溯',
    ],
  },
  {
    id: 'sop-4', name: '干部梯队盘点 SOP', version: 'v0.9', status: 'sandbox',
    desc: '九宫格盘点 + 继任者地图，适配年度人才盘点场景',
    updatedAt: '2026-07-01', hires: 0,
    steps: [
      '汇集绩效 / 潜力 / 360 评估数据，生成九宫格初稿',
      '识别关键岗位单点风险，输出继任者候选',
      '生成盘点会议材料，敏感数据脱敏处理',
    ],
  },
  {
    id: 'sop-5', name: '新组织架构落地检查清单', version: 'v0.3', status: 'draft',
    desc: '架构调整后 30 天落地跟踪：权责 / 汇报线 / 系统权限逐项核对',
    updatedAt: '2026-07-03', hires: 0,
    steps: [
      '核对新架构下的权责矩阵与审批链变更',
      '检查系统权限（OA / CRM / 财务）与新汇报线一致性',
      '第 7 / 14 / 30 天跟踪关键协作断点并上报',
    ],
  },
];

/* ============ 收入与分成 ============ */

export const SHARE_RATE = 0.15;

export interface RevenueRow {
  agentName: string;
  category: string;
  hires: number;            // 在雇企业数
  subscription: number;     // 单企业月订阅（元）
}

/** 林知远共创的 6 位数字员工（对应 experts.ts agentCount=6） */
export const revenueRows: RevenueRow[] = [
  { agentName: '战略复盘官',     category: '战略决策', hires: 612, subscription: 899 },
  { agentName: '校招招聘官',     category: '人力资源', hires: 624, subscription: 499 },
  { agentName: '社招猎头',       category: '人力资源', hires: 412, subscription: 599 },
  { agentName: '组织发展 OD',    category: '人力资源', hires: 286, subscription: 799 },
  { agentName: '行业研究员',     category: '战略决策', hires: 422, subscription: 399 },
  { agentName: '商业模式画布',   category: '战略决策', hires: 184, subscription: 299 },
];

export const rowRevenue = (r: RevenueRow) => Math.round(r.hires * r.subscription * SHARE_RATE);
export const monthTotal = () => revenueRows.reduce((s, r) => s + rowRevenue(r), 0);

/** 近 6 个月分成收入（元），末位为本月（与明细合计一致） */
export const revenueHistory: { month: string; amount: number }[] = [
  { month: '2 月', amount: 128400 },
  { month: '3 月', amount: 146200 },
  { month: '4 月', amount: 152800 },
  { month: '5 月', amount: 171500 },
  { month: '6 月', amount: 189300 },
  { month: '7 月', amount: monthTotal() },
];

/* ============ 声誉等级 ============ */

export interface ReputationMetric {
  key: 'promote' | 'eliminate' | 'badcase';
  label: string;
  value: number;          // 当前值（%）
  goldThreshold: number;  // 金牌门槛（%）
  higherIsBetter: boolean;
  desc: string;
}

export const reputationMetrics: ReputationMetric[] = [
  { key: 'promote',   label: 'Agent 试岗转正率', value: 82.0, goldThreshold: 85, higherIsBetter: true,
    desc: '我共创的数字员工 7 天试岗后被企业转正的比例' },
  { key: 'eliminate', label: 'Agent 淘汰率',      value: 4.2,  goldThreshold: 5,  higherIsBetter: false,
    desc: '上架后 90 天内因绩效不达标被下架 / 退回的比例' },
  { key: 'badcase',   label: 'bad case 率',       value: 1.6,  goldThreshold: 2,  higherIsBetter: false,
    desc: '任务被判定为 bad case 并触发介入工单的比例' },
];

export interface ReputationTier {
  key: 'gold' | 'silver' | 'bronze';
  label: string;
  shareRate: number;   // 分成比例
  exposure: string;    // 曝光权益
  rule: string;
}

export const reputationTiers: ReputationTier[] = [
  { key: 'gold',   label: '金牌专家', shareRate: 0.18,
    exposure: '市场首页推荐位 + 类目置顶',
    rule: '转正率 ≥ 85% 且 淘汰率 ≤ 5% 且 bad case 率 ≤ 2%，并保持 2 个结算周期' },
  { key: 'silver', label: '银牌专家', shareRate: 0.15,
    exposure: '类目页优先展示',
    rule: '转正率 ≥ 70% 且 淘汰率 ≤ 8% 且 bad case 率 ≤ 4%' },
  { key: 'bronze', label: '铜牌专家', shareRate: 0.12,
    exposure: '常规检索展示',
    rule: '完成入驻认证，指标未达银牌门槛' },
];

/** 按三指标反算当前评级 */
export function currentTier(): ReputationTier {
  const [p, e, b] = reputationMetrics.map((m) => m.value);
  if (p >= 85 && e <= 5 && b <= 2) return reputationTiers[0];
  if (p >= 70 && e <= 8 && b <= 4) return reputationTiers[1];
  return reputationTiers[2];
}
