/**
 * 抖音 3 视频核心机制注入到代码层 (v5.5)
 *
 *  视频① 拒绝慢养·练虾系统(上) — 41:28
 *    Agent 配置/上下文/SOP+Skill/分工打包 4 要素；
 *    练虾池：批量入池→高强度训练→淘汰差的→留下强的；
 *    黑客帝国式技能插盘上岗。
 *
 *  视频② AI 飞书·一人团队 — 50:17 ⭐
 *    IM 化团队 OS：左成员频道·中任务流·右弹窗调度；
 *    老板巡场=员工状态透明；任务卡=合同；高危即时阻断弹窗。
 *
 *  视频③ 练虾系统(下) — 19:18
 *    从实验到量产：专家共创→平台量产→沙箱试岗→评分→授权→入工区。
 */
import type {
  SopVersion, InboxItem, EliminatedAgent, LifecycleCandidate,
} from '../lib/types';

// ── 视频① SOP 版本演进（每个命名 Agent 的多轮训练记录） ──────────────
export const sopVersions: SopVersion[] = [
  {
    agentId: 'emp-ceo', current: 'v6.1', trainedRounds: 19, lastBumpAt: '今日 09:12',
    history: [
      { round: 19, version: 'v6.1', accuracy: 96.4, cost: '$8.41', note: 'OKR 拆解新增季度风险节点' },
      { round: 18, version: 'v6.0', accuracy: 94.1, cost: '$7.02', note: '决策树多分支评估' },
      { round: 14, version: 'v5.2', accuracy: 91.8, cost: '$6.10', note: '风险熔断规则收紧' },
    ],
  },
  {
    agentId: 'emp-sales-1', current: 'v3.2', trainedRounds: 14, lastBumpAt: '今日 13:50',
    history: [
      { round: 14, version: 'v3.2', accuracy: 92.6, cost: '$3.18', note: '问候语引入互动史前 3 件事' },
      { round: 12, version: 'v3.0', accuracy: 78.4, cost: '$2.90', note: '模板化首版' },
      { round: 8,  version: 'v2.1', accuracy: 64.2, cost: '$2.20', note: '首轮人工迭代' },
    ],
  },
  {
    agentId: 'emp-finance', current: 'v4.0', trainedRounds: 22, lastBumpAt: '今日 14:36',
    history: [
      { round: 22, version: 'v4.0', accuracy: 100.0, cost: '$2.41', note: '> 50w 强制审批单 (沙箱评测中)' },
      { round: 18, version: 'v3.0', accuracy: 0,     cost: '$0.00', note: '138w 阈值判断错误' },
      { round: 14, version: 'v2.5', accuracy: 88.0,  cost: '$3.10', note: '常规调拨准确率' },
    ],
  },
  {
    agentId: 'emp-legal', current: 'v2.7', trainedRounds: 17, lastBumpAt: '昨日 18:00',
    history: [
      { round: 17, version: 'v2.7', accuracy: 94.0, cost: '$5.62', note: 'KG 加入「合同-法规-行业」边' },
      { round: 14, version: 'v2.4', accuracy: 81.0, cost: '$4.80', note: '6 类风险点首版' },
    ],
  },
  {
    agentId: 'emp-data', current: 'v5.1', trainedRounds: 11, lastBumpAt: '今日 14:00',
    history: [
      { round: 11, version: 'v5.1', accuracy: 96.1, cost: '$2.18', note: 'GEPA 自动补样本 220 条' },
      { round: 9,  version: 'v5.0', accuracy: 92.4, cost: '$1.90', note: '自动化报表 SOP 升级' },
    ],
  },
];

