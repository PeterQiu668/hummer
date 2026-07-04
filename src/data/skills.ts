/**
 * 技能库 — Skill marketplace 数据
 * 每个 Skill: id / name / category / desc / version / signed / hires / successRate / applicableRoles / lastUsed
 */

export type SkillCategory =
  | '销售增长' | '内容创作' | '数据分析' | '客户服务'
  | '知识管理' | '审批自动化' | '风控合规' | '研发工程';

export interface SkillItem {
  id: string;
  name: string;
  category: SkillCategory;
  desc: string;
  version: string;
  signed: boolean;
  signer?: string;
  callCount: number;
  successRate: number;     // 0-1
  applicable: string[];    // 适用员工 role names
  lastUsed?: string;
  permissionScope: string[];
  inputSchema: { name: string; type: string; required: boolean }[];
  outputSchema: { name: string; type: string }[];
  recentCalls: { ts: string; caller: string; result: 'ok' | 'warn' | 'fail'; note: string }[];
}

export const skillItems: SkillItem[] = [
  {
    id: 'sk-bd-email-v32', name: 'BD 邮件 v3.2', category: '销售增长',
    desc: '基于客户互动史前 3 件事生成定制 BD 邮件，回复率从 8.2% → 26.6%。',
    version: 'v3.2', signed: true, signer: '陈鹏 / sha256:8f3a…d471',
    callCount: 1284, successRate: 0.93, applicable: ['销售 Worker', '客户成功'],
    lastUsed: '14:35',
    permissionScope: ['crm.salesforce:read', 'mail.exchange:send', 'kg.enterprise:read'],
    inputSchema: [
      { name: 'contactId', type: 'string', required: true },
      { name: 'tone', type: 'enum(formal|casual)', required: false },
      { name: 'attachments', type: 'string[]', required: false },
    ],
    outputSchema: [
      { name: 'subject', type: 'string' },
      { name: 'body', type: 'markdown' },
      { name: 'predictedReplyRate', type: 'number' },
    ],
    recentCalls: [
      { ts: '14:35:12', caller: '雪·销售官', result: 'ok',   note: '鲲鹏制造 · 已起草' },
      { ts: '14:30:02', caller: '雪·销售官', result: 'ok',   note: '北辰金融 · 已发出' },
      { ts: '14:18:44', caller: '雪·销售官', result: 'ok',   note: '云海制药 · 已起草' },
    ],
  },
  {
    id: 'sk-doc-summary', name: '会议纪要 v2.2', category: '知识管理',
    desc: '从飞书会议录音 + 屏幕共享生成结构化纪要 + 行动项分派。',
    version: 'v2.2', signed: true, signer: '言溪 / sha256:b22a…0901',
    callCount: 928, successRate: 0.97, applicable: ['文档 Worker', '会议主持'],
    lastUsed: '13:42',
    permissionScope: ['feishu.docs:write', 'feishu.calendar:read'],
    inputSchema: [
      { name: 'meetingId', type: 'string', required: true },
      { name: 'language', type: 'enum(zh|en)', required: false },
    ],
    outputSchema: [
      { name: 'summary', type: 'markdown' },
      { name: 'actionItems', type: 'object[]' },
    ],
    recentCalls: [
      { ts: '13:42:00', caller: '芸·文档官', result: 'ok', note: 'Q3 增长策略评审纪要' },
    ],
  },
  {
    id: 'sk-contract-review', name: '合同审阅 v2.7', category: '风控合规',
    desc: '从合同 PDF 抽取条款，匹配 KG 中风险模式，输出风险清单 + 修改建议。',
    version: 'v2.7', signed: true, signer: '黄律 / sha256:9b67…c812',
    callCount: 712, successRate: 0.89, applicable: ['法务 Worker'],
    lastUsed: '11:02',
    permissionScope: ['kg.enterprise:read', 'feishu.docs:write', 'pdf.parse:exec'],
    inputSchema: [
      { name: 'contractId', type: 'string', required: true },
      { name: 'precedents', type: 'string[]', required: false },
    ],
    outputSchema: [
      { name: 'riskList', type: 'object[]' },
      { name: 'recommendedRevisions', type: 'object[]' },
    ],
    recentCalls: [
      { ts: '11:02:01', caller: '律·法务官', result: 'ok',   note: '鲲鹏 SaaS · 9/12 条款命中' },
      { ts: '10:35:09', caller: '律·法务官', result: 'warn', note: '召回率 0.84，待 KG 扩展' },
    ],
  },
  {
    id: 'sk-bi-report', name: '618 复盘报告 v4.1', category: '数据分析',
    desc: '从数仓拉 GMV / ROI / 跨渠道归因，自动出可视化 + 解读。',
    version: 'v4.1', signed: true, signer: '吴琳 / sha256:2a14…fe09',
    callCount: 1782, successRate: 0.95, applicable: ['运营 Worker', '数据 Worker'],
    lastUsed: '14:21',
    permissionScope: ['bi.warehouse:query', 'feishu.docs:write'],
    inputSchema: [
      { name: 'campaignId', type: 'string', required: true },
      { name: 'channels', type: 'string[]', required: true },
    ],
    outputSchema: [
      { name: 'report', type: 'markdown' },
      { name: 'charts', type: 'svg[]' },
    ],
    recentCalls: [
      { ts: '14:21:09', caller: '岚·运营官', result: 'ok', note: 'gmv_618 复盘' },
    ],
  },
  {
    id: 'sk-mood-detect', name: '客服情绪识别 v3', category: '客户服务',
    desc: '识别中英文混合场景的客户情绪，自动升级到人工。',
    version: 'v3.0', signed: true, signer: '柳菲 / sha256:f311…d022',
    callCount: 95200, successRate: 0.91, applicable: ['客服 Worker'],
    lastUsed: '14:40',
    permissionScope: ['ticket:read', 'chat:read'],
    inputSchema: [{ name: 'text', type: 'string', required: true }],
    outputSchema: [
      { name: 'mood', type: 'enum(calm|frustrated|angry|urgent)' },
      { name: 'recommendedAction', type: 'string' },
    ],
    recentCalls: [
      { ts: '14:40:11', caller: '苓·客服官', result: 'ok', note: '工单 #2841 升级到人工' },
    ],
  },
  {
    id: 'sk-fund-transfer', name: '资金调拨 v3 → v4 (沙箱中)', category: '审批自动化',
    desc: 'Hermes 自动进化版：> 50w 强制生成飞书审批单。',
    version: 'v4-sandbox', signed: false,
    callCount: 0, successRate: 1.0, applicable: ['财务 Worker'],
    permissionScope: ['erp.kingdee:write', 'feishu.approval:create'],
    inputSchema: [
      { name: 'amount', type: 'number', required: true },
      { name: 'counterparty', type: 'string', required: true },
    ],
    outputSchema: [{ name: 'approvalUrl', type: 'string' }],
    recentCalls: [
      { ts: '09:00:00', caller: 'sandbox', result: 'ok', note: 'A/B +14.8% 阻断率' },
    ],
  },
  {
    id: 'sk-private-sop', name: '私域 SOP v2', category: '销售增长',
    desc: '微信私域月触达 5w+，从加好友 → 朋友圈 → 1v1 SOP 全流程。',
    version: 'v2.0', signed: true, signer: '李婷 / sha256:c0e2…a51d',
    callCount: 942, successRate: 0.86, applicable: ['销售 Worker', '运营 Worker'],
    permissionScope: ['wechat:read', 'wechat:write'],
    inputSchema: [{ name: 'campaignId', type: 'string', required: true }],
    outputSchema: [
      { name: 'tasks', type: 'object[]' },
      { name: 'schedule', type: 'object[]' },
    ],
    recentCalls: [
      { ts: '11:18:00', caller: '雪·销售官', result: 'ok', note: '618 私域复购 SOP' },
    ],
  },
  {
    id: 'sk-resume-screen', name: '简历筛选 v1.4', category: '审批自动化',
    desc: '从飞书招聘拉取简历，按 JD 自动评分 + 推荐面试名单。',
    version: 'v1.4', signed: true, signer: '苏娜 / sha256:e1c4…2280',
    callCount: 412, successRate: 0.88, applicable: ['HR Worker'],
    permissionScope: ['feishu.hr:read'],
    inputSchema: [
      { name: 'jdId', type: 'string', required: true },
      { name: 'topN', type: 'number', required: false },
    ],
    outputSchema: [{ name: 'rankedCandidates', type: 'object[]' }],
    recentCalls: [
      { ts: '08:00:11', caller: '荷·人事官', result: 'ok', note: '12 份简历 → 3 推荐' },
    ],
  },
  {
    id: 'sk-figma-poster', name: '海报设计 v2.0', category: '内容创作',
    desc: 'Figma + AI 一键出海报：根据品牌指南 + 营销目标生成 6 张主视觉。',
    version: 'v2.0', signed: true, signer: '安琪 / sha256:9d80…b314',
    callCount: 1124, successRate: 0.92, applicable: ['设计 Worker'],
    permissionScope: ['figma:write'],
    inputSchema: [{ name: 'campaignBrief', type: 'string', required: true }],
    outputSchema: [{ name: 'figmaUrls', type: 'string[]' }],
    recentCalls: [
      { ts: '12:11:09', caller: '染·设计师', result: 'ok', note: 'Q3 主视觉 v1.fig' },
    ],
  },
  {
    id: 'sk-api-gen', name: 'API 接口生成 v3.1', category: '研发工程',
    desc: 'OpenAPI + 单测一键出，含 dto / handler / 路由。',
    version: 'v3.1', signed: true, signer: '冯铭 / sha256:1b9a…5c44',
    callCount: 924, successRate: 0.94, applicable: ['研发 Worker'],
    permissionScope: ['gitlab.repo:write'],
    inputSchema: [
      { name: 'spec', type: 'openapi-yaml', required: true },
    ],
    outputSchema: [
      { name: 'fileDiff', type: 'patch' },
      { name: 'unitTestPlan', type: 'markdown' },
    ],
    recentCalls: [
      { ts: '14:25:30', caller: '炅·研发官', result: 'ok', note: 'fix/order-p1 worktree 创建' },
    ],
  },
];

export const skillCategories: SkillCategory[] = [
  '销售增长', '内容创作', '数据分析', '客户服务',
  '知识管理', '审批自动化', '风控合规', '研发工程',
];
