export type ZoneId =
  | 'boss'
  | 'business'
  | 'support'
  | 'meeting'
  | 'rest'
  | 'learn';

export type EmployeeStatus =
  | 'working'
  | 'idle'
  | 'blocked'
  | 'meeting'
  | 'training';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface Skill {
  id: string;
  name: string;
  level: number;
  equipped: boolean;
  source: 'builtin' | 'marketplace' | 'expert';
}

export interface Permission {
  id: string;
  scope: string;
  level: 'read' | 'write' | 'admin' | 'external';
  approvalRequired: boolean;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  approver?: string;
  risk: RiskLevel;
}

export interface EvolutionRecord {
  level: number;
  badCases: number;
  improved: number;
  pending: number;
  lastUpdate: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
  zone: ZoneId;
  status: EmployeeStatus;
  avatar: string;
  twin: string;
  currentTask?: string;
  taskLines?: string[];
  progress?: number;
  skills: Skill[];
  permissions: Permission[];
  auditEntries: AuditEntry[];
  evolution: EvolutionRecord;
  position: [number, number, number];
  risk: RiskLevel;
  expert?: string;
  model: string;
  tokensToday: number;
  costToday: number;
}

export interface MarketEmployee {
  id: string;
  name: string;
  category: string;
  tagline: string;
  expert: string;
  expertTitle: string;
  certified: boolean;
  hires: number;
  rating: number;
  tags: string[];
  avatar: string;
  color: string;
}

export interface FeishuMessage {
  id: string;
  ts: string;
  channel: string;
  sender: string;
  senderRole: 'human' | 'manager' | 'worker' | 'hermes' | 'guardian' | 'expert';
  avatar: string;
  content: string;
  type:
    | 'msg' | 'task' | 'approval' | 'alert' | 'evolution' | 'mention'
    | 'translate' | 'decompose' | 'confirm' | 'tool_call' | 'deliverable' | 'evidence';
  mentions?: string[];
  attachments?: { name: string; kind: string }[];
}

export interface HermesBadCase {
  id: string;
  title: string;
  agent: string;
  cause: string;
  stage: 'detected' | 'optimizing' | 'sandbox' | 'review' | 'shipped';
  improvement: string;
  delta: string;
  cost: string;
}

export type ScreenView =
  | 'boot'
  | 'office'
  | 'marketplace'
  | 'governance'
  | 'evolution';

// === v5.3 collab types ===
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'waiting_approval'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'overdue';

export interface CollabTask {
  id: string;
  title: string;
  goal: string;
  scope: string;
  inputs: string[];
  outputs: string[];
  acceptance: string[];
  ownerId: string;
  collaboratorIds: string[];
  dueAt: string;
  status: TaskStatus;
  progress: number;
  channel: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  createdAt: string;
}

export interface RiskAlert {
  id: string;
  ts: string;
  agent: string;
  agentAvatar: string;
  action: string;
  data: string[];
  level: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  suggestion: string;
  channel: string;
  status: 'pending' | 'approved' | 'rejected' | 'safer';
}

// === v5.5 Douyin Lobster Lab injection ===
// 来源：抖音 3 视频 — 练虾系统(上/下) + AI 飞书

// 视频① 4 要素：每个 Agent 的 SOP 版本演进 + 多轮训练实验记录
export interface SopVersion {
  agentId: string;
  current: string;        // e.g. 'v3.2'
  trainedRounds: number;  // 累计训练轮次
  lastBumpAt: string;     // 上次升级时间
  history: {
    round: number;
    version: string;
    accuracy: number;
    cost: string;
    note: string;
  }[];
}

// 视频② 老板今日待办收件箱 5 大类
export type InboxKind = 'approval' | 'block' | 'stuck' | 'accept' | 'anomaly';
export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  agent: string;
  channel: string;
  ts: string;
  detail: string;
  urgent: boolean;
}

// 视频① 淘汰流 - 拒绝慢养
export interface EliminatedAgent {
  id: string;
  name: string;
  reason: string;
  replacedBy: string;
  eliminatedAt: string;
  tasksTried: number;
  finalScore: number; // 0-100
}

// 视频③ 上岗 4 阶段：市场→试岗→评分→授权→入工区
export type LifecycleStage = 'market' | 'trial' | 'scoring' | 'authorizing' | 'onboarded';
export interface LifecycleCandidate {
  marketId: string;     // marketEmployees 的 id
  stage: LifecycleStage;
  trialDay?: number;    // 试岗第 N 天 (1-7)
  trialScore?: number;  // 0-100
  trialMetrics?: {
    completed: number;
    quality: number;
    cost: string;
    risks: number;
  };
  expectedZone?: string;
}

// 视频① 黑客帝国式技能插盘 — 由 store 触发的动画事件
export interface SkillSlotInEvent {
  id: string;
  agentName: string;
  skillName: string;
  skillSource: string; // expert name
  startedAt: number;   // Date.now()
}

// === Phase 0: 多角色 + 闭环补全（docs/phase0-prd.md）===

// 顶栏角色切换（mock 身份）
export type RoleKey = 'boss' | 'exec' | 'staff' | 'expert' | 'auditor';

// 验收工作台：对任务 acceptance[] 的逐条判定
export interface AcceptanceJudgement {
  taskId: string;
  itemIndex: number;          // acceptance 数组下标
  verdict: 'passed' | 'failed';
  judgedBy: string;
  note?: string;
  ts: string;
}

// 交付出口：证据的「生效动作」（发送客户 / 回写 CRM / 发布）
export type ExitActionKind = 'send_client' | 'writeback_crm' | 'publish';
export interface DeliverableExitAction {
  id: string;
  evidenceId: string;
  evidenceName: string;
  action: ExitActionKind;
  target: string;             // 如「鲲鹏制造 · 王总邮箱」「Salesforce · 商机 #4471」
  status: 'pending_approval' | 'executed' | 'rejected';
  requestedBy: string;
  approvedBy?: string;
  ts: string;
}

// 授权仪式：数字员工转正时签署的权限/额度/范围/有效期
export interface AuthorizationGrant {
  id: string;
  employeeId: string;
  employeeName: string;
  permissions: string[];
  dataScope: string[];
  quotaMonthly: number;       // 月度动作额度（元）
  validUntil: string;
  signedBy: string;
  signedAt: string;
  status: 'active' | 'revoked' | 'expired';
}

// 试岗第 7 天强制决策
export interface TrialDecision {
  candidateId: string;        // marketEmployees 的 id
  decision: 'promote' | 'extend' | 'return';
  decidedBy: string;
  ts: string;
}

// 专家介入工单（专家保障 SLA 的兑现载体）
export interface ExpertTicket {
  id: string;
  title: string;
  expertId: string;
  expertName: string;
  agentName: string;          // 出事的数字员工
  taskId?: string;
  severity: 'low' | 'medium' | 'high';
  slaHours: number;
  status: 'open' | 'responding' | 'resolved';
  createdAt: string;
  timeline: { ts: string; actor: string; note: string }[];
}
