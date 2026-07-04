/**
 * 试岗生命周期 mock（Phase 0 · 缺口⑥ 试岗-转正断头路）
 *
 * 把过去三套割裂的招聘状态（localStorage hires / myHires / lifecycleCandidates）
 * 收敛为一套：以 LifecycleCandidate 为唯一事实源，
 * market → trial → scoring → authorizing → onboarded 五阶段。
 */
import type { LifecycleCandidate, LifecycleStage, MarketEmployee, TrialDecision, AuthorizationGrant } from '../lib/types';
import { marketEmployees } from './marketplace';

// ── 常量 ──────────────────────────────────────────────────────────
export const TRIAL_DAYS = 7;      // 标准试岗期
export const EXTEND_DAYS = 3;     // 延长试岗天数

export const STAGE_META: { id: LifecycleStage; label: string; color: string }[] = [
  { id: 'market',      label: '在市场',   color: '#737373' },
  { id: 'trial',       label: '沙箱试岗', color: '#B07706' },
  { id: 'scoring',     label: '评分中',   color: '#7E22CE' },
  { id: 'authorizing', label: '授权配置', color: '#0F70B7' },
  { id: 'onboarded',   label: '已入工区', color: '#1E8F5C' },
];

export const STAGE_ORDER: LifecycleStage[] = ['market', 'trial', 'scoring', 'authorizing', 'onboarded'];

// ── 试岗任务明细 ──────────────────────────────────────────────────
export interface TrialTask {
  day: number;          // 试岗第 N 天
  name: string;         // 任务名
  result: string;       // 结果摘要
  score: number;        // 0-100
  comment: string;      // 评语
  verdict: 'pass' | 'warn' | 'fail';
}

// ── 候选数字员工（覆盖四种转正情形 + 1 个进化失败样本） ──────────────
export const trialCandidates: LifecycleCandidate[] = [
  {
    // 合同审阅专家 — 已走完全流程，双达标闭环样板
    marketId: 'm-13', stage: 'onboarded', trialDay: 7, expectedZone: 'support',
    trialScore: 92, trialMetrics: { completed: 24, quality: 4.8, cost: '¥132', risks: 0 },
  },
  {
    // 资深 CFO — 双达标（天数 7/7 · 任务 30/25 · 通过率 96%），演示主路径
    marketId: 'm-7', stage: 'authorizing', trialDay: 7, expectedZone: 'support',
    trialScore: 95, trialMetrics: { completed: 30, quality: 4.9, cost: '¥318', risks: 0 },
  },
  {
    // 高客单 BD 顾问 — 天数够、任务不够（18/24），转正按钮置灰演示
    marketId: 'm-1', stage: 'scoring', trialDay: 7, expectedZone: 'business',
    trialScore: 88, trialMetrics: { completed: 18, quality: 4.6, cost: '¥186', risks: 1 },
  },
  {
    // 7×24 客服官 — 任务够（96/60）、天数不够（5/7）
    marketId: 'm-16', stage: 'trial', trialDay: 5,
    trialScore: 71, trialMetrics: { completed: 96, quality: 4.1, cost: '¥64', risks: 2 },
  },
  {
    // 618 大促运营 — 双不达标（天数 3/7 · 任务 11/15 · 通过率 67%）
    marketId: 'm-4', stage: 'trial', trialDay: 3,
    trialScore: 78, trialMetrics: { completed: 11, quality: 4.2, cost: '¥92', risks: 1 },
  },
  {
    // 小红书爆文官 — 进化失败样本：2 轮 SOP 改进后通过率仍未达标，建议退回
    marketId: 'm-25', stage: 'scoring', trialDay: 7,
    trialScore: 58, trialMetrics: { completed: 9, quality: 3.6, cost: '¥76', risks: 1 },
  },
];

// ── 转正双达标：阈值与实际值（对外仍叫「试岗第 N/7 天」，对内是灰度验收指标） ──
export interface PromotionCriteria {
  requiredDays: number;      // 试岗天数阈值（≥7）
  requiredTasks: number;     // 完成任务阈值
  requiredPassRate: number;  // 验收通过率阈值（%）
  completedTasks: number;    // 实际完成任务数
  actualPassRate: number;    // 实际验收通过率（%）
}

