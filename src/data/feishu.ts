import type { FeishuMessage, RoleKey } from '../lib/types';
import { employees } from './employees';
import { executiveTwins, HUMAN_BOSS, BOSS_TWIN } from './executives';

// v8: 按 brief 第六条重排频道，主流核心 6 个企业群在最上；保留旧 id 以避免历史消息断链
// v2 群规则（Grill 02）：追加 dm 类型的「分身 1v1 管理通道」ch-twin-sales
export const channels = [
  { id: 'ch-boss',       name: '老板总控群',        unread: 2, members: 5,  type: 'boss' },
  { id: 'ch-exec',       name: '高管分身会议室',    unread: 1, members: 6,  type: 'exec' },
  { id: 'ch-twin-sales', name: '吴帆 ⇄ 销售VP分身', unread: 1, members: 2,  type: 'dm' },
  { id: 'ch-q3',         name: '销售增长作战群',    unread: 3, members: 8,  type: 'project' },
  { id: 'ch-mkt',        name: '市场内容群',        unread: 0, members: 5,  type: 'project' },
  { id: 'ch-delivery',   name: '客户交付群',        unread: 1, members: 4,  type: 'project' },
  { id: 'ch-risk',       name: '风险审计群',        unread: 2, members: 4,  type: 'incident' },
  { id: 'ch-618',        name: '618 复盘',          unread: 1, members: 4,  type: 'project' },
  { id: 'ch-hermes',     name: '质量复盘通告',      unread: 5, members: 9,  type: 'system' },
];

// ───────── 角色 × 频道 访问契约（UI 层 LeftNav/ChatPage/ChannelList 统一消费） ─────────
export type ChannelAccess = { read: boolean; write: boolean; note?: string };

// 角色 × 频道访问矩阵；某频道无条目 = 该角色不可见
export const ROLE_CHANNEL_ACCESS: Record<RoleKey, Record<string, ChannelAccess>> = {
  boss: {
    'ch-boss':     { read: true, write: true },
    'ch-exec':     { read: true, write: true },
    'ch-q3':       { read: true, write: true },
    'ch-mkt':      { read: true, write: true },
    'ch-delivery': { read: true, write: true },
    'ch-risk':     { read: true, write: true },
    'ch-618':      { read: true, write: true },
    'ch-hermes':   { read: true, write: true },
    'ch-twin-sales': { read: true, write: false, note: '合规可见' },
  },
  exec: {
    'ch-exec':       { read: true, write: true, note: '仅确认/仲裁' },
    'ch-twin-sales': { read: true, write: true, note: '确认/打回' },
    'ch-q3':         { read: true, write: true },
    'ch-618':      { read: true, write: true },
    'ch-risk':     { read: true, write: true, note: '审批会签' },
    'ch-hermes':   { read: true, write: false },
    'ch-delivery': { read: true, write: true },
  },
  staff: {
    'ch-q3':     { read: true, write: true },
    'ch-618':    { read: true, write: true },
    'ch-hermes': { read: true, write: false, note: '只读' },
  },
  expert: {
    'ch-q3': { read: true, write: true, note: '工单期临时入群' },
  },
  auditor: {
    'ch-boss':     { read: true, write: false, note: '审计只读' },
    'ch-exec':     { read: true, write: false, note: '审计只读' },
    'ch-q3':       { read: true, write: false, note: '审计只读' },
    'ch-mkt':      { read: true, write: false, note: '审计只读' },
    'ch-delivery': { read: true, write: false, note: '审计只读' },
    'ch-risk':     { read: true, write: false, note: '审计只读' },
    'ch-618':      { read: true, write: false, note: '审计只读' },
    'ch-hermes':   { read: true, write: false, note: '审计只读' },
  },
};

