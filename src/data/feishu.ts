import type { FeishuMessage } from '../lib/types';

export const channels = [
  { id: 'ch-q3', name: '#Q3增长策略', unread: 3, members: 6, type: 'project' },
  { id: 'ch-618', name: '#618复盘', unread: 1, members: 4, type: 'project' },
  { id: 'ch-incident', name: '#财务·风险阻断', unread: 2, members: 3, type: 'incident' },
  { id: 'ch-hermes', name: '#Hermes·进化通告', unread: 5, members: 9, type: 'system' },
  { id: 'ch-recruit', name: '#高级前端招聘', unread: 0, members: 3, type: 'project' },
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
