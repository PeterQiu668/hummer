import type { MarketEmployee } from '../lib/types';

const categories = [
  '销售增长',
  '运营增长',
  '财务税务',
  '人力资源',
  '法务合规',
  '客户服务',
  '研发工程',
  '数据分析',
  '内容创作',
  '行政后勤',
  '战略决策',
];

const palette = [
  '#00ffff',
  '#ff00aa',
  '#00ff88',
  '#a855f7',
  '#ffb800',
  '#5b8cff',
  '#ff7a00',
  '#3df0a0',
];

const seed: Omit<MarketEmployee, 'id' | 'color' | 'avatar'>[] = [
  { name: '高客单 BD 顾问', category: '销售增长', tagline: '20w+ 客单成功率 +37%', expert: '陈鹏', expertTitle: '前 SaaS Top 销售总监', certified: true, hires: 1284, rating: 4.9, tags: ['BD 邮件', 'CRM 调用', '报价单'] },
  { name: '私域销冠', category: '销售增长', tagline: '微信私域 SOP，月触达 5w+', expert: '李婷', expertTitle: '私域操盘手 · 营收 1 亿+', certified: true, hires: 942, rating: 4.8, tags: ['私域', 'SOP', '社群'] },
  { name: '渠道分销官', category: '销售增长', tagline: '渠道 ROI 提升 41%', expert: '张磊', expertTitle: '前华为渠道经理', certified: true, hires: 612, rating: 4.7, tags: ['分销', '渠道', '激励'] },
  { name: '618 大促运营', category: '运营增长', tagline: '618 GMV 提升 2.3x', expert: '吴琳', expertTitle: '前阿里大促 PM', certified: true, hires: 1782, rating: 4.9, tags: ['大促', 'BI', '复盘'] },
  { name: '抖音直播运营', category: '运营增长', tagline: '单场 GMV 突破 500w', expert: '马涛', expertTitle: '抖音 MCN 创始人', certified: true, hires: 1456, rating: 4.8, tags: ['直播', '短视频', '投流'] },
  { name: '小红书种草官', category: '运营增长', tagline: '爆文率 18.4%', expert: '林岚', expertTitle: '小红书 KOC 操盘', certified: true, hires: 1124, rating: 4.7, tags: ['种草', '内容', '爆文'] },
  { name: '资深 CFO', category: '财务税务', tagline: '财报合并 + 税筹', expert: '周伟', expertTitle: '上市公司 CFO', certified: true, hires: 532, rating: 4.9, tags: ['财报', '税筹', '合并'] },
  { name: '小微税务专家', category: '财务税务', tagline: '小微企业税筹节省 22%', expert: '何敏', expertTitle: '四大税务合伙人', certified: true, hires: 884, rating: 4.8, tags: ['小微', '税筹', '社保'] },
  { name: '资金 / 应收应付', category: '财务税务', tagline: '应收账款回收 +35%', expert: '钱军', expertTitle: '上市公司财务总监', certified: false, hires: 312, rating: 4.6, tags: ['应收', '现金流', '风控'] },
  { name: '校招招聘官', category: '人力资源', tagline: '校招漏斗优化 +28%', expert: '苏娜', expertTitle: '前美团 HRD', certified: true, hires: 624, rating: 4.7, tags: ['招聘', '校招', 'JD'] },
  { name: '社招猎头', category: '人力资源', tagline: '高端人才 14 天到岗', expert: '杜云', expertTitle: '前科锐合伙人', certified: true, hires: 412, rating: 4.6, tags: ['社招', '猎头', '面试'] },
  { name: '组织发展 OD', category: '人力资源', tagline: '组织诊断 + 文化建设', expert: '彭飞', expertTitle: '前阿里政委', certified: true, hires: 286, rating: 4.8, tags: ['OD', '文化', '绩效'] },
  { name: '合同审阅专家', category: '法务合规', tagline: '6 类风险点自动标记', expert: '黄律', expertTitle: '红圈所合伙人', certified: true, hires: 712, rating: 4.9, tags: ['合同', '风险', '条款'] },
  { name: '数据合规官', category: '法务合规', tagline: '个保法 / GDPR 自检', expert: '范雪', expertTitle: '某互联网巨头 DPO', certified: true, hires: 488, rating: 4.8, tags: ['个保法', 'GDPR', '数据'] },
  { name: '知识产权官', category: '法务合规', tagline: '专利商标全流程', expert: '于辰', expertTitle: '前国家知识产权局', certified: false, hires: 184, rating: 4.5, tags: ['专利', '商标', '版权'] },
  { name: '7×24 客服官', category: '客户服务', tagline: '工单首响 8s', expert: '柳菲', expertTitle: '前美团客服中台', certified: true, hires: 1644, rating: 4.9, tags: ['工单', '多通道', '情绪'] },
  { name: 'VIP 客户官', category: '客户服务', tagline: 'NPS 净推荐值 +21', expert: '徐慧', expertTitle: '前蔚来用户运营', certified: true, hires: 488, rating: 4.8, tags: ['VIP', 'NPS', '关怀'] },
  { name: '舆情危机官', category: '客户服务', tagline: '4h 危机响应 SOP', expert: '韩松', expertTitle: '前公关战略顾问', certified: false, hires: 224, rating: 4.6, tags: ['舆情', '危机', 'PR'] },
  { name: 'API / 接口工程师', category: '研发工程', tagline: 'OpenAPI + 单测一键出', expert: '冯铭', expertTitle: '前 Meta 高级工程师', certified: true, hires: 924, rating: 4.9, tags: ['API', '单测', 'OpenAPI'] },
  { name: '前端组件官', category: '研发工程', tagline: 'shadcn 组件 30s 出图', expert: '叶秋', expertTitle: '前字节前端架构', certified: true, hires: 764, rating: 4.8, tags: ['前端', '组件', 'UI'] },
  { name: 'DevOps / SRE', category: '研发工程', tagline: 'K8s 故障自愈', expert: '罗川', expertTitle: '前阿里 SRE', certified: true, hires: 428, rating: 4.8, tags: ['K8s', 'SRE', 'CI/CD'] },
  { name: '数据建模师', category: '数据分析', tagline: '维度建模 / 指标平台', expert: '宋阳', expertTitle: '前阿里数据中台', certified: true, hires: 612, rating: 4.8, tags: ['建模', '指标', 'BI'] },
  { name: 'AB 实验官', category: '数据分析', tagline: '实验显著性 + 推全决策', expert: '安瑞', expertTitle: '前 Airbnb 数据科学家', certified: true, hires: 318, rating: 4.7, tags: ['AB', '实验', '推全'] },
  { name: '增长黑客', category: '数据分析', tagline: '北极星指标驱动', expert: '柳轶', expertTitle: '增长教父 · 范冰门徒', certified: true, hires: 528, rating: 4.7, tags: ['增长', '漏斗', '指标'] },
  { name: '小红书爆文官', category: '内容创作', tagline: '爆文公式 v3.2', expert: '林岚', expertTitle: '小红书 KOC 操盘', certified: true, hires: 1842, rating: 4.9, tags: ['爆文', '种草', '标题'] },
  { name: '抖音脚本官', category: '内容创作', tagline: '3 秒钩子模型', expert: '马涛', expertTitle: '抖音 MCN 创始人', certified: true, hires: 1684, rating: 4.8, tags: ['脚本', '钩子', '叙事'] },
  { name: '公众号长文官', category: '内容创作', tagline: '10w+ 选题 + 改稿', expert: '伊辰', expertTitle: '某新世相主编', certified: false, hires: 412, rating: 4.6, tags: ['长文', '10w+', '选题'] },
  { name: '海报设计师', category: '内容创作', tagline: 'Figma + AI 一键出图', expert: '安琪', expertTitle: '前 OPPO 视觉总监', certified: true, hires: 1124, rating: 4.7, tags: ['海报', 'Figma', 'AI 绘图'] },
  { name: '会议纪要官', category: '行政后勤', tagline: '会议录音 → 行动项', expert: '言溪', expertTitle: '前微软 PM', certified: true, hires: 928, rating: 4.8, tags: ['纪要', '录音', '行动项'] },
  { name: '差旅助理', category: '行政后勤', tagline: '机酒比价 + 报销自动化', expert: '简文', expertTitle: '差旅 SaaS 联合创始人', certified: true, hires: 412, rating: 4.6, tags: ['差旅', '报销', '比价'] },
  { name: '采购比价官', category: '行政后勤', tagline: '供应商比价 - 18%', expert: '尹波', expertTitle: '前京东采购总监', certified: false, hires: 226, rating: 4.5, tags: ['采购', '比价', '供应商'] },
  { name: '战略复盘官', category: '战略决策', tagline: '季度复盘 + 关键决策', expert: '严正', expertTitle: '前阿里 P10 战略专家', certified: true, hires: 612, rating: 4.9, tags: ['复盘', 'OKR', '战略'] },
  { name: '投融资助理', category: '战略决策', tagline: 'BP + 估值模型', expert: '葛朗', expertTitle: '前红杉投资合伙人', certified: true, hires: 312, rating: 4.8, tags: ['BP', '估值', 'FA'] },
  { name: '商业模式画布', category: '战略决策', tagline: '画布 + 单元经济模型', expert: '夏临', expertTitle: '混沌商学院教练', certified: false, hires: 184, rating: 4.6, tags: ['画布', '单经', 'BMC'] },
  { name: '行业研究员', category: '战略决策', tagline: '行研报告 24h 出炉', expert: '童远', expertTitle: '前中金行研', certified: true, hires: 422, rating: 4.7, tags: ['行研', '报告', '数据'] },
  { name: '客户成功官', category: '客户服务', tagline: '续费率 +24%', expert: '段思', expertTitle: '前 Salesforce CSM', certified: true, hires: 388, rating: 4.7, tags: ['CSM', '续费', '健康度'] },
];

