/**
 * Agentrix 架构模型档案（深度复刻自 aihuashen.com 首页「智能体架构」三层模型）
 * 自下而上：Data OS（数据层）→ Agent OS（编排/执行层）→ Agent Workforce（劳动力层）
 * 文案与 Agentrix scrolly 弹窗对齐，并融合 HUMMER 自有引擎模块。
 */

export type ArchLayerId = 'dataos' | 'agentos' | 'workforce';

export interface ArchStat { label: string; value: string }
export interface ArchModule { icon: string; label: string; sub: string }

export interface ArchLayerProfile {
  id: ArchLayerId;
  badge: string;        // 层级英文名（产品名，不本地化）
  title: string;        // 中文标题
  accent: string;
  summary: string;
  stats: ArchStat[];
  features: string[];
  modules: ArchModule[]; // HUMMER 引擎模块（图标名 → OfficeStage3D 映射 lucide 组件）
}

export const ARCH_LAYERS: Record<ArchLayerId, ArchLayerProfile> = {
  dataos: {
    id: 'dataos',
    badge: 'Data OS',
    title: '企业数据与知识底座',
    accent: '#14B8A6',
    summary:
      '分布式企业级数据基础设施，拥有 42 个异构存储节点，支持全业务域的持久化存储、高效检索与跨库联邦查询。',
    stats: [
      { label: '节点', value: '42' },
      { label: '类型', value: '分布式' },
      { label: '角色', value: '持久化' },
    ],
    features: [
      '全域数据持久化与生命周期管理',
      '跨库联邦查询与数据虚拟化',
      '自动 Schema 演进与版本兼容',
      '数据血缘追踪与合规审计',
    ],
    modules: [
      { icon: 'BookOpen',  label: '知识图谱',   sub: '9.6k 边' },
      { icon: 'Database',  label: '业务数据',   sub: 'CRM · ERP · BI' },
      { icon: 'GitBranch', label: '流程 SOP',   sub: '24 条' },
      { icon: 'Users2',    label: '权限身份',   sub: 'RBAC + ABAC' },
      { icon: 'Activity',  label: '审计账本',   sub: 'Append-only' },
      { icon: 'Key',       label: '凭证保险柜', sub: '工牌令牌托管' },
    ],
  },
  agentos: {
    id: 'agentos',
    badge: 'Agent OS',
    title: '企业智能体操作系统',
    accent: '#A855F7',
    summary:
      '任务编排与协同执行层：将业务目标拆解为可路由的原子任务，分发至最优智能体节点，执行推理、生成与业务操作并聚合结果。',
    stats: [
      { label: '队列', value: '多优先级' },
      { label: '协议', value: 'A2A' },
      { label: '路由', value: '动态' },
    ],
    features: [
      '业务目标自动拆解为原子任务',
      '动态多优先级调度与智能路由',
      '通过 A2A 协议实现跨域智能体协作',
      '实时执行监控与自动故障恢复',
    ],
    modules: [
      { icon: 'Shuffle',     label: '任务调度', sub: '186 / 5min' },
      { icon: 'Cpu',         label: '模型路由', sub: '5 模型分层' },
      { icon: 'Network',     label: 'A2A 委派', sub: '6 高管分身' },
      { icon: 'Wrench',      label: 'MCP 工具', sub: '12 已连接' },
      { icon: 'Shield',      label: '审批策略', sub: '四眼原则' },
      { icon: 'AlertCircle', label: '风险阻断', sub: '2 高危挂起' },
    ],
  },
  workforce: {
    id: 'workforce',
    badge: 'Agent Workforce',
    title: '专业智能体员工队伍',
    accent: '#3B82F6',
    summary:
      '由专业 AI 数字员工组成的顶层工作现场：15 位数字员工分布于 6 个功能分区，接收 Agent OS 指令、读写 Data OS 数据，并以 KPI 对业务结果负责。',
    stats: [
      { label: '员工', value: '15 位' },
      { label: '分区', value: '6 个' },
      { label: '延迟', value: '低延迟' },
    ],
    features: [
      '多智能体任务并发执行',
      '结构化推理并将结果回写至数据层',
      '角色档案 + 状态动作实时可视',
      '跨层状态同步与健康上报',
    ],
    modules: [
      { icon: 'Users2',    label: '数字员工', sub: '15 在岗' },
      { icon: 'Route',     label: '协作路径', sub: '实时映射' },
      { icon: 'Target',    label: 'KPI 承诺', sub: '结果负责' },
      { icon: 'Sparkles',  label: '进化中心', sub: '持续充电' },
    ],
  },
};

/** 底层可点击数据库节点（复刻 Agentrix NODE-37 弹窗） */
export const DB_NODE_PROFILE = {
  chip: 'NODE-37',
  title: '数据库',
  summary: '该数据库承载供应履约与资源协调，为核心业务提供稳定、可追溯的数据支撑。',
  details: [
    { label: '数据域',   value: '供应履约与资源协调' },
    { label: '更新频率', value: '日终汇总 + 异常补录' },
    { label: '负责方',   value: '区域交付团队' },
    { label: '数据规模', value: '7600k' },
    { label: '保留期限', value: '1 年' },
    { label: '数据分级', value: '内部' },
  ],
};

/** 中层可点击任务塔（复刻 Agentrix TASK-42 弹窗） */
export const TASK_TOWER_PROFILE = {
  chip: 'TASK-42',
  title: '任务',
  summary: '该任务聚焦于项目里程碑风险预警，指派的智能体持续执行并汇报状态更新。',
  details: [
    { label: '目标',     value: '排班规划与资源调度优化' },
    { label: '当前动作', value: '发送异常升级通知' },
    { label: '最近更新', value: '5m' },
    { label: '风险等级', value: '低' },
  ],
};