// 频道分组（责任链群置顶），供 LeftNav/ChatPage/ChannelList 统一使用
export const CHANNEL_GROUPS: { title: string; ids: string[] }[] = [
  { title: '责任链群',   ids: ['ch-boss', 'ch-exec'] },
  { title: '分身管理',   ids: ['ch-twin-sales'] },
  { title: '业务作战群', ids: ['ch-q3', 'ch-mkt', 'ch-delivery', 'ch-618'] },
  { title: '风险通道',   ids: ['ch-risk'] },
  { title: '系统通告',   ids: ['ch-hermes'] },
];

// ───────── v2 · 成员推导（Grill 02 待实现清单 #1）─────────
// 群成员不再手工配置，而是从组织结构推导：
//   业务作战群 = 业务单元全体（数字员工 + 一线真人）+ 沿 managesEmployeeIds 反查的上级链 + 老板（免打扰）
//   责任链群 / 风险通道 / 系统通告 按 v2 生成规则表生成。
// ROLE_CHANNEL_ACCESS 保留为「当前角色视角」的访问覆盖层，与本推导互不冲突。
export interface ChannelMember {
  name: string;
  kind: 'boss' | 'boss-twin' | 'exec-twin' | 'human-exec' | 'agent' | 'human-staff' | 'guardian' | 'hermes' | 'expert';
  reason: string;
  muted?: boolean;
}

interface BusinessUnit {
  matchEmployeeIds?: string[];  // 显式单元成员（按部门/条线）
  matchZone?: string;           // 或按办公区 zone 匹配
  unitLabel: string;            // reason 中的业务域说明
  humanStaff: { name: string; reason: string }[];
  extras?: ChannelMember[];     // 临时成员（专家随工单进出）
}

const BUSINESS_UNITS: Record<string, BusinessUnit> = {
  'ch-q3': {
    matchZone: 'business',
    unitLabel: 'ch-q3 业务域（业务办公区 · Q3 增长战役）',
    humanStaff: [{ name: '小周', reason: '一线真人销售 · Q3 战役执行成员' }],
  },
  'ch-mkt': {
    matchEmployeeIds: ['emp-ops', 'emp-design'],
    unitLabel: 'ch-mkt 业务域（市场/内容条线）',
    humanStaff: [{ name: '小唐', reason: '一线真人市场执行 · 投放对接' }],
  },
  'ch-delivery': {
    matchEmployeeIds: ['emp-cs', 'emp-dev'],
    unitLabel: 'ch-delivery 业务域（客户交付条线）',
    humanStaff: [{ name: '小陈', reason: '一线真人交付项目经理' }],
    extras: [{ name: '林知远·专家', kind: 'expert', reason: '工单 #ET-3 临时入群 · 关单即退（两阶段上下文切片）' }],
  },
  'ch-618': {
    matchEmployeeIds: ['emp-ops', 'emp-data'],
    unitLabel: 'ch-618 业务域（618 复盘专项）',
    humanStaff: [{ name: '小周', reason: '一线真人销售 · 618 战役参与者' }],
  },
};

const bossMember = (reason = '全群合规可见 · 免打扰', muted = true): ChannelMember => ({
  name: HUMAN_BOSS.name, kind: 'boss', reason, muted,
});

function deriveBusinessMembers(channelId: string): ChannelMember[] {
  const unit = BUSINESS_UNITS[channelId];
  if (!unit) return [];
  const members: ChannelMember[] = [];
  const seen = new Set<string>();
  const push = (m: ChannelMember) => {
    if (!seen.has(m.name)) { seen.add(m.name); members.push(m); }
  };

  const unitEmployees = employees.filter((e) =>
    unit.matchEmployeeIds ? unit.matchEmployeeIds.includes(e.id) : e.zone === unit.matchZone,
  );
  unitEmployees.forEach((e) => push({ name: e.name, kind: 'agent', reason: `${unit.unitLabel} 数字员工` }));
  unit.humanStaff.forEach((h) => push({ name: h.name, kind: 'human-staff', reason: h.reason }));

  // 沿 managesEmployeeIds 反查汇报线：单元数字员工 → 直属上级分身 + 真人高管（可见性沿汇报线向上，不向下、不横向）
  unitEmployees.forEach((e) => {
    executiveTwins
      .filter((t) => t.managesEmployeeIds.includes(e.id))
      .forEach((t) => {
        push({ name: t.name, kind: 'exec-twin', reason: `${e.name} 的直属上级分身（managesEmployeeIds 反查）` });
        push({ name: `${t.humanName}（${t.humanTitle}）`, kind: 'human-exec', reason: `沿汇报线上级 · ${t.name} 对应真人高管` });
      });
  });

  (unit.extras ?? []).forEach(push);
  push(bossMember());
  return members;
}

