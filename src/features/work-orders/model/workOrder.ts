export type WorkOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'planned'
  | 'running'
  | 'awaiting_approval'
  | 'blocked'
  | 'delivered'
  | 'accepted'
  | 'rejected'
  | 'failed'
  | 'cancelled'
  | 'archived';

export type WorkOrderCommandType =
  | 'submit'
  | 'approve_assignment'
  | 'plan'
  | 'start'
  | 'request_approval'
  | 'approve_approval'
  | 'reject_approval'
  | 'deliver'
  | 'accept'
  | 'reject'
  | 'request_rework'
  | 'fail'
  | 'cancel'
  | 'archive';

export interface WorkOrderCommand {
  type: WorkOrderCommandType;
  actorRef: string;
  expectedVersion: number;
  idempotencyKey: string;
  occurredAt: string;
}

export interface WorkOrderStateChange {
  sequence: number;
  type: string;
  actorRef: string;
  occurredAt: string;
}

export interface WorkOrderReceipt {
  event: WorkOrderStateChange;
}

export interface WorkOrder {
  id: string;
  tenantId: string;
  title: string;
  goal: string;
  ownerActorRef: string;
  assignedEmployeeId: string;
  status: WorkOrderStatus;
  version: number;
  commandReceipts: Record<string, WorkOrderReceipt>;
}

export type WorkOrderTransitionResult =
  | {
      ok: true;
      order: WorkOrder;
      event: WorkOrderStateChange;
      replayed: boolean;
    }
  | {
      ok: false;
      code: 'invalid_transition' | 'stale_version';
      message: string;
    };

export function createDemoWorkOrder(input: Pick<WorkOrder, 'id' | 'title' | 'goal' | 'ownerActorRef' | 'assignedEmployeeId'>): WorkOrder {
  return {
    ...input,
    tenantId: 'tenant_demo',
    status: 'draft',
    version: 0,
    commandReceipts: {},
  };
}

export function transitionWorkOrder(order: WorkOrder, command: WorkOrderCommand): WorkOrderTransitionResult {
  const existingReceipt = order.commandReceipts[command.idempotencyKey];
  if (existingReceipt) {
    return {
      ok: true,
      order,
      event: existingReceipt.event,
      replayed: true,
    };
  }

  if (command.expectedVersion !== order.version) {
    return {
      ok: false,
      code: 'stale_version',
      message: `expected version ${command.expectedVersion} but WorkOrder is at version ${order.version}`,
    };
  }

  const nextStatus = ALLOWED_TRANSITIONS[order.status]?.[command.type];
  if (!nextStatus) {
    return {
      ok: false,
      code: 'invalid_transition',
      message: `${command.type} is not allowed while WorkOrder is ${order.status}`,
    };
  }

  const event: WorkOrderStateChange = {
    sequence: order.version + 1,
    type: EVENT_NAMES[command.type],
    actorRef: command.actorRef,
    occurredAt: command.occurredAt,
  };
  const nextOrder: WorkOrder = {
    ...order,
    status: nextStatus,
    version: event.sequence,
    commandReceipts: {
      ...order.commandReceipts,
      [command.idempotencyKey]: { event },
    },
  };

  return { ok: true, order: nextOrder, event, replayed: false };
}

const ALLOWED_TRANSITIONS: Partial<Record<WorkOrderStatus, Partial<Record<WorkOrderCommandType, WorkOrderStatus>>>> = {
  draft: { submit: 'submitted', cancel: 'cancelled' },
  submitted: { approve_assignment: 'approved', cancel: 'cancelled' },
  approved: { plan: 'planned', cancel: 'cancelled' },
  planned: { start: 'running', cancel: 'cancelled' },
  running: {
    request_approval: 'awaiting_approval',
    deliver: 'delivered',
    fail: 'failed',
    cancel: 'cancelled',
  },
  awaiting_approval: {
    approve_approval: 'running',
    reject_approval: 'blocked',
    cancel: 'cancelled',
  },
  blocked: { archive: 'archived', cancel: 'cancelled' },
  delivered: { accept: 'accepted', reject: 'rejected' },
  rejected: { request_rework: 'planned', archive: 'archived' },
  accepted: { archive: 'archived' },
  failed: { archive: 'archived' },
  cancelled: { archive: 'archived' },
};

const EVENT_NAMES: Record<WorkOrderCommandType, string> = {
  submit: 'work_order.submitted',
  approve_assignment: 'work_order.assigned',
  plan: 'work_order.planned',
  start: 'work_order.started',
  request_approval: 'approval.requested',
  approve_approval: 'approval.decided',
  reject_approval: 'approval.decided',
  deliver: 'result_package.created',
  accept: 'result_package.accepted',
  reject: 'result_package.rejected',
  request_rework: 'work_order.planned',
  fail: 'work_order.failed',
  cancel: 'work_order.cancelled',
  archive: 'work_order.archived',
};
