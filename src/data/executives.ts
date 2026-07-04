/**
 * 高管分身链路 — 老板 → 老板分身 → 高管分身 → 高管 → 数字员工
 * 这是企业级 Agent 编排的真实责任链，不是单点指挥
 */

export interface ExecutiveTwin {
  id: string;
  name: string;        // 分身名（如「林·CEO 分身」）
  role: string;        // 部门职务
  humanName: string;   // 真实高管姓名
  humanTitle: string;  // 真实高管职务
  avatar: string;      // 头像首字
  color: string;
  responsibility: string;   // 责任边界
  managesEmployeeIds: string[];  // 管理的数字员工 ids
  pendingHandoffs: number;       // 待真实高管确认的委派
}

export const executiveTwins: ExecutiveTwin[] = [
  {
    id: 'exec-ceo',
    name: '林·CEO 分身',
    role: '战略 / 经营驾驶舱',
    humanName: '林总',
    humanTitle: '集团 CEO · 创始人',
    avatar: '林',
    color: '#7E22CE',
    responsibility: '解析老板经营目标，拆解为 OKR + 季度行动项；高风险动作回传老板审批',
    managesEmployeeIds: ['emp-ceo'],
    pendingHandoffs: 0,
  },
  {
    id: 'exec-sales',
    name: '吴·销售 VP 分身',
    role: '销售增长',
    humanName: '吴 VP',
    humanTitle: '销售副总裁',
    avatar: '吴',
    color: '#0F70B7',
    responsibility: '负责 BD 节奏、客户分层、销售配额；分派目标到一线销售 Agent',
    managesEmployeeIds: ['emp-sales-1'],
    pendingHandoffs: 1,
  },
  {
    id: 'exec-ops',
    name: '邓·运营 VP 分身',
    role: '运营 / 内容',
    humanName: '邓 VP',
    humanTitle: '运营副总裁',
    avatar: '邓',
    color: '#0F766E',
    responsibility: '负责复盘、投放、内容产线、用户旅程；推 SOP 进化到部门员工',
    managesEmployeeIds: ['emp-ops', 'emp-design'],
    pendingHandoffs: 0,
  },
  {
    id: 'exec-product',
    name: '宋·产品负责人分身',
    role: '产品 / 研发',
    humanName: '宋 PM',
    humanTitle: '产品负责人',
    avatar: '宋',
    color: '#3B82F6',
    responsibility: '把战略目标拆为产品需求 + 研发优先级；A2A 派发给研发 Agent',
    managesEmployeeIds: ['emp-pm', 'emp-dev'],
    pendingHandoffs: 2,
  },
  {
    id: 'exec-finance',
    name: '万·CFO 分身',
    role: '财务 / 法务',
    humanName: '万 CFO',
    humanTitle: '财务总监',
    avatar: '万',
    color: '#B07706',
    responsibility: '资金调拨、合规审查、合同风险；> 50w 调拨强制四眼原则回传',
    managesEmployeeIds: ['emp-finance', 'emp-legal'],
    pendingHandoffs: 1,
  },
];

export const HUMAN_BOSS = {
  name: '昆仑',
  title: '创始人 · 蓝血军团',
  avatar: '昆',
};
export const BOSS_TWIN = {
  name: '昆仑·数字分身',
  title: '老板数字分身 · 企业意图入口',
  avatar: '昆',
  responsibility: '代表老板昆仑总持目标、授权、验收、责任边界；把意图转译为企业行动并下发到高管分身',
};

// A2A 委派事件（用于 mock runtime 推送到审计 / 对话）
export interface A2AHandoff {
  fromId: string;  // exec id 或 'boss' / 'boss-twin'
  fromLabel: string;
  toId: string;
  toLabel: string;
  intent: string;
  channel: string;
}

export const a2aHandoffPool: A2AHandoff[] = [
  { fromId: 'boss',      fromLabel: '昆仑（老板）',     toId: 'boss-twin',    toLabel: '昆仑·数字分身',   intent: 'Q3 增长目标 · 锁定华东 23 家大客户', channel: 'ch-q3' },
  { fromId: 'boss-twin', fromLabel: '昆仑·数字分身',   toId: 'exec-sales',   toLabel: '吴·销售 VP 分身', intent: 'Q3 BD 战役拆解，本周内出客户分层', channel: 'ch-q3' },
  { fromId: 'exec-sales',fromLabel: '吴·销售 VP 分身', toId: 'emp-sales-1',  toLabel: '雪·销售官',       intent: '基于 CRM 分层，起草 BD 邮件 + 报价单',channel: 'ch-q3' },
  { fromId: 'boss-twin', fromLabel: '昆仑·数字分身',   toId: 'exec-ops',     toLabel: '邓·运营 VP 分身', intent: '618 复盘报告同步到客户视角',           channel: 'ch-618' },
  { fromId: 'exec-ops',  fromLabel: '邓·运营 VP 分身', toId: 'emp-ops',      toLabel: '岚·运营官',       intent: '复盘报告引入跨渠道归因 + 客户旅程',     channel: 'ch-618' },
  { fromId: 'boss-twin', fromLabel: '昆仑·数字分身',   toId: 'exec-finance', toLabel: '万·CFO 分身',     intent: '复核 138w 调拨合规性',                  channel: 'ch-q3' },
  { fromId: 'exec-finance',fromLabel:'万·CFO 分身',   toId: 'emp-legal',    toLabel: '律·法务官',       intent: '审阅主合同 v4 含 3 条高危条款',         channel: 'ch-q3' },
  { fromId: 'exec-product',fromLabel:'宋·产品负责人分身', toId: 'emp-dev',  toLabel: '炅·研发官',       intent: '修复 API 接口 P1 bug',                 channel: 'ch-q3' },
];