export function deriveChannelMembers(channelId: string): ChannelMember[] {
  switch (channelId) {
    case 'ch-boss':
      return [
        { name: HUMAN_BOSS.name, kind: 'boss', reason: '责任链起点 · 企业意图入口' },
        { name: BOSS_TWIN.name, kind: 'boss-twin', reason: '老板意图转译 · 责任链第一跳' },
      ];
    case 'ch-exec':
      return [
        ...executiveTwins.map((t): ChannelMember => ({
          name: t.name, kind: 'exec-twin', reason: 'A2A 跨部门协调主体 · 高管分身',
        })),
        ...executiveTwins.map((t): ChannelMember => ({
          name: `${t.humanName}（${t.humanTitle}）`, kind: 'human-exec', reason: '列席观察 · 仅 confirm/仲裁两类写动作',
        })),
        bossMember(),
      ];
    case 'ch-risk':
      return [
        { name: 'Exec-Guardian', kind: 'guardian', reason: '治理策略 · 风险阻断与通报发起方' },
        bossMember('有审批权者 · 风险事件主动触达（免打扰例外）', false),
        { name: '万·CFO 分身', kind: 'exec-twin', reason: '资金/合规风险相关高管分身' },
        { name: '万 CFO（财务总监）', kind: 'human-exec', reason: '有审批权者 · 四眼原则会签' },
        { name: '戟·安全官', kind: 'agent', reason: '安全巡检数字员工 · 风险上报方' },
        { name: '审计员', kind: 'human-staff', reason: '治理策略 · 审计只读' },
      ];
    case 'ch-hermes':
      return [
        { name: 'Hermes·进化', kind: 'hermes', reason: '平台通告唯一发布方（单向）' },
        bossMember('全员只读接收 · 免打扰'),
        ...executiveTwins.map((t): ChannelMember => ({
          name: `${t.humanName}（${t.humanTitle}）`, kind: 'human-exec', reason: '全员只读接收（平台规则）',
        })),
        ...employees.map((e): ChannelMember => ({
          name: e.name, kind: 'agent', reason: '全员只读接收（平台规则）',
        })),
        { name: '小周', kind: 'human-staff', reason: '全员只读接收（平台规则）' },
      ];
    case 'ch-twin-sales':
      return [
        { name: '吴帆·销售VP', kind: 'human-exec', reason: '通道主人 · 确认/打回分身预拆解' },
        { name: '吴·销售 VP 分身', kind: 'exec-twin', reason: '销售 VP 分身 · 预拆解并代表真人参与 A2A' },
        bossMember('合规可见 · 免打扰（不参与对话）'),
      ];
    default:
      return deriveBusinessMembers(channelId);
  }
}

