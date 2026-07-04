/**
 * 数字员工背后的真人专家 — 6 位固定阵容（按 brief 严格命名）
 * 不再使用 12 位占位名单，全部按用户指定。
 */

export interface Expert {
  id: string;
  name: string;
  title: string;
  avatar: string;      // 首字 fallback
  color: string;
  expertise: string;
  experienceTags: string[];
  agentCount: number;
  yearsActive: number;
}

export const experts: Expert[] = [
  {
    id: 'ex-lin',  name: '林知远', title: '组织发展专家',
    avatar: '林', color: '#7E22CE',
    expertise: '前大型集团组织效能顾问。20 年组织设计 + 文化建设 + 人才梯队',
    experienceTags: ['前大型集团组织效能顾问', '组织设计', '人才梯队', '文化建设'],
    agentCount: 6, yearsActive: 20,
  },
  {
    id: 'ex-chen', name: '陈若澜', title: '销售增长专家',
    avatar: '陈', color: '#0F70B7',
    expertise: 'B2B 增长与渠道体系专家。亲手做过 8000w 年单 + 50+ 渠道操盘',
    experienceTags: ['B2B 增长', '渠道体系', '客户分层', 'BD 邮件'],
    agentCount: 9, yearsActive: 14,
  },
  {
    id: 'ex-zhou', name: '周明衡', title: '财务合规专家',
    avatar: '周', color: '#B07706',
    expertise: '企业内控与合同风险专家。上市公司 CFO，专注税筹 + 资金安全 + 内审',
    experienceTags: ['企业内控', '合同风险', '上市 CFO', '税筹'],
    agentCount: 7, yearsActive: 18,
  },
  {
    id: 'ex-xu',   name: '许安琪', title: '品牌内容专家',
    avatar: '许', color: '#C13D3D',
    expertise: '增长内容与短视频转化专家。主理过 3 个十亿级品牌的内容线',
    experienceTags: ['品牌内容', '短视频转化', '爆文公式', '内容增长'],
    agentCount: 8, yearsActive: 13,
  },
  {
    id: 'ex-liang',name: '梁亦辰', title: '客户成功专家',
    avatar: '梁', color: '#0F766E',
    expertise: 'SaaS 交付与续费体系专家。NPS 体系建立者，续费率 +24% 案例',
    experienceTags: ['SaaS 客户成功', '续费体系', 'NPS', '交付'],
    agentCount: 6, yearsActive: 12,
  },
  {
    id: 'ex-han',  name: '韩书白', title: '供应链运营专家',
    avatar: '韩', color: '#1E8F5C',
    expertise: '流程优化与成本控制专家。京东采购总监出身，供应商比价 -18%',
    experienceTags: ['流程优化', '成本控制', '供应链', '采购'],
    agentCount: 4, yearsActive: 15,
  },
];

export const expertsById = new Map(experts.map((e) => [e.id, e]));

/* 11 大经营环节（按 brief 严格命名） */
export interface BusinessStage {
  id: string;
  name: string;
  desc: string;
  color: string;
  expertIds: string[];
}

export const businessStages: BusinessStage[] = [
  { id: 'st-strategy',  name: '战略决策', desc: '经营目标 · OKR · 重大决策 · 并购投融资',
    color: '#171717', expertIds: ['ex-lin'] },
  { id: 'st-sales',     name: '销售增长', desc: 'BD · 客户分层 · 渠道 · 报价 · 私域',
    color: '#0F70B7', expertIds: ['ex-chen'] },
  { id: 'st-marketing', name: '市场内容', desc: '品牌 · 内容生产 · 投放 · 公关',
    color: '#7E22CE', expertIds: ['ex-xu'] },
  { id: 'st-cs',        name: '客户服务', desc: '工单 · NPS · 客户成功 · 续费',
    color: '#0F766E', expertIds: ['ex-liang'] },
  { id: 'st-product',   name: '产品研发', desc: '需求 · 产品 · 研发 · 测试 · 发布',
    color: '#3B82F6', expertIds: ['ex-lin'] },
  { id: 'st-finance',   name: '财务法务', desc: '财报 · 税筹 · 资金 · 合同 · 合规',
    color: '#B07706', expertIds: ['ex-zhou'] },
  { id: 'st-hr',        name: '人力行政', desc: '招聘 · 入离职 · 文化 · 行政',
    color: '#0F766E', expertIds: ['ex-lin'] },
  { id: 'st-ops',       name: '运营交付', desc: '618 大促 · 复盘 · 投放 · SOP',
    color: '#1E8F5C', expertIds: ['ex-han', 'ex-chen'] },
  { id: 'st-data',      name: '数据分析', desc: 'BI · 建模 · 指标 · AB 实验',
    color: '#0F766E', expertIds: ['ex-han'] },
  { id: 'st-risk',      name: '风险审计', desc: '风险扫描 · DLP · 合规 · 应急',
    color: '#C13D3D', expertIds: ['ex-zhou', 'ex-han'] },
  { id: 'st-knowledge', name: '知识管理', desc: 'SOP 沉淀 · 知识图谱 · 复盘 · 经验回写',
    color: '#7E22CE', expertIds: ['ex-lin'] },
];

/* 一键团队套餐 */
export interface TeamPackage {
  id: string;
  name: string;
  subtitle: string;
  agentCount: number;
  monthlyCost: number;
  bestFor: string;
  stages: string[];
  recommended?: boolean;
}

export const teamPackages: TeamPackage[] = [
  {
    id: 'pkg-startup', name: '初创团队', subtitle: '0-30 人 · 关键岗位补齐',
    agentCount: 7, monthlyCost: 8800,
    bestFor: '产品验证期 · 快速搭起核心岗位',
    stages: ['st-strategy', 'st-sales', 'st-marketing', 'st-cs', 'st-finance'],
  },
  {
    id: 'pkg-growth', name: '标准增长团队', subtitle: '50-300 人 · 业务正在加速',
    agentCount: 15, monthlyCost: 18800, recommended: true,
    bestFor: '增长期企业 · 销售 / 运营 / 客服全链路',
    stages: ['st-strategy', 'st-sales', 'st-marketing', 'st-cs', 'st-product', 'st-finance', 'st-ops', 'st-data'],
  },
  {
    id: 'pkg-flagship', name: '旗舰经营团队', subtitle: '300+ 人 · 多业务线协同',
    agentCount: 25, monthlyCost: 32800,
    bestFor: '成熟企业 · 全 11 环节 + 风险审计',
    stages: ['st-strategy', 'st-sales', 'st-marketing', 'st-cs', 'st-product', 'st-finance', 'st-hr', 'st-ops', 'st-data', 'st-risk', 'st-knowledge'],
  },
  {
    id: 'pkg-custom', name: '企业定制', subtitle: '54 岗位起 · 完全个性化',
    agentCount: 54, monthlyCost: 0,
    bestFor: '私有部署 · 一对一专家定制 · 接 sales',
    stages: ['st-strategy', 'st-sales', 'st-marketing', 'st-cs', 'st-product', 'st-finance', 'st-hr', 'st-ops', 'st-data', 'st-risk', 'st-knowledge'],
  },
];
