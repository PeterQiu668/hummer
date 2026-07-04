export type KGNodeType = '客户' | '项目' | '合同' | '员工' | 'SOP' | '决策' | '部门';

export interface KGNode {
  id: string;
  label: string;
  type: KGNodeType;
  props: Record<string, string>;
}

export interface KGEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

// Restrained color encoding (v5 palette, not neon)
export const kgTypeColors: Record<KGNodeType, string> = {
  客户: '#3B82F6',
  项目: '#A855F7',
  合同: '#14B8A6',
  员工: '#F59E0B',
  SOP: '#10B981',
  决策: '#EF4444',
  部门: '#64748B',
};

export const kgNodes: KGNode[] = [
  // 客户 5
  { id: 'cu-1', label: '鲲鹏制造', type: '客户', props: { ARR: '¥8.6M', 行业: '智能制造', 等级: 'Strategic' } },
  { id: 'cu-2', label: '青松集团', type: '客户', props: { ARR: '¥4.2M', 行业: '医疗', 等级: 'Key' } },
  { id: 'cu-3', label: '远洋物流', type: '客户', props: { ARR: '¥2.1M', 行业: '物流', 等级: 'Growth' } },
  { id: 'cu-4', label: '蜂巢科技', type: '客户', props: { ARR: '¥1.8M', 行业: 'SaaS', 等级: 'Growth' } },
  { id: 'cu-5', label: '北辰金融', type: '客户', props: { ARR: '¥6.3M', 行业: '金融', 等级: 'Strategic' } },
  // 项目 4
  { id: 'pj-1', label: '鲲鹏数字化升级', type: '项目', props: { 阶段: '交付中', 金额: '¥3.2M', PM: '林·决策官' } },
  { id: 'pj-2', label: '青松 EHR 集成', type: '项目', props: { 阶段: 'POC', 金额: '¥0.9M', PM: '苓·客服官' } },
  { id: 'pj-3', label: '北辰风控 Agent', type: '项目', props: { 阶段: '交付完成', 金额: '¥2.4M', PM: '砚·财务官' } },
  { id: 'pj-4', label: '蜂巢增长引擎', type: '项目', props: { 阶段: '商机', 金额: '¥1.1M', PM: '雪·销售官' } },
  // 合同 4
  { id: 'co-1', label: '鲲鹏 SaaS-2026', type: '合同', props: { 类型: '订阅', 期: '36 个月', 金额: '¥8.6M' } },
  { id: 'co-2', label: '青松 POC 协议', type: '合同', props: { 类型: 'POC', 期: '3 个月', 金额: '¥0.9M' } },
  { id: 'co-3', label: '北辰风控合作', type: '合同', props: { 类型: '订阅', 期: '24 个月', 金额: '¥6.3M' } },
  { id: 'co-4', label: '蜂巢 MSA', type: '合同', props: { 类型: 'MSA', 期: '12 个月', 金额: '¥1.8M' } },
  // 员工 5
  { id: 'em-1', label: '林·决策官', type: '员工', props: { 模型: 'Opus 4.7', 部门: '决策中心' } },
  { id: 'em-2', label: '雪·销售官', type: '员工', props: { 模型: 'Sonnet 4.6', 部门: '业务办公' } },
  { id: 'em-3', label: '砚·财务官', type: '员工', props: { 模型: 'Opus 4.7', 部门: '业务办公' } },
  { id: 'em-4', label: '律·法务官', type: '员工', props: { 模型: 'Opus 4.7', 部门: '业务办公' } },
  { id: 'em-5', label: '苓·客服官', type: '员工', props: { 模型: 'Haiku 4.5', 部门: '行政支持' } },
  // SOP 3
  { id: 'sop-1', label: 'BD 邮件 v3.2', type: 'SOP', props: { 版本: 'v3.2', 签名: '✓', 招聘: '1284' } },
  { id: 'sop-2', label: '合同审阅 v2.7', type: 'SOP', props: { 版本: 'v2.7', 签名: '✓', 招聘: '712' } },
  { id: 'sop-3', label: '资金调拨 v4', type: 'SOP', props: { 版本: 'v4', 签名: 'sandbox', 招聘: '0' } },
  // 决策 2
  { id: 'de-1', label: 'Q3 客户回访预算', type: '决策', props: { 状态: '已批准', 审批: '昆仑', 金额: '¥120w' } },
  { id: 'de-2', label: '财务 138w 调拨', type: '决策', props: { 状态: '已阻断', 审批: 'Guardian', 风险: 'HIGH' } },
  // 部门 2
  { id: 'dp-1', label: '业务办公区', type: '部门', props: { 人数: '5', 模型: 'Mixed' } },
  { id: 'dp-2', label: '决策中心', type: '部门', props: { 人数: '1', 模型: 'Opus 4.7' } },
];

