import type { HermesBadCase } from '../lib/types';

export const hermesBadCases: HermesBadCase[] = [
  {
    id: 'bc-1',
    title: '资金调拨触发风控',
    agent: '砚·财务官',
    cause: 'SOP 未强制生成审批单，直接调用 ERP 调拨接口',
    stage: 'sandbox',
    improvement: '改写 SOP v4：> 50w 必须生成审批单 + 飞书审批',
    delta: '阻断率 0% → 100%',
    cost: '$2.41',
  },
  {
    id: 'bc-2',
    title: 'BD 邮件被识别为模板',
    agent: '雪·销售官',
    cause: 'Prompt 中"客户问候"段落过于通用',
    stage: 'shipped',
    improvement: '改写 Skill「BD 邮件 v3.2」：引入客户互动史前 3 件事',
    delta: '回复率 8.2% → 26.6%',
    cost: '$3.18',
  },
  {
    id: 'bc-3',
    title: '合同条款漏标',
    agent: '律·法务官',
    cause: '知识图谱中「数据出境」相关条款未关联到合同模板',
    stage: 'review',
    improvement: '扩充 KG 边类型「合同-法规-行业」3 类',
    delta: '召回率 81% → 94%',
    cost: '$5.62',
  },
  {
    id: 'bc-4',
    title: '客服情绪误判',
    agent: '苓·客服官',
    cause: '中文混合英文场景下情绪分类失效',
    stage: 'optimizing',
    improvement: 'GEPA 自动补样本 220 条，重训分类器',
    delta: '准确率 78% → 91%（评测中）',
    cost: '$1.92',
  },
  {
    id: 'bc-5',
    title: '复盘报告漏指标',
    agent: '岚·运营官',
    cause: 'SOP「618 复盘」未覆盖跨渠道归因',
    stage: 'detected',
    improvement: '新增「跨渠道归因」步骤 + 强制 BI 校验',
    delta: '待评测',
    cost: '—',
  },
];

export const evolutionStats = {
  totalRuns: 184,
  shipped: 47,
  reviewing: 6,
  sandbox: 9,
  optimizing: 12,
  detected: 23,
  costToDate: '$487.20',
  avgGain: '+18.4%',
};

// ===== v5.4 deepening: reasoning traces, evolution config =====
export interface HermesTraceLine {
  ts: string;
  kind: 'reason' | 'tool' | 'observation' | 'fail';
  text: string;
}

export interface HermesTrace {
  caseId: string;
  taskName: string;
  agent: string;
  durationMs: number;
  tokens: number;
  cost: string;
  failurePoint: string;
  lines: HermesTraceLine[];
}