export const marketEmployees: MarketEmployee[] = seed.map((s, i) => ({
  ...s,
  id: `m-${i + 1}`,
  color: palette[i % palette.length],
  avatar: s.name.slice(0, 1),
}));

export const marketCategories = ['全部', ...categories];

// ===== v5.4 deepening: per-employee extras =====
export interface MarketEvaluation {
  user: string;
  rating: number;
  comment: string;
  ts: string;
}

export interface MarketTrainingEvent {
  ts: string;
  event: string;
  delta: string;
}

export interface MarketExpertProfile {
  bio: string;
  exp: string[];
  awards: string[];
}

export interface MarketExtras {
  evaluations: MarketEvaluation[];
  trainingHistory: MarketTrainingEvent[];
  expertProfile: MarketExpertProfile;
}

const defaultEvaluations = (name: string, expert: string): MarketEvaluation[] => [
  {
    user: '某 SaaS 公司 · COO',
    rating: 5,
    comment: `${name} 上岗一周, ${expert} 老师亲调 SOP, 直接对齐我们 Top 销售经验, 团队 ROI 翻倍.`,
    ts: '3 天前',
  },
  {
    user: '某连锁零售 · 数字化总监',
    rating: 5,
    comment: '比内部新人快 4 倍, 关键是 Hermes 还在不断进化, 我们没有再为新需求加人.',
    ts: '1 周前',
  },
  {
    user: '某互联网中厂 · HRD',
    rating: 4,
    comment: '初期需要花 1-2 天调权限和 KG 对接, 之后就完全自动跑了, 非常值.',
    ts: '2 周前',
  },
];

