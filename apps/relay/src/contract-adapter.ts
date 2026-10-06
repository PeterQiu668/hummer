import {
  validateFleetContract,
  type ApprovalDecision,
  type ApprovalRequest,
  type FleetContractName,
  type NodeManifest,
  type RunEvent,
  type TaskEnvelope,
} from '@hummer/contracts';
import type {
  FleetObject,
  FleetValidators,
  ApprovalDecisionClaims,
  ApprovalRequestClaims,
  HeartbeatClaims,
  NodeClaims,
  RunEventClaims,
  TaskClaims,
  ValidationResult,
} from './ports.js';

function validateAndProject<Name extends FleetContractName, Meta>(
  name: Name,
  input: unknown,
  project: (value: Name extends 'NodeManifest'
    ? NodeManifest
    : Name extends 'TaskEnvelope'
      ? TaskEnvelope
    : Name extends 'RunEvent'
        ? RunEvent
        : Name extends 'ApprovalRequest'
          ? ApprovalRequest
          : Name extends 'ApprovalDecision'
            ? ApprovalDecision
            : never) => Meta,
): ValidationResult<Meta> {
  const result = validateFleetContract(name, input);
  if (result.issues) {
    return {
      ok: false,
      reason: result.issues.map((issue) => issue.message).join('; '),
    };
  }
  const value = result.value as Parameters<typeof project>[0];
  return {
    ok: true,
    value: value as unknown as FleetObject,
    meta: project(value),
  };
}

/**
 * The only production adapter from frozen fleet contracts to Relay routing
 * claims. The Relay never maintains a second field whitelist.
 */
export function createSharedFleetValidators(): FleetValidators {
  return {
    nodeManifest: {
      validate: (input) => validateAndProject('NodeManifest', input, (manifest): NodeClaims => ({
        nodeId: manifest.nodeId,
        tenantIds: manifest.tenantIds,
        agentVersion: manifest.agentVersion,
      })),
    },
    heartbeat: {
      validate: (input) => validateAndProject('NodeManifest', input, (manifest): HeartbeatClaims => ({
        nodeId: manifest.nodeId,
        running: manifest.load.running,
      })),
    },
    taskEnvelope: {
      validate: (input) => validateAndProject('TaskEnvelope', input, (envelope): TaskClaims => ({
        // A retry must receive a new idempotency key, so it also receives a
        // distinct Relay task id while remaining under the same originRef.
        taskId: envelope.idempotencyKey,
        workOrderId: envelope.originRef,
        tenantId: envelope.tenantId,
        targetNodeId: envelope.targetNodeId,
        targetRuntime: envelope.targetRuntime,
        idempotencyKey: envelope.idempotencyKey,
        leaseMs: envelope.leaseMs,
        expiresAt: envelope.expiresAt,
        originRef: envelope.originRef,
      })),
    },
    runEvent: {
      validate: (input) => validateAndProject('RunEvent', input, (event): RunEventClaims => ({
        eventId: event.eventId,
        tenantId: event.tenantId,
        workOrderId: event.workOrderId,
        nodeId: event.nodeId,
        seq: event.seq,
        occurredAt: event.occurredAt,
        type: event.type,
        idempotencyKey: event.idempotencyKey,
      })),
    },
    approvalRequest: {
      validate: (input) => validateAndProject('ApprovalRequest', input, (request): ApprovalRequestClaims => ({
        requestId: request.requestId,
        tenantId: request.tenantId,
        workOrderId: request.workOrderId,
        nodeId: request.nodeId,
        runId: request.runId,
        riskClass: request.riskClass,
        action: request.action,
        target: request.target,
        requestedScope: request.requestedScope,
        expiresAt: request.expiresAt,
        requestedBy: request.requestedBy,
      })),
    },
    approvalDecision: {
      validate: (input) => validateAndProject('ApprovalDecision', input, (decision): ApprovalDecisionClaims => ({
        decisionId: decision.decisionId,
        requestId: decision.requestId,
        tenantId: decision.tenantId,
        deciderActorRef: decision.deciderActorRef,
        decidedAt: decision.decidedAt,
        decision: decision.decision,
        ...('grantedScope' in decision && decision.grantedScope
          ? { grantedScope: decision.grantedScope }
          : {}),
      })),
    },
  };
}
