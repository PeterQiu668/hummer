import type { ControlledWriteResult, ControlledWriteStore } from './controlled-write-store.js';
import type { ApprovedArtifactExportInput, EgressDeliveryRecord, EgressDeliveryStore } from './egress-delivery-store.js';
import type { ToolRegistryStore } from './tool-registry-store.js';

export interface ExternalSendDraftInput {
  tenantId: string;
  sessionId: string;
  approvalId: string;
  requestedBy: string;
  relativePath: string;
  content: string;
  workspaceDirectory: string;
  occurredAt: string;
  idempotencyKey: string;
}

export class BuiltinToolExecutor {
  constructor(
    private readonly controlledWrites: ControlledWriteStore,
    private readonly tools: ToolRegistryStore,
    private readonly egress: EgressDeliveryStore,
  ) {}

  createExternalSendDraft(input: ExternalSendDraftInput): ControlledWriteResult {
    const startedAt = Date.now();
    try {
      const result = this.controlledWrites.write({ ...input, action: 'external.send.draft' });
      this.tools.recordInvocation({
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        capabilityId: 'external.send.draft',
        actorRef: input.requestedBy,
        status: 'completed',
        args: { relativePath: input.relativePath },
        result: { evidenceRef: result.evidenceRef, relativePath: result.relativePath, sha256: result.sha256, sizeBytes: result.sizeBytes },
        durationMs: Date.now() - startedAt,
        evidenceRefs: [result.evidenceRef],
        occurredAt: input.occurredAt,
        idempotencyKey: input.idempotencyKey,
      });
      return result;
    } catch (error) {
      this.tools.recordInvocation({
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        capabilityId: 'external.send.draft',
        actorRef: input.requestedBy,
        status: error instanceof Error && /approved approval/i.test(error.message) ? 'declined' : 'failed',
        args: { relativePath: input.relativePath },
        result: { error: error instanceof Error ? error.message : String(error) },
        durationMs: Date.now() - startedAt,
        evidenceRefs: [],
        occurredAt: input.occurredAt,
        idempotencyKey: input.idempotencyKey,
      });
      throw error;
    }
  }

  exportApprovedArtifact(input: ApprovedArtifactExportInput): EgressDeliveryRecord {
    const startedAt = Date.now();
    try {
      const result = this.egress.exportApprovedArtifact(input);
      this.tools.recordInvocation({
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        capabilityId: 'external.send',
        actorRef: input.requestedBy,
        status: 'completed',
        args: { sourceRelativePath: input.sourceRelativePath, destinationDirectory: input.destinationDirectory },
        result: {
          deliveryId: result.id,
          target: result.target,
          contentSha256: result.contentSha256,
          deliveredAt: result.occurredAt,
        },
        durationMs: Date.now() - startedAt,
        evidenceRefs: [result.evidenceRef],
        occurredAt: input.occurredAt,
        idempotencyKey: input.idempotencyKey,
      });
      return result;
    } catch (error) {
      this.tools.recordInvocation({
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        capabilityId: 'external.send',
        actorRef: input.requestedBy,
        status: error instanceof Error && /approved approval/i.test(error.message) ? 'declined' : 'failed',
        args: { sourceRelativePath: input.sourceRelativePath, destinationDirectory: input.destinationDirectory },
        result: { error: error instanceof Error ? error.message : String(error) },
        durationMs: Date.now() - startedAt,
        evidenceRefs: [],
        occurredAt: input.occurredAt,
        idempotencyKey: input.idempotencyKey,
      });
      throw error;
    }
  }
}