const defaultTraining = (expert: string): MarketTrainingEvent[] => [
  { ts: '2026-05-22', event: `初版上线, ${expert} 标注 120 条样本`, delta: '准确率 0% → 78%' },
  { ts: '2026-05-29', event: 'Hermes GEPA 自动改进 v1.1', delta: '+6.4%' },
  { ts: '2026-06-05', event: '人审反馈 18 条 bad case', delta: '+3.1%' },
  { ts: '2026-06-12', event: 'KG schema 扩展 + SOP 调整 v2', delta: '+4.8%' },
  { ts: '2026-06-19', event: '沙箱 A/B 通过, 发布 v2.3', delta: '+2.2%' },
];

const defaultProfile = (expert: string, expertTitle: string): MarketExpertProfile => ({
  bio: `${expert}, ${expertTitle}. 累计带教 300+ 一线团队, 长期与蓝血军团专家共创委员会合作.`,
  exp: [
    `${expertTitle} (历任)`,
    '混沌商学院特邀讲师',
    '某 500 强企业内训独家讲师',
  ],
  awards: ['2024 年度专家共创人 TOP 10', '蓝血军团专家委员会终身荣誉成员'],
});

// Auto-populate extras for all market employees (keys = id)
export const marketExtras: Record<string, MarketExtras> = marketEmployees.reduce(
  (acc, m) => {
    acc[m.id] = {
      evaluations: defaultEvaluations(m.name, m.expert),
      trainingHistory: defaultTraining(m.expert),
      expertProfile: defaultProfile(m.expert, m.expertTitle),
    };
    return acc;
  },
  {} as Record<string, MarketExtras>,
);

