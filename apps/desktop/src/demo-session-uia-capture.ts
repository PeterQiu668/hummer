import type { DesktopPersistence, DemoSessionV1 } from './persistence/index.js';
import { WindowsUiaCaptureAdapter } from './windows-uia-capture.js';

export interface DemoSessionUiaCaptureInput {
  tenantId: string;
  sessionId: string;
  processId: number;
  windowTitle: string;
}

export type DemoSessionUiaCaptureResult =
  | {
      accepted: true;
      processId: number;
      app: string;
      window: string;
      capturedRecords: number;
      session: DemoSessionV1;
    }
  | {
      accepted: false;
      reason: 'paused' | 'ended' | 'outside_source_boundary';
      capturedRecords: 0;
      session: DemoSessionV1;
    };

/** Connects the one-shot OS adapter to the sole DemoSession persistence port. */
export class DemoSessionUiaCaptureService {
  constructor(
    private readonly persistence: DesktopPersistence,
    private readonly adapter = new WindowsUiaCaptureAdapter(),
  ) {}

  async capture(input: DemoSessionUiaCaptureInput): Promise<DemoSessionUiaCaptureResult> {
    const before = this.persistence.demoSessions.get(input.tenantId, input.sessionId);
    if (before.status === 'paused' || before.status === 'ended') {
      return { accepted: false, reason: before.status, capturedRecords: 0, session: before };
    }
    const snapshot = await this.adapter.capture({
      processId: input.processId,
      windowTitle: input.windowTitle,
      sourceBoundary: before.sourceBoundary,
    });
    const results = this.persistence.demoSessions.ingestBatch({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      app: snapshot.app,
      window: snapshot.window,
      metadata: snapshot.nodes.map((node) => ({ kind: 'ax-node' as const, ...node })),
    });
    const rejected = results.find((result) => !result.accepted);
    const session = this.persistence.demoSessions.get(input.tenantId, input.sessionId);
    if (rejected && !rejected.accepted) {
      return { accepted: false, reason: rejected.reason, capturedRecords: 0, session };
    }
    return {
      accepted: true,
      processId: snapshot.processId,
      app: snapshot.app,
      window: snapshot.window,
      capturedRecords: results.length,
      session,
    };
  }
}