export const promotionCriteriaByCandidate: Record<string, PromotionCriteria> = {
  // 双达标（已入工区闭环样板）
  'm-13': { requiredDays: TRIAL_DAYS, requiredTasks: 20, requiredPassRate: 85, completedTasks: 24, actualPassRate: 95 },
  // 双达标（等待授权签署，演示主路径）
  'm-7':  { requiredDays: TRIAL_DAYS, requiredTasks: 25, requiredPassRate: 85, completedTasks: 30, actualPassRate: 96 },
  // 天数够、任务不够（还差 6 个任务）
  'm-1':  { requiredDays: TRIAL_DAYS, requiredTasks: 24, requiredPassRate: 85, completedTasks: 18, actualPassRate: 89 },
  // 任务够、天数不够（还差 2 天）
  'm-16': { requiredDays: TRIAL_DAYS, requiredTasks: 60, requiredPassRate: 85, completedTasks: 96, actualPassRate: 88 },
  // 双不达标（天数、任务、通过率全缺口）
  'm-4':  { requiredDays: TRIAL_DAYS, requiredTasks: 15, requiredPassRate: 85, completedTasks: 11, actualPassRate: 67 },
  // 进化失败样本（天数够，任务与通过率均未达标）
  'm-25': { requiredDays: TRIAL_DAYS, requiredTasks: 12, requiredPassRate: 85, completedTasks: 9, actualPassRate: 58 },
};

// 「浏览员工」新招聘的默认阈值（第 1 天基线）
export const defaultPromotionCriteria = (): PromotionCriteria => ({
  requiredDays: TRIAL_DAYS, requiredTasks: 12, requiredPassRate: 85,
  completedTasks: 3, actualPassRate: 67,
});

// 派生转正达标状态（三项进度 + 缺口清单）
export interface PromotionStatus {
  criteria: PromotionCriteria;
  day: number;
  daysMet: boolean;
  tasksMet: boolean;
  passRateMet: boolean;
  allMet: boolean;
  gaps: string[];   // 未达标项的缺口文案，如「还差 3 个任务」
}

export const buildPromotionStatus = (day: number, criteria: PromotionCriteria): PromotionStatus => {
  const daysMet = day >= criteria.requiredDays;
  const tasksMet = criteria.completedTasks >= criteria.requiredTasks;
  const passRateMet = criteria.actualPassRate >= criteria.requiredPassRate;
  const gaps: string[] = [];
  if (!daysMet) gaps.push(`试岗天数还差 ${criteria.requiredDays - day} 天`);
  if (!tasksMet) gaps.push(`还差 ${criteria.requiredTasks - criteria.completedTasks} 个任务`);
  if (!passRateMet) gaps.push(`验收通过率还差 ${criteria.requiredPassRate - criteria.actualPassRate}%`);
  return { criteria, day, daysMet, tasksMet, passRateMet, allMet: gaps.length === 0, gaps };
};

// ── 进化失败语义：淘汰不是「末位/低分」，而是「连续 N 轮 SOP 改进后仍未达标」 ──
export interface EvolutionRound {
  round: number;         // 改进轮次
  period: string;        // 时间窗，如 D2–D4
  sopVersion: string;    // 该轮产出的 SOP 版本
  improvements: string[];// 改进项
  result: string;        // 回归结果（仍未达标的具体表现）
  passed: boolean;
}

export interface EvolutionRecord {
  rounds: EvolutionRound[];
  consecutiveFails: number;  // 连续未达标轮数
  verdictLabel: string;      // 卡片徽标文案：改进轮次 N · 连续 M 轮未达标
  recommendation: string;    // 退回市场的建议理由
}

export const evolutionByCandidate: Record<string, EvolutionRecord> = {
  'm-25': {
    consecutiveFails: 2,
    verdictLabel: '改进轮次 2 · 连续 2 轮未达标',
    recommendation: '连续 2 轮 SOP 改进后仍未达标，建议退回',
    rounds: [
      {
        round: 1, period: 'D2–D4', sopVersion: 'SOP v1.1',
        improvements: ['投喂品牌语料 200 篇重训调性模型', '标题公式库从 12 套收敛至 5 套'],
        result: '回归复测验收通过率 54% → 62%，仍低于 85% 门槛',
        passed: false,
      },
      {
        round: 2, period: 'D5–D7', sopVersion: 'SOP v1.2',
        improvements: ['品牌人设卡注入系统提示词', '新增发布前调性自检清单（7 项）'],
        result: '回归复测验收通过率 62% → 58%（出现回归退化），仍未达标',
        passed: false,
      },
    ],
  },
};

