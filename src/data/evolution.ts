/**
 * 进化中心 mock 数据（grills/01-growth-loop.md）
 * 三层：组织层总览 / 个体进化档案（能力分曲线 + 因果链）/ 机制层飞轮
 * 口径：employeeId / 名字与 data/employees.ts 一致；bad case 引用 data/hermes.ts；
 *      SOP 版本历史复用 data/douyin.ts 的 sopVersions。
 */

// ── 跨页定位：Drawer「查看完整因果链」→ 进化中心 Tab2 选中该员工 ──────
let focusEmployeeId: string | null = null;

export const setFocusEmployeeId = (id: string | null): void => {
  focusEmployeeId = id;
};

/** 页面挂载时读取并清空（一次性消费） */
export const consumeFocusEmployeeId = (): string | null => {
  const id = focusEmployeeId;
  focusEmployeeId = null;
  return id;
};

// ── 类型（仅本模块内部使用，不动 lib/types.ts） ─────────────────────
export interface AbilityPoint {
  week: string;
  score: number;
  /** 该周发生 SOP/Skill 版本升级时标注版本号 */
  bump?: string;
}

export interface AbilityProfile {
  employeeId: string;
  currentScore: number;
  weekDelta: number;
  /** 同岗位平均能力分（平台口径） */
  roleAvgScore: number;
  points: AbilityPoint[];
}

export type CausalStepKind =
  | 'badcase' | 'attribution' | 'candidate' | 'sandbox'
  | 'approval' | 'gray' | 'success' | 'score';

export interface CausalStep {
  id: string;
  ts: string;
  kind: CausalStepKind;
  title: string;
  detail: string;
}

export interface CausalChain {
  employeeId: string;
  title: string;
  /** 引用 data/hermes.ts 的 bad case id */
  badCaseId: string;
  scoreFrom: number;
  scoreTo: number;
  steps: CausalStep[];
}

export type EvolutionEventKind = 'sop' | 'skill' | 'eliminate' | 'cert';

export interface EvolutionEvent {
  id: string;
  ts: string;
  kind: EvolutionEventKind;
  title: string;
  agent: string;
  detail: string;
}

export interface DeptScore {
  dept: string;
  score: number;
  prev: number;
}

// ── 组织层总览 ───────────────────────────────────────────────────
export const orgOverview = {
  monthLabel: '7 月',
  sopUpgrades: 12,
  sopUpgradesDelta: '较上月 +4',
  avgScoreFrom: 76,
  avgScoreTo: 81,
  badCaseFixed: 47,
  badCaseTotal: 54,
  badCaseFixRate: 87,
  roiHours: 312,
  roiNote: '一次通过率 82% → 91% 折算返工人时',
};

export const evolutionEvents: EvolutionEvent[] = [
  { id: 'ev-1', ts: '07-03', kind: 'sop',       title: 'SOP「资金调拨」v3 → v4', agent: '砚·财务官', detail: '> 50w 强制审批单 + 飞书审批，沙箱阻断率 0% → 100%' },
  { id: 'ev-2', ts: '07-02', kind: 'skill',     title: '技能上架「BD 邮件 v3.2」', agent: '雪·销售官', detail: '问候语引入互动史前 3 件事，回复率 8.2% → 26.6%' },
  { id: 'ev-3', ts: '07-01', kind: 'sop',       title: 'SOP「合同审阅」v2.4 → v2.7', agent: '律·法务官', detail: 'KG 扩充「合同-法规-行业」边，召回率 81% → 94%' },
  { id: 'ev-4', ts: '06-28', kind: 'cert',      title: '重新认证通过', agent: '璇·数据官', detail: 'SOP「自动化报表」v5.1 · GEPA 补样本 220 条后准确率 96.1%' },
  { id: 'ev-5', ts: '06-25', kind: 'eliminate', title: '淘汰建议：私域销售 v1', agent: 'Hermes', detail: '连续 3 次进化失败（改进后仍不达标），建议版本下线 · 已进老板收件箱' },
  { id: 'ev-6', ts: '06-22', kind: 'skill',     title: '技能上架「情绪识别 v2」', agent: '苓·客服官', detail: '中英混合场景重训分类器，准确率 78% → 91%' },
  { id: 'ev-7', ts: '06-20', kind: 'sop',       title: 'SOP「OKR 拆解」v6.0 → v6.1', agent: '林·决策官', detail: '新增季度风险节点，评测准确率 94.1% → 96.4%' },
];

