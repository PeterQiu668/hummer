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

export type RiskLevel = 'low' | 'medium' | 'high';

export type ActorKind = 'human' | 'twin' | 'employee' | 'system' | 'expert';
export type ActorRef = `${ActorKind}:${string}`;

export interface AcceptanceCriterion {
  id: string;
  text: string;
  required: boolean;
}

export interface CreateWorkOrderInput {
  tenantId: string;
  title: string;
  goal: string;
  scope: string;
  inputRefs?: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  ownerActorRef: ActorRef;
  assignedEmployeeId: string;
  collaboratorActorRefs?: ActorRef[];
  riskLevel?: RiskLevel;
  budgetLimitCny: number;
  dueAt?: string;
}

export interface WorkOrder extends Omit<CreateWorkOrderInput, 'inputRefs' | 'collaboratorActorRefs' | 'riskLevel'> {
  id: string;
  version: number;
  inputRefs: string[];
  collaboratorActorRefs: ActorRef[];
  riskLevel: RiskLevel;
  status: 'draft';
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkOrderCommand {
  input: CreateWorkOrderInput;
  actorRef: ActorRef;
  correlationId: string;
  idempotencyKey: string;
  expectedVersion: 0;
}

export interface WorkOrderRepository {
  create(workOrder: WorkOrder, idempotencyKey: string): Promise<WorkOrder>;
  getById(tenantId: string, id: string): Promise<WorkOrder | undefined>;
  getIdempotentResult(tenantId: string, idempotencyKey: string): Promise<WorkOrder | undefined>;
}

export interface CreateWorkOrderResult {
  workOrder: WorkOrder;
  replayed: boolean;
}