export const feishuMessages: FeishuMessage[] = [
  {
    id: 'm1', ts: '14:30', channel: 'ch-q3',
    sender: '林·决策官', senderRole: 'manager', avatar: '林',
    content: '@雪 @岚 @砚 Q3 我们要把华东大客户增长拉到 30%，先各自给草案。',
    type: 'mention',
    mentions: ['雪·销售官', '岚·运营官', '砚·财务官'],
  },
  {
    id: 'm2', ts: '14:31', channel: 'ch-q3',
    sender: '雪·销售官', senderRole: 'worker', avatar: '雪',
    content: '草案已起：基于 CRM 数据，建议针对 23 家大客户做 BD 邮件 + 高管拜访。报价单已自动生成，等待外发审批。',
    type: 'task',
    attachments: [{ name: 'Q3-BD-清单.xlsx', kind: 'excel' }, { name: '报价单模板 v3.docx', kind: 'doc' }],
  },
  {
    id: 'm3', ts: '14:32', channel: 'ch-q3',
    sender: '岚·运营官', senderRole: 'worker', avatar: '岚',
    content: '投放调整草案：减少抖音泛流量 30%，增配视频号 + LinkedIn B2B 定向。预估 ROI 1.4 → 1.9。',
    type: 'msg',
  },
  {
    id: 'm4', ts: '14:33', channel: 'ch-q3',
    sender: 'Exec-Guardian', senderRole: 'guardian', avatar: '盾',
    content: '⚠ 阻断 · 砚·财务官 提交单笔 138w 资金调拨。命中四眼原则规则。等待昆仑审批。',
    type: 'alert',
  },
  {
    id: 'm5', ts: '14:34', channel: 'ch-q3',
    sender: '昆仑（您）', senderRole: 'human', avatar: '昆',
    content: '让财务在公开核算系统里走，不要走 Agent 直接调拨。改成生成审批单，我在飞书上批。',
    type: 'msg',
  },
  {
    id: 'm6', ts: '14:35', channel: 'ch-q3',
    sender: 'Hermes', senderRole: 'hermes', avatar: '⟁',
    content: '已记录 bad case · 财务自动调拨触发风控。SOP「资金调拨」将进化：所有 >50w 必须生成审批单。沙箱评测中，预计 11 分钟后送审。',
    type: 'evolution',
  },
  {
    id: 'm7', ts: '14:36', channel: 'ch-q3',
    sender: '林·决策官', senderRole: 'manager', avatar: '林',
    content: '议程到 3/3。把所有人拉进会议室，10 分钟后总结发版。',
    type: 'msg',
  },
  {
    id: 'm8', ts: '14:37', channel: 'ch-q3',
    sender: 'Manager·会议主持', senderRole: 'manager', avatar: '会',
    content: '已拉群入会：销售、运营、财务、研发、文档。会议室「青莲」已开启，实时纪要启动。',
    type: 'task',
  },
];

export const hermesNotices: FeishuMessage[] = [
  {
    id: 'h1', ts: '14:36', channel: 'ch-hermes',
    sender: 'Hermes·进化', senderRole: 'hermes', avatar: '⟁',
    content: 'SOP「资金调拨」v3 → v4 沙箱评测中（4/5 用例通过），预计 11 分钟后送审。',
    type: 'evolution',
  },
  {
    id: 'h2', ts: '14:12', channel: 'ch-hermes',
    sender: 'Hermes·进化', senderRole: 'hermes', avatar: '⟁',
    content: 'Skill「BD 邮件 v3.2」上线后回收率 +18.4%，已自动推送到员工市场。',
    type: 'evolution',
  },
  {
    id: 'h3', ts: '13:50', channel: 'ch-hermes',
    sender: 'Hermes·进化', senderRole: 'hermes', avatar: '⟁',
    content: '检测到 5 例「合同审阅漏标」bad case，已生成 1 条改进版规则待审。',
    type: 'evolution',
  },
];

