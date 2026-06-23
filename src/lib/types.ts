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
  senderRole: 'human' | 'manager' | 'worker' | 'hermes' | 'guardian';
  avatar: string;
  content: string;
  type: 'msg' | 'task' | 'approval' | 'alert' | 'evolution' | 'mention';
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