export const deptScores: DeptScore[] = [
  { dept: '决策中心',     score: 93, prev: 89 },
  { dept: '会议室',       score: 87, prev: 84 },
  { dept: '行政支持中心', score: 84, prev: 80 },
  { dept: '业务办公区',   score: 81, prev: 76 },
  { dept: '休息区',       score: 81, prev: 79 },
];

// ── 个体层：近 8 周能力分曲线 ─────────────────────────────────────
const WEEKS = ['5/15', '5/22', '5/29', '6/5', '6/12', '6/19', '6/26', '7/3'];

const mk = (
  employeeId: string,
  scores: number[],
  roleAvgScore: number,
  bumps: Record<number, string> = {},
): AbilityProfile => ({
  employeeId,
  currentScore: scores[scores.length - 1],
  weekDelta: scores[scores.length - 1] - scores[scores.length - 2],
  roleAvgScore,
  points: scores.map((score, i) => ({ week: WEEKS[i], score, bump: bumps[i] })),
});

export const abilityProfiles: AbilityProfile[] = [
  mk('emp-ceo',       [84, 85, 86, 88, 89, 90, 91, 93], 86, { 2: 'v5.2', 5: 'v6.0', 7: 'v6.1' }),
  mk('emp-sales-1',   [64, 68, 72, 75, 78, 78, 79, 85], 76, { 1: 'v2.1', 3: 'v3.0', 7: 'v3.2' }),
  mk('emp-ops',       [70, 71, 73, 74, 76, 77, 78, 80], 75, { 4: 'v4.0' }),
  mk('emp-finance',   [68, 71, 73, 75, 74, 72, 74, 82], 75, { 2: 'v2.5', 5: 'v3.0', 7: 'v4.0' }),
  mk('emp-hr',        [72, 73, 74, 74, 75, 76, 77, 78], 74),
  mk('emp-legal',     [70, 72, 74, 76, 81, 82, 84, 88], 79, { 4: 'v2.4', 7: 'v2.7' }),
  mk('emp-cs',        [74, 76, 78, 80, 82, 84, 85, 86], 78, { 3: 'v2.1' }),
  mk('emp-dev',       [71, 73, 74, 76, 77, 79, 80, 82], 77, { 5: 'v3.3' }),
  mk('emp-data',      [60, 63, 65, 68, 70, 73, 76, 80], 72, { 4: 'v5.0', 7: 'v5.1' }),
  mk('emp-doc',       [73, 74, 75, 76, 76, 77, 78, 79], 74),
  mk('emp-meeting-1', [80, 81, 82, 83, 84, 85, 86, 87], 82, { 4: 'v3.0' }),
  mk('emp-design',    [72, 73, 75, 76, 78, 79, 80, 81], 76, { 3: 'v2.1' }),
  mk('emp-pm',        [78, 79, 80, 82, 83, 84, 85, 86], 80, { 5: 'v4.2' }),
  mk('emp-sec',       [76, 77, 79, 80, 82, 83, 84, 85], 79, { 2: 'v3.1' }),
  mk('emp-rest-1',    [75, 76, 77, 78, 79, 80, 81, 81], 76),
];

export const getAbilityProfile = (employeeId: string): AbilityProfile | undefined =>
  abilityProfiles.find((p) => p.employeeId === employeeId);