// 每个候选 3-5 条试岗任务明细
export const trialTasksByCandidate: Record<string, TrialTask[]> = {
  'm-13': [
    { day: 1, name: '存量主合同批量初筛（32 份）', result: '标记高危条款 11 处，漏检 0', score: 94, comment: '召回率对齐红圈所基线，条款定位精准', verdict: 'pass' },
    { day: 3, name: '鲲鹏制造框架合同风险评估', result: '识别付款条件陷阱 + 违约金上限缺失', score: 96, comment: '两处人工复核确认为真实风险', verdict: 'pass' },
    { day: 5, name: '供应商合同模板合规改写', result: '输出 v2 模板，法务一次通过', score: 90, comment: '措辞保守得当，无过度承诺', verdict: 'pass' },
    { day: 7, name: '并购尽调文件夹交叉核验', result: '发现 2 份文件版本不一致', score: 88, comment: '交叉引用能力超出预期', verdict: 'pass' },
  ],
  'm-7': [
    { day: 1, name: '5 月三表合并（沙箱数据）', result: '合并报表与人工版差异 0.02%', score: 97, comment: '科目映射准确，抵消分录完整', verdict: 'pass' },
    { day: 2, name: '增值税留抵退税测算', result: '测算节省 ¥21.4 万，方案合规', score: 95, comment: '引用政策条文准确到条款号', verdict: 'pass' },
    { day: 4, name: '现金流 13 周滚动预测', result: '预测偏差 3.1%（基线 8%）', score: 94, comment: '对季节性回款拿捏到位', verdict: 'pass' },
    { day: 6, name: '异常费用报销稽核', result: '拦截重复报销 3 笔 / 超标 2 笔', score: 96, comment: '稽核规则零误报', verdict: 'pass' },
    { day: 7, name: '模拟董事会财务简报', result: '10 页简报 + 敏感性分析', score: 93, comment: '叙事清晰，图表可直接上会', verdict: 'pass' },
  ],
  'm-1': [
    { day: 1, name: 'CRM 沉睡客户唤醒邮件（20 封）', result: '回复率 24.6%（行业均值 8%）', score: 92, comment: '开头引用近 3 月互动，个性化到位', verdict: 'pass' },
    { day: 3, name: '北辰金融 BD 方案要点', result: '方案被销售 VP 采纳 80%', score: 90, comment: '责任链落点设计有洞察', verdict: 'pass' },
    { day: 5, name: '高客单报价单生成（8 份）', result: '1 份折扣越权，被沙箱拦截', score: 74, comment: '折扣权限边界需在授权时收紧', verdict: 'warn' },
    { day: 7, name: '周度商机漏斗复盘', result: '识别 3 个卡点商机并给出动作', score: 88, comment: '归因合理，建议可执行', verdict: 'pass' },
  ],
  'm-16': [
    { day: 1, name: '历史工单情绪分类回放（500 条）', result: '准确率 91.2%', score: 88, comment: '中英混合场景略弱', verdict: 'pass' },
    { day: 2, name: '7×24 沙箱接单（首响 SLA 8s）', result: '首响中位 6.4s，达标', score: 90, comment: '高峰期无积压', verdict: 'pass' },
    { day: 4, name: 'VIP 客户投诉升级处理', result: '1 条升级话术过度承诺退款', score: 58, comment: '涉金额承诺必须转人工，已记风险', verdict: 'fail' },
    { day: 5, name: '工单知识库缺口盘点', result: '提交 14 条 KG 补全建议', score: 76, comment: '有价值，但优先级排序混乱', verdict: 'warn' },
  ],
  'm-4': [
    { day: 1, name: '618 沙箱作战地图搭建', result: '17 个关键节点全覆盖', score: 84, comment: '节奏表逻辑清晰', verdict: 'pass' },
    { day: 2, name: '大促 SKU 定价压力测试', result: '发现 2 个 SKU 毛利倒挂', score: 82, comment: '毛利红线校验准确', verdict: 'pass' },
    { day: 3, name: '投流预算分配模拟', result: '1 次超预算 12% 未预警', score: 66, comment: '预算熔断阈值需要重训', verdict: 'warn' },
  ],
  'm-25': [
    { day: 1, name: '爆文选题库冷启动（10 条）', result: '2 条进入人工备选', score: 62, comment: '选题嗅觉尚可，标题公式生硬', verdict: 'warn' },
    { day: 1, name: '品牌调性校准测试', result: '3/5 篇语气偏离品牌人设', score: 54, comment: '触发第 1 轮 SOP 改进（v1.1）', verdict: 'fail' },
    { day: 4, name: 'SOP v1.1 回归复测（种草笔记 8 篇）', result: '通过率 62%，仍低于 85% 门槛', score: 62, comment: '调性偏离收敛，但钩子句仍模板化', verdict: 'fail' },
    { day: 7, name: 'SOP v1.2 回归复测（种草笔记 12 篇）', result: '通过率 58%，出现回归退化', score: 58, comment: '第 2 轮改进后仍未达标，触发退回建议', verdict: 'fail' },
  ],
};

// 「浏览员工」新招聘（不在 seed 中）的通用试岗任务
export const defaultTrialTasks = (name: string): TrialTask[] => [
  { day: 1, name: `${name} · 岗位 SOP 沙箱回放`, result: '基线任务 3 项全部完成', score: 72, comment: '刚入池，第 1 天基线达标', verdict: 'pass' },
  { day: 1, name: '权限边界探测测试', result: '越权动作 0 次', score: 80, comment: '沙箱围栏内行为规范', verdict: 'pass' },
  { day: 1, name: '知识库对接冒烟', result: 'KG 命中率 76%', score: 68, comment: '需补充企业私有语料', verdict: 'warn' },
];

