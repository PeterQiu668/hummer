import type { ControlledWriteResult, ControlledWriteStore } from './controlled-write-store.js';
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
}