// Similar-employee recommendation: same category, excluding self
export const getSimilarEmployees = (id: string) => {
  const me = marketEmployees.find((m) => m.id === id);
  if (!me) return [];
  return marketEmployees
    .filter((m) => m.id !== id && m.category === me.category)
    .slice(0, 4);
};

// Trial task & permission scope catalog for the 7-day trial modal
export const trialTaskCatalog: { id: string; label: string; desc: string }[] = [
  { id: 't-1', label: 'BD 邮件批量起草', desc: '从 CRM 拉客户 → 起草 → 待你审核发出' },
  { id: 't-2', label: '客户复盘报告', desc: '7 天数据 → 复盘报告 → 飞书文档' },
  { id: 't-3', label: '合同初筛', desc: 'PDF → 风险标记 → 律师人审' },
  { id: 't-4', label: '工单情绪分流', desc: '7×24 接单 → 情绪分类 → 分级回复' },
];

export const trialPermissionPresets: { id: string; label: string; perms: string[] }[] = [
  { id: 'p-min', label: '最小权限', perms: ['只读 CRM', '只读 KG', '飞书草稿(待审)'] },
  { id: 'p-std', label: '标准权限', perms: ['读写 CRM', '只读 KG', '飞书草稿(待审)', '邮件草稿(待审)'] },
  { id: 'p-full', label: '完整权限', perms: ['读写 CRM', '读写 KG', '飞书直发', '邮件直发(<5w 客户)'] },
];

// "我的招聘" mock 列表
export interface MyHire {
  id: string;
  name: string;
  hiredAt: string;
  status: '试岗中' | '已转正' | '训练中';
  remainingDays?: number;
  metrics: { label: string; value: string }[];
}

export const myHires: MyHire[] = [
  {
    id: 'mh-1',
    name: '高客单 BD 顾问',
    hiredAt: '2026-06-18',
    status: '试岗中',
    remainingDays: 3,
    metrics: [
      { label: '已起草', value: '48 封' },
      { label: '回复率', value: '24.6%' },
      { label: '成本', value: '¥186' },
    ],
  },
  {
    id: 'mh-2',
    name: '合同审阅专家',
    hiredAt: '2026-05-10',
    status: '已转正',
    metrics: [
      { label: '审阅', value: '212 份' },
      { label: '准确率', value: '94.2%' },
      { label: '节省', value: '¥38k/月' },
    ],
  },
  {
    id: 'mh-3',
    name: '7×24 客服官',
    hiredAt: '2026-06-20',
    status: '训练中',
    metrics: [
      { label: '训练样本', value: '1.2k 条' },
      { label: '进度', value: '63%' },
      { label: '预计上岗', value: '+2 天' },
    ],
  },
];