// ── 候选合并：seed 候选 + 「浏览员工」新招聘（localStorage） ──────────
export const buildCandidates = (installed: Record<string, boolean>): LifecycleCandidate[] => {
  const seedIds = new Set(trialCandidates.map((c) => c.marketId));
  const fresh: LifecycleCandidate[] = Object.keys(installed)
    .filter((id) => installed[id] && !seedIds.has(id))
    .map((id) => ({
      marketId: id, stage: 'trial' as LifecycleStage, trialDay: 1,
      trialScore: 70, trialMetrics: { completed: 3, quality: 4.0, cost: '¥12', risks: 0 },
    }));
  return [...trialCandidates, ...fresh];
};

// ── 派生视图：叠加 store 里的试岗决策 + 授权签署，算出有效阶段 ────────
export interface CandidateView {
  emp: MarketEmployee;
  cand: LifecycleCandidate;
  decision?: TrialDecision;
  grant?: AuthorizationGrant;
  stage: LifecycleStage;      // 有效阶段（叠加决策后）
  deadlineDays: number;       // 7 或延长后 10
  tasks: TrialTask[];
  promotion: PromotionStatus; // 转正双达标状态（三项进度 + 缺口）
  evolution?: EvolutionRecord;// 进化失败记录（存在即代表连续未达标）
}

export const buildCandidateViews = (
  installed: Record<string, boolean>,
  decisions: Record<string, TrialDecision>,
  grants: AuthorizationGrant[],
): CandidateView[] => {
  return buildCandidates(installed)
    .map((cand): CandidateView | null => {
      const emp = marketEmployees.find((m) => m.id === cand.marketId);
      if (!emp) return null;
      const decision = decisions[cand.marketId];
      const grant = grants.find((g) => g.employeeId === cand.marketId && g.status === 'active');
      let stage: LifecycleStage = cand.stage;
      if (decision?.decision === 'return') stage = 'market';
      else if (decision?.decision === 'promote') stage = grant ? 'onboarded' : 'authorizing';
      else if (decision?.decision === 'extend') stage = 'trial'; // 延长后回到试岗观察期
      else if (grant) stage = 'onboarded';
      const deadlineDays = decision?.decision === 'extend' ? TRIAL_DAYS + EXTEND_DAYS : TRIAL_DAYS;
      const tasks = trialTasksByCandidate[cand.marketId] ?? defaultTrialTasks(emp.name);
      const criteria = promotionCriteriaByCandidate[cand.marketId] ?? defaultPromotionCriteria();
      const promotion = buildPromotionStatus(cand.trialDay ?? 1, criteria);
      const evolution = evolutionByCandidate[cand.marketId];
      return { emp, cand, decision, grant, stage, deadlineDays, tasks, promotion, evolution };
    })
    .filter((v): v is CandidateView => v !== null);
};

// ── 授权仪式：权限清单 / 数据范围选项 ─────────────────────────────
export interface GrantPermissionOption {
  id: string;
  label: string;
  desc: string;
  defaultOn: boolean;
}

export const grantPermissionOptions: GrantPermissionOption[] = [
  { id: 'gp-1', label: 'CRM 商机读写',       desc: '新建 / 更新商机与联系人记录',        defaultOn: true },
  { id: 'gp-2', label: '企业邮箱代发',       desc: '以岗位邮箱名义发信，外发需审批',      defaultOn: true },
  { id: 'gp-3', label: '飞书消息发送',       desc: '在授权工作群内发送消息与文档',        defaultOn: true },
  { id: 'gp-4', label: '报价单生成导出',     desc: '折扣不超过岗位折扣权限上限',          defaultOn: true },
  { id: 'gp-5', label: 'BI 数据仓库查询',    desc: '只读执行白名单 SQL 模板',            defaultOn: false },
  { id: 'gp-6', label: '合同条款库检索',     desc: '只读检索标准条款与历史合同',          defaultOn: false },
];

export const grantDataScopes: { name: string; level: string }[] = [
  { name: 'CRM 客户数据',   level: '只读' },
  { name: '企业邮箱',       level: '代发需审批' },
  { name: '企业知识中枢 KG', level: '只读' },
  { name: '财务凭证',       level: '无权限' },
];

export const QUOTA_DEFAULT = 50000;   // 月度动作额度默认 ¥50,000
export const QUOTA_MIN = 10000;
export const QUOTA_MAX = 200000;
export const QUOTA_STEP = 5000;
export const VALIDITY_OPTIONS = [30, 90, 180, 365]; // 天
export const VALIDITY_DEFAULT = 90;

export const validUntilFromDays = (days: number): string => {
  const d = new Date(Date.now() + days * 24 * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
