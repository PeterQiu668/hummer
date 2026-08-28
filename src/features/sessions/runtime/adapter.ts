import type { SessionPlan } from '../model/session';

export type Unsubscribe = () => void;

export interface RuntimeHandle {
  runtimeId: string;
  sessionId: string;
  nativeSessionId?: string;
}

export type RuntimeSessionStatus = 'running' | 'awaiting_approval' | 'paused' | 'blocked' | 'delivered' | 'cancelled';
export type RuntimeStepStatus = 'running' | 'completed' | 'awaiting_human' | 'blocked' | 'cancelled';

interface RuntimeEventBase {
  sessionId: string;
  sequence: number;
  occurredAt: string;
  actorRef: string;
}

export interface RuntimeStepEvent extends RuntimeEventBase {
  type: 'step';
  category: 'delegation' | 'message' | 'handoff' | 'system';
  status: RuntimeStepStatus;
  title: string;
  result: string;
  output?: string;
  durationMs?: number;
  costCny?: number;
  evidenceRefs: string[];
}

export interface RuntimeToolEvent extends RuntimeEventBase {
  type: 'tool';
  status: RuntimeStepStatus;
  title: string;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  output?: string;
  durationMs: number | null;
  costCny: number | null;
  evidenceRefs: string[];
}

export interface RuntimeApprovalRequiredEvent extends RuntimeEventBase {
  type: 'approval_required';
  approvalId: string;
  title: string;
  message: string;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  diffRef?: string;
  durationMs: number | null;
  costCny: number | null;
  evidenceRefs: string[];
}

export interface RuntimeApprovalResolvedEvent extends RuntimeEventBase {
  type: 'approval_resolved';
  approvalId: string;
  approved: boolean;
  result: string;
  evidenceRefs: string[];
}

export interface RuntimeStatusEvent extends RuntimeEventBase {
  type: 'status';
  status: RuntimeSessionStatus;
  reason?: string;
  evidenceRefs: string[];
}

export interface RuntimeResultEvent extends RuntimeEventBase {
  type: 'result';
  title: string;
  summary: string;
  deliverables: Array<{ name: string; kind: 'report' | 'table' | 'recommendation'; uri?: string }>;
  evidenceRefs: string[];
  durationMs: number | null;
  costCny: number | null;
  usage?: RuntimeTokenUsage;
  rollback: { supported: boolean; instructions?: string };
}

export interface RuntimeTokenUsage {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
  reasoningOutputTokens?: number;
}

export type RuntimeEvent =
  | RuntimeStepEvent
  | RuntimeToolEvent
  | RuntimeApprovalRequiredEvent
  | RuntimeApprovalResolvedEvent
  | RuntimeStatusEvent
  | RuntimeResultEvent;

export interface RuntimeAdapter {
  id: string;
  readonly fallbackReason?: string;
  startSession(plan: SessionPlan): Promise<RuntimeHandle>;
  subscribe(handle: RuntimeHandle, callback: (event: RuntimeEvent) => void): Unsubscribe;
  respondToApproval(handle: RuntimeHandle, id: string, approved: boolean): Promise<void>;
  sendHumanMessage(handle: RuntimeHandle, text: string): Promise<void>;
  pause(handle: RuntimeHandle): Promise<void>;
  resume(handle: RuntimeHandle): Promise<void>;
  stop(handle: RuntimeHandle): Promise<void>;
  forkFromCheckpoint(handle: RuntimeHandle, sequence: number, sop?: string): Promise<RuntimeHandle>;
}