export const kgEdges: KGEdge[] = [
  // 客户-项目
  { id: 'e-1', source: 'cu-1', target: 'pj-1', label: '发起' },
  { id: 'e-2', source: 'cu-2', target: 'pj-2', label: '发起' },
  { id: 'e-3', source: 'cu-5', target: 'pj-3', label: '发起' },
  { id: 'e-4', source: 'cu-4', target: 'pj-4', label: '发起' },
  // 项目-合同
  { id: 'e-5', source: 'pj-1', target: 'co-1', label: '签订' },
  { id: 'e-6', source: 'pj-2', target: 'co-2', label: '签订' },
  { id: 'e-7', source: 'pj-3', target: 'co-3', label: '签订' },
  { id: 'e-8', source: 'pj-4', target: 'co-4', label: '签订' },
  // 客户-合同
  { id: 'e-9', source: 'cu-1', target: 'co-1', label: '签约方' },
  { id: 'e-10', source: 'cu-2', target: 'co-2', label: '签约方' },
  { id: 'e-11', source: 'cu-5', target: 'co-3', label: '签约方' },
  { id: 'e-12', source: 'cu-4', target: 'co-4', label: '签约方' },
  // 员工-项目（PM/参与）
  { id: 'e-13', source: 'em-1', target: 'pj-1', label: 'PM' },
  { id: 'e-14', source: 'em-5', target: 'pj-2', label: '参与' },
  { id: 'e-15', source: 'em-3', target: 'pj-3', label: 'PM' },
  { id: 'e-16', source: 'em-2', target: 'pj-4', label: 'PM' },
  { id: 'e-17', source: 'em-2', target: 'pj-1', label: '参与' },
  { id: 'e-18', source: 'em-4', target: 'pj-1', label: '法务' },
  // 员工-SOP（持有）
  { id: 'e-19', source: 'em-2', target: 'sop-1', label: '使用' },
  { id: 'e-20', source: 'em-4', target: 'sop-2', label: '使用' },
  { id: 'e-21', source: 'em-3', target: 'sop-3', label: '使用' },
  // 合同-SOP（审阅）
  { id: 'e-22', source: 'co-1', target: 'sop-2', label: '审阅' },
  { id: 'e-23', source: 'co-3', target: 'sop-2', label: '审阅' },
  // 决策-员工 / 决策-项目
  { id: 'e-24', source: 'de-1', target: 'em-1', label: '发起人' },
  { id: 'e-25', source: 'de-1', target: 'pj-1', label: '关联' },
  { id: 'e-26', source: 'de-2', target: 'em-3', label: '发起人' },
  { id: 'e-27', source: 'de-2', target: 'sop-3', label: '触发' },
  // 部门-员工
  { id: 'e-28', source: 'dp-1', target: 'em-2', label: '隶属' },
  { id: 'e-29', source: 'dp-1', target: 'em-3', label: '隶属' },
  { id: 'e-30', source: 'dp-1', target: 'em-4', label: '隶属' },
  { id: 'e-31', source: 'dp-2', target: 'em-1', label: '隶属' },
  // 跨域加密
  { id: 'e-32', source: 'cu-1', target: 'em-2', label: '对接' },
  { id: 'e-33', source: 'cu-2', target: 'em-5', label: '对接' },
  { id: 'e-34', source: 'cu-5', target: 'em-3', label: '对接' },
  { id: 'e-35', source: 'cu-4', target: 'em-2', label: '对接' },
  // 项目-员工额外
  { id: 'e-36', source: 'em-1', target: 'pj-3', label: '审批' },
  { id: 'e-37', source: 'em-4', target: 'co-1', label: '审阅' },
  { id: 'e-38', source: 'em-4', target: 'co-3', label: '审阅' },
  // SOP 关联决策
  { id: 'e-39', source: 'sop-3', target: 'de-2', label: '阻断' },
  { id: 'e-40', source: 'sop-1', target: 'cu-4', label: '触达' },
];