// ── 视频② 老板今日待办收件箱（5 大类） ────────────────────────────
export const inboxItems: InboxItem[] = [
  {
    id: 'in-1', kind: 'block', urgent: true,
    title: '财务 138w 调拨已阻断', agent: '砚·财务官', channel: 'ch-q3', ts: '14:33',
    detail: 'Exec-Guardian 拦截，命中四眼原则。SOP v3 已下线，v4 在沙箱评测中。',
  },
  {
    id: 'in-2', kind: 'approval', urgent: true,
    title: '合同外发待签字', agent: '律·法务官', channel: 'ch-q3', ts: '14:38',
    detail: '鲲鹏制造主合同 v4 含 3 条高危条款，等待您签字。',
  },
  {
    id: 'in-3', kind: 'stuck', urgent: false,
    title: '运营复盘数据缺失', agent: '岚·运营官', channel: 'ch-618', ts: '14:21',
    detail: 'BI 仓库归因数据本周未更新，岚等待数据工程修复。',
  },
  {
    id: 'in-4', kind: 'accept', urgent: false,
    title: '产品 PRD v0.3 待验收', agent: '衍·产品经理', channel: 'ch-q3', ts: '14:41',
    detail: 'PRD 草案已成形，等待您过目后进入研发评审。',
  },
  {
    id: 'in-5', kind: 'anomaly', urgent: true,
    title: '客服情绪分类异常', agent: '苓·客服官', channel: 'ch-hermes', ts: '13:50',
    detail: '中英混合场景下分类准确率从 91% 跌至 76%，已进 Hermes 队列。',
  },
];

// ── 视频① 淘汰流 - 拒绝慢养 ──────────────────────────────────────
export const eliminatedAgents: EliminatedAgent[] = [
  {
    id: 'el-1', name: '私域销售 v1', reason: '试岗 7 天回复率仅 4.2%, 远低于 SLA',
    replacedBy: '雪·销售官', eliminatedAt: '06-15', tasksTried: 38, finalScore: 41,
  },
  {
    id: 'el-2', name: '通用文档官 v0.9', reason: '会议纪要漏行动项 12 次, 用户主动下架',
    replacedBy: '芸·文档官', eliminatedAt: '06-10', tasksTried: 27, finalScore: 53,
  },
  {
    id: 'el-3', name: '法务助理 v1.2', reason: '合同条款召回率 0.61, 不达红圈所基线',
    replacedBy: '律·法务官', eliminatedAt: '05-29', tasksTried: 19, finalScore: 38,
  },
  {
    id: 'el-4', name: 'CRM 客服 Bot', reason: '无情绪识别能力, NPS 下降 14 点',
    replacedBy: '苓·客服官', eliminatedAt: '05-21', tasksTried: 412, finalScore: 49,
  },
];

// ── 视频③ 上岗 4 阶段生命周期（市场 → 试岗 → 评分 → 授权 → 入工区） ───
export const lifecycleCandidates: LifecycleCandidate[] = [
  {
    marketId: 'm-1', stage: 'onboarded', expectedZone: 'business',
    trialScore: 92, trialMetrics: { completed: 24, quality: 4.8, cost: '$18.4', risks: 0 },
  },
  {
    marketId: 'm-4', stage: 'trial', trialDay: 3,
    trialScore: 78, trialMetrics: { completed: 11, quality: 4.2, cost: '$9.20', risks: 1 },
  },
  {
    marketId: 'm-13', stage: 'scoring',
    trialScore: 88, trialMetrics: { completed: 18, quality: 4.6, cost: '$24.1', risks: 0 },
  },
  {
    marketId: 'm-7', stage: 'authorizing', expectedZone: 'business',
    trialScore: 95, trialMetrics: { completed: 30, quality: 4.9, cost: '$31.8', risks: 0 },
  },
  {
    marketId: 'm-25', stage: 'trial', trialDay: 5,
    trialScore: 65, trialMetrics: { completed: 8, quality: 3.8, cost: '$6.40', risks: 2 },
  },
  {
    marketId: 'm-19', stage: 'market', // 还没招
  },
];

// ── 4 阶段元数据 ─────────────────────────────────────────────────
export const LIFECYCLE_STAGES = [
  { id: 'market',       label: '在市场',     color: '#737373' },
  { id: 'trial',        label: '沙箱试岗',   color: '#F59E0B' },
  { id: 'scoring',      label: '评分中',     color: '#A855F7' },
  { id: 'authorizing',  label: '授权配置',   color: '#3B82F6' },
  { id: 'onboarded',    label: '已入工区',   color: '#10B981' },
] as const;

// ── 收件箱分类元数据 ─────────────────────────────────────────────
export const INBOX_KINDS = [
  { id: 'approval', label: '待我审批',  color: '#3B82F6' },
  { id: 'block',    label: '已阻断',    color: '#EF4444' },
  { id: 'stuck',    label: '卡住',     color: '#F59E0B' },
  { id: 'accept',   label: '待验收',    color: '#A855F7' },
  { id: 'anomaly',  label: '异常',     color: '#14B8A6' },
] as const;