export const traces: HermesTrace[] = [
  {
    caseId: 'bc-1',
    taskName: '财务-138w 调拨',
    agent: '砚·财务官',
    durationMs: 4280,
    tokens: 9842,
    cost: '$2.41',
    failurePoint: 'step-6: 跳过审批单生成直接调用 ERP',
    lines: [
      { ts: '14:32:08.001', kind: 'reason', text: '收到任务: 完成 138w 调拨给鲲鹏制造 OEM 厂' },
      { ts: '14:32:08.140', kind: 'tool', text: 'erp.kingdee.queryBalance(account="主账户") → ¥3.2M' },
      { ts: '14:32:08.812', kind: 'reason', text: '余额充足, 选择调拨 SOP v3' },
      { ts: '14:32:09.020', kind: 'tool', text: 'kg.enterprise.matchCounterparty("鲲鹏 OEM") → 匹配度 0.92' },
      { ts: '14:32:09.611', kind: 'reason', text: 'SOP v3 step-5: 校验金额阈值, 50w 以下免审' },
      { ts: '14:32:09.612', kind: 'fail', text: '阈值判断错误: SOP v3 未识别 138w > 50w 的强制审批分支' },
      { ts: '14:32:10.103', kind: 'tool', text: 'erp.kingdee.transfer(amount=1380000) ← 未生成审批单' },
      { ts: '14:32:10.880', kind: 'observation', text: 'Exec-Guardian 拦截: 风控规则 #R-44 命中, 阻断' },
      { ts: '14:32:11.020', kind: 'reason', text: 'Guardian 记录 bad case, 进入 Hermes 队列' },
      { ts: '14:32:12.280', kind: 'tool', text: 'audit.ledger.append("blocked") → 入链 0x4af2..' },
    ],
  },
  {
    caseId: 'bc-2',
    taskName: 'BD 邮件 - 北辰金融',
    agent: '雪·销售官',
    durationMs: 2810,
    tokens: 4220,
    cost: '$3.18',
    failurePoint: 'step-3: 问候语过于通用, 被对方邮件网关识别为模板',
    lines: [
      { ts: '09:14:22.110', kind: 'reason', text: '从 CRM 拉取北辰金融决策人画像' },
      { ts: '09:14:22.402', kind: 'tool', text: 'crm.salesforce.getContact("赵总") → 偏好/历史 OK' },
      { ts: '09:14:23.012', kind: 'reason', text: 'BD 邮件 Skill v3.1: 模板化问候段' },
      { ts: '09:14:23.220', kind: 'fail', text: 'Skill v3.1 问候语模板未引入近期互动史' },
      { ts: '09:14:23.881', kind: 'tool', text: 'mail.exchange.send(to="zhao@beichen.com") → 已发出' },
      { ts: '09:18:01.000', kind: 'observation', text: '7 天内零回复, 反馈环 detect' },
      { ts: '09:18:02.221', kind: 'reason', text: 'Hermes 判定: 模板化问候是首要失败点' },
      { ts: '09:18:02.220', kind: 'tool', text: 'gepa.suggest("加入互动史前 3 件事") → cand v3.2' },
      { ts: '09:18:03.011', kind: 'observation', text: '沙箱评测 A/B: 回复率 8.2% → 26.6%' },
      { ts: '09:18:03.880', kind: 'tool', text: 'skill.publish("BD 邮件 v3.2") → 发布' },
    ],
  },
  {
    caseId: 'bc-3',
    taskName: '合同审阅 - 鲲鹏 SaaS',
    agent: '律·法务官',
    durationMs: 7621,
    tokens: 18420,
    cost: '$5.62',
    failurePoint: 'step-8: KG 中数据出境条款未关联到本模板',
    lines: [
      { ts: '11:02:01.011', kind: 'reason', text: '加载合同 PDF, OCR + 结构化' },
      { ts: '11:02:01.220', kind: 'tool', text: 'pdf.parse(co-1) → 38 段, 12 条款' },
      { ts: '11:02:02.110', kind: 'reason', text: '调用 KG 匹配合同条款类型' },
      { ts: '11:02:03.011', kind: 'tool', text: 'kg.enterprise.matchClause(...) → 9/12 命中' },
      { ts: '11:02:03.880', kind: 'fail', text: 'KG 边类型缺「合同-法规-行业」, 数据出境未关联' },
      { ts: '11:02:04.220', kind: 'tool', text: 'report.generate(coverage=0.75) → 草稿' },
      { ts: '11:02:05.110', kind: 'observation', text: '律师人审发现漏项, 反馈到 Hermes' },
      { ts: '11:02:06.011', kind: 'reason', text: 'Hermes: 改进对象为 KG schema 而非 prompt' },
      { ts: '11:02:06.220', kind: 'tool', text: 'kg.schema.extend(["合同-法规-行业"]) → diff 已生成' },
      { ts: '11:02:07.011', kind: 'observation', text: '回归测试: 召回率 81% → 94%' },
    ],
  },
];

export interface HermesConfig {
  evolutionFreqHours: number;
  costCapPerDay: number;
  riskThreshold: 'low' | 'medium' | 'high';
  humanReviewRequired: boolean;
}

export const evolutionConfig: HermesConfig = {
  evolutionFreqHours: 6,
  costCapPerDay: 80,
  riskThreshold: 'medium',
  humanReviewRequired: true,
};
