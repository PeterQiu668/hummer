import type { FeishuMessage } from '../lib/types';

// v8: 按 brief 第六条重排频道，主流核心 6 个企业群在最上；保留旧 id 以避免历史消息断链
export const channels = [
  { id: 'ch-boss',      name: '老板总控群',       unread: 2, members: 5,  type: 'boss' },
  { id: 'ch-exec',      name: '高管分身会议室',   unread: 1, members: 6,  type: 'exec' },
  { id: 'ch-q3',        name: '销售增长作战群',   unread: 3, members: 8,  type: 'project' },
  { id: 'ch-mkt',       name: '市场内容群',       unread: 0, members: 5,  type: 'project' },
  { id: 'ch-delivery',  name: '客户交付群',       unread: 1, members: 4,  type: 'project' },
  { id: 'ch-risk',      name: '风险审计群',       unread: 2, members: 4,  type: 'incident' },
  { id: 'ch-618',       name: '618 复盘',         unread: 1, members: 4,  type: 'project' },
  { id: 'ch-hermes',    name: '质量复盘通告',     unread: 5, members: 9,  type: 'system' },
];

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
];