// === v5.3 collab extension ===
export const collabExtraMessages: FeishuMessage[] = [
  {
    id: 'm9', ts: '14:38', channel: 'ch-q3',
    sender: '律·法务官', senderRole: 'worker', avatar: '律',
    content: '@昆仑 鲲鹏制造主合同 v4 风险清单已起草，含 3 条高危条款，等待您签字。',
    type: 'task',
    mentions: ['昆仑'],
    attachments: [
      { name: '合同审阅意见 v4.docx', kind: 'doc' },
      { name: '风险清单 v4.xlsx', kind: 'excel' },
    ],
  },
  {
    id: 'm10', ts: '14:39', channel: 'ch-q3',
    sender: 'Exec-Guardian', senderRole: 'guardian', avatar: '盾',
    content: '⚠ 高危 · 律·法务官 尝试外发含排他条款的主合同 v4 原文。已阻断，等待昆仑决策。',
    type: 'alert',
  },
  {
    id: 'm11', ts: '14:40', channel: 'ch-q3',
    sender: '炅·研发官', senderRole: 'worker', avatar: '炅',
    content: '智能合同 v2.1 接口已对齐，调用 [MCP] doc.diff 完成模板比对，等待 PM 评审。',
    type: 'msg',
    attachments: [{ name: 'api-contract v2.1.md', kind: 'doc' }],
  },
  {
    id: 'm12', ts: '14:41', channel: 'ch-q3',
    sender: '衍·产品经理', senderRole: 'worker', avatar: '衍',
    content: '@炅 @染 @律 评审纪要模板已建。15:00 «青莲» 会议室准时见，三方齐到。',
    type: 'mention',
    mentions: ['炅·研发官', '染·设计师', '律·法务官'],
  },
  {
    id: 'm13', ts: '14:42', channel: 'ch-q3',
    sender: 'Hermes', senderRole: 'hermes', avatar: '⟁',
    content: '新 bad case 入库：合同外发未脱敏。SOP「合同外发」v2 → v3 沙箱评测中（3/5 通过），预计 8 分钟后送审。',
    type: 'evolution',
  },
  // v8 · 9 种消息类型示范（按 brief 第六条）
  {
    id: 'b1', ts: '09:02', channel: 'ch-boss',
    sender: '昆仑（您）', senderRole: 'human', avatar: '昆',
    content: 'Q3 我希望华东大客户增长拉到 30%，预算 200w 内可调，3 天后给我执行计划。',
    type: 'msg',
  },
  {
    id: 'b2', ts: '09:02', channel: 'ch-boss',
    sender: '昆仑·数字分身', senderRole: 'manager', avatar: '分',
    content: '已转译为企业意图：① Q3 华东客户增长目标 30%；② 预算上限 200w；③ 3 个工作日内提交执行计划。',
    type: 'translate',
  },
  {
    id: 'b3', ts: '09:04', channel: 'ch-exec',
    sender: '吴·销售 VP 分身', senderRole: 'manager', avatar: '吴',
    content: '已拆解为 3 项部门动作：客户分层（销售） / BD 节奏（销售+市场） / 关键决策（财务复核）。',
    type: 'decompose',
  },
  {
    id: 'b4', ts: '09:06', channel: 'ch-exec',
    sender: '吴 VP（真人）', senderRole: 'human', avatar: '人',
    content: '同意分派。客户分层标准用 ARR + 决策人画像 + 行业，今晚要出。',
    type: 'confirm',
  },
  {
    id: 'b5', ts: '09:12', channel: 'ch-q3',
    sender: '雪·销售官', senderRole: 'worker', avatar: '雪',
    content: '正在拉取 CRM Top-A 23 家客户互动史，预计 6 分钟完成。',
    type: 'task',
  },
  {
    id: 'b6', ts: '09:14', channel: 'ch-q3',
    sender: '雪·销售官', senderRole: 'worker', avatar: '雪',
    content: 'crm.salesforce.list(tier="A", region="华东") → 23 客户',
    type: 'tool_call',
    toolCall: { tool: 'crm.salesforce.list', args: 'tier="A", region="华东"' },
  } as any,
  {
    id: 'b7', ts: '09:24', channel: 'ch-q3',
    sender: '雪·销售官', senderRole: 'worker', avatar: '雪',
    content: '产出物：Q3 BD 邮件清单.xlsx · 23 条 · sha256:0x4af2',
    type: 'deliverable',
    attachments: [{ name: 'Q3-BD-清单.xlsx', kind: 'excel' }],
  },
  {
    id: 'b8', ts: '09:25', channel: 'ch-q3',
    sender: '系统审计', senderRole: 'guardian', avatar: '盾',
    content: '证据归档 → audit ledger 0xb44a (BD 清单 / hash:0x4af2 / 雪·销售官 / 09:24:08)',
    type: 'evidence',
  },
  {
    id: 'b9', ts: '09:27', channel: 'ch-q3',
    sender: '昆仑（您）', senderRole: 'human', avatar: '昆',
    content: '@雪 通过外发清单需要法务复核。',
    type: 'approval',
    mentions: ['雪·销售官'],
  },
  // ── v9 · ch-mkt 市场内容群 seed ──
  {
    id: 'mkt1', ts: '10:05', channel: 'ch-mkt',
    sender: '岚·运营官', senderRole: 'worker', avatar: '岚',
    content: '视频号 B2B 定向素材脚本 x5 已排产，今日 18:00 前出首版。@染 封面稿同步跟上。',
    type: 'task',
    mentions: ['染·设计师'],
  },
  {
    id: 'mkt2', ts: '10:22', channel: 'ch-mkt',
    sender: '染·设计师', senderRole: 'worker', avatar: '染',
    content: '封面稿 3 版已出：工业风 / 数据流 / 客户证言。Figma 链接已同步，投票选一版主推。',
    type: 'msg',
    attachments: [{ name: '视频号封面 3 版.fig', kind: 'doc' }],
  },
  {
    id: 'mkt3', ts: '11:40', channel: 'ch-mkt',
    sender: '岚·运营官', senderRole: 'worker', avatar: '岚',
    content: '产出物：LinkedIn 行业白皮书推广文案 v2 · 中英双语 · sha256:0x7c19',
    type: 'deliverable',
    attachments: [{ name: 'LinkedIn 推广文案 v2.docx', kind: 'doc' }],
  },
  {
    id: 'mkt4', ts: '11:42', channel: 'ch-mkt',
    sender: 'Hermes', senderRole: 'hermes', avatar: '⟁',
    content: 'Skill「B2B 内容脚本 v1.4」近 7 日 CTR +11.2%，已推荐给市场条线全部 Agent。',
    type: 'evolution',
  },
  // ── v9 · ch-delivery 客户交付群 seed ──
  {
    id: 'dlv1', ts: '10:48', channel: 'ch-delivery',
    sender: '苓·客服官', senderRole: 'worker', avatar: '苓',
    content: '云海制药 POC 环境已交付验收，SLA 响应 < 200ms 达标。验收单等待客户回签。',
    type: 'task',
  },
  {
    id: 'dlv2', ts: '11:15', channel: 'ch-delivery',
    sender: '炅·研发官', senderRole: 'worker', avatar: '炅',
    content: '产出物：鲲鹏制造部署手册 v2.3 · 含回滚预案 · sha256:0x91be',
    type: 'deliverable',
    attachments: [{ name: '部署手册 v2.3.pdf', kind: 'doc' }],
  },
  {
    id: 'dlv3', ts: '11:16', channel: 'ch-delivery',
    sender: '系统审计', senderRole: 'guardian', avatar: '盾',
    content: '证据归档 → audit ledger 0xd102 (部署手册 v2.3 / hash:0x91be / 炅·研发官 / 11:15:44)',
    type: 'evidence',
  },
  {
    id: 'dlv4', ts: '13:02', channel: 'ch-delivery',
    sender: '林知远·专家', senderRole: 'expert', avatar: '林',
    content: '【专家处置通报】工单 #ET-3 客户数据迁移卡点已解除：根因是增量同步游标错位，已给出修复 SOP 并回写知识库，建议交付前加一道游标校验。',
    type: 'msg',
  },
  // ── v9 · ch-risk 风险审计群 seed（风险专用通道） ──
  {
    id: 'rsk1', ts: '14:33', channel: 'ch-risk',
    sender: 'Exec-Guardian', senderRole: 'guardian', avatar: '盾',
    content: '⚠ 阻断 · 砚·财务官 提交单笔 138w 资金调拨（跨主体 / 受款方：鲲鹏物流）。命中四眼原则规则 v7：单笔 > 50w 必须人工审批。已冻结指令 #FN-0623-08，等待昆仑决策。',
    type: 'alert',
  },
  {
    id: 'rsk2', ts: '14:34', channel: 'ch-risk',
    sender: 'Exec-Guardian', senderRole: 'guardian', avatar: '盾',
    content: '⚠ 高危 · 律·法务官 尝试外发含排他条款（§7.3）的主合同 v4 原文。已阻断并留存快照，等待人工决策。',
    type: 'alert',
  },
  {
    id: 'rsk3', ts: '14:36', channel: 'ch-risk',
    sender: '昆仑（您）', senderRole: 'human', avatar: '昆',
    content: '【决策记录】#FN-0623-08 调拨：拒绝 Agent 直接调拨。改为生成审批单走人工四眼流程，我在飞书上批。责任人：砚·财务官；复核：Exec-Guardian。',
    type: 'approval',
  },
  {
    id: 'rsk4', ts: '14:37', channel: 'ch-risk',
    sender: '系统审计', senderRole: 'guardian', avatar: '盾',
    content: '证据归档 → audit ledger 0x9c01 (阻断记录 + 决策记录 / #FN-0623-08 / 14:33-14:36 全链路已上链)',
    type: 'evidence',
  },
  {
    id: 'rsk5', ts: '14:45', channel: 'ch-risk',
    sender: 'Hermes', senderRole: 'hermes', avatar: '⟁',
    content: '风控规则进化通告：SOP「资金调拨」v3 → v4 沙箱评测通过（5/5 用例）。新增规则：所有 >50w 调拨自动生成审批单，禁止 Agent 直连出账通道。已送审等待昆仑签发。',
    type: 'evolution',
  },
  // ── v2 · ch-twin-sales 分身 1v1 管理通道 seed（decompose 预拆解 → confirm 确认 → 打回 → 修正）──
  {
    id: 'tw1', ts: '08:52', channel: 'ch-twin-sales',
    sender: '吴·销售 VP 分身', senderRole: 'manager', avatar: '吴',
    content: '【预拆解】Q3 华东 30% 增长目标 → 3 项动作：① Top-A 23 家客户分层（今晚出）② BD 邮件节奏改为每周 2 次触达 ③ 大单折扣权限上收至 8%。请确认或打回，确认后我将带入分身会议室 A2A 协调。',
    type: 'decompose',
  },
  {
    id: 'tw2', ts: '08:58', channel: 'ch-twin-sales',
    sender: '吴帆·销售VP', senderRole: 'human', avatar: '吴',
    content: '确认 ①②。分层标准补充：ARR + 决策人画像 + 行业，今晚要看到初版。',
    type: 'confirm',
  },
  {
    id: 'tw3', ts: '08:59', channel: 'ch-twin-sales',
    sender: '吴帆·销售VP', senderRole: 'human', avatar: '吴',
    content: '打回 ③：折扣权限上收会拖慢一线签单速度。改成「≤ 8% 一线自主，> 8% 升级到我审批」，重新拆解后再报。',
    type: 'confirm',
  },
  {
    id: 'tw4', ts: '09:01', channel: 'ch-twin-sales',
    sender: '吴·销售 VP 分身', senderRole: 'manager', avatar: '吴',
    content: '【预拆解 v2】③ 已按打回意见修正：折扣 ≤ 8% 一线自主，> 8% 升级吴帆审批。权限变更已同步 雪·销售官 配置，①②③ 全部就绪，即将在会议室发起 A2A 分派。',
    type: 'decompose',
  },
];