// ── 个体层：因果链（设计文档的灵魂） ─────────────────────────────
export const causalChains: CausalChain[] = [
  {
    employeeId: 'emp-sales-1',
    title: 'BD 邮件被识别为模板 → 能力分 78 → 85',
    badCaseId: 'bc-2',
    scoreFrom: 78,
    scoreTo: 85,
    steps: [
      { id: 'cs-1', ts: '周一 09:14', kind: 'badcase',     title: 'Bad case：BD 邮件被识别为模板', detail: '发给北辰金融赵总的 BD 邮件 7 天零回复，反馈环判定失败（case bc-2）' },
      { id: 'cs-2', ts: '周一 09:18', kind: 'attribution', title: 'Hermes 归因', detail: 'Prompt「客户问候」段落过于通用，被对方邮件网关识别为营销模板' },
      { id: 'cs-3', ts: '周一 10:05', kind: 'candidate',   title: 'Skill v3.1 → v3.2 候选', detail: 'GEPA 建议：问候段引入客户互动史前 3 件事，生成候选版本' },
      { id: 'cs-4', ts: '周二 02:00', kind: 'sandbox',     title: '沙箱回归 4/5 → 5/5', detail: '重放 5 条历史同类任务全部通过；A/B 评测回复率 8.2% → 26.6%' },
      { id: 'cs-5', ts: '周二 09:30', kind: 'approval',    title: '审批通过 · 昆仑（您）', detail: '人审确认改写不涉敏、无越权外发，符合强制人审策略' },
      { id: 'cs-6', ts: '周二 10:00', kind: 'gray',        title: '灰度生效', detail: 'v3.2 灰度到雪·销售官：10% 流量观察 2 小时 → 放量 100%' },
      { id: 'cs-7', ts: '周四 11:20', kind: 'success',     title: '同类任务成功', detail: '鲲鹏制造 BD 邮件发出 2 小时获客户回复，验收一次通过' },
      { id: 'cs-8', ts: '周四 18:00', kind: 'score',       title: '能力分 78 → 85', detail: '周度在线评测重算：BD 邮件维度 +7，进入岗位前 20%' },
    ],
  },
  {
    employeeId: 'emp-finance',
    title: '138w 调拨触发风控 → 能力分 74 → 82',
    badCaseId: 'bc-1',
    scoreFrom: 74,
    scoreTo: 82,
    steps: [
      { id: 'cf-1', ts: '周一 14:32', kind: 'badcase',     title: 'Bad case：138w 调拨触发风控', detail: 'SOP v3 未识别 > 50w 强制审批分支，直接调用 ERP，被 Exec-Guardian 阻断（case bc-1）' },
      { id: 'cf-2', ts: '周一 14:40', kind: 'attribution', title: 'Hermes 归因', detail: 'trace step-6：跳过审批单生成直接调用 erp.kingdee.transfer，阈值分支缺失' },
      { id: 'cf-3', ts: '周一 16:20', kind: 'candidate',   title: 'SOP v3 → v4 候选', detail: '改写规则：> 50w 必须生成审批单 + 飞书审批，四眼原则落到流程内' },
      { id: 'cf-4', ts: '周二 03:00', kind: 'sandbox',     title: '沙箱回归 4/5 → 5/5', detail: '重放 5 条历史调拨任务全部通过；高危调拨阻断率 0% → 100%' },
      { id: 'cf-5', ts: '周三 09:10', kind: 'approval',    title: '审批通过 · 昆仑（您）+ 律·法务官', detail: '涉资金 SOP 双签生效：合规复核无异议' },
      { id: 'cf-6', ts: '周三 09:30', kind: 'gray',        title: '灰度生效', detail: 'v4 生效到砚·财务官，v3 同步下线并入审计链 0x4af2..' },
      { id: 'cf-7', ts: '周四 15:05', kind: 'success',     title: '同类任务成功', detail: '82w 调拨自动生成审批单 → 飞书审批通过后执行，全程零人工干预' },
      { id: 'cf-8', ts: '周四 18:00', kind: 'score',       title: '能力分 74 → 82', detail: '周度评测重算：资金合规维度 +8，风险事件清零' },
    ],
  },
];

export const getCausalChain = (employeeId: string): CausalChain | undefined =>
  causalChains.find((c) => c.employeeId === employeeId);
