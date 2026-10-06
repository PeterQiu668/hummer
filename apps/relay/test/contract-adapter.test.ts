import { describe, expect, it } from 'vitest';
import { createSharedFleetValidators } from '../src/contract-adapter.js';

const manifest = {
  schema: 'hummer.node-manifest', version: 1, nodeId: 'node-main', tenantIds: ['tenant-a'],
  platform: 'win32', agentVersion: '0.1.0',
  runtimes: [{ kind: 'codex', available: false, pinnedVersion: '0.153.4', probeError: 'version mismatch' }],
  capabilities: ['workspace.exec'],
  mcp: { endpoint: 'stdio://hummer-local', tools: ['workspace_exec'] },
  load: { running: 0, queued: 1 },
} as const;

const envelope = {
  schema: 'hummer.task-envelope', version: 1,
  workOrderTask: {
    schema: 'hummer.work-order-task', version: 1, title: 'Prepare report',
    target: 'Prepare a report', expectedDeliverable: 'outputs/report.md',
  },
  tenantId: 'tenant-a', targetNodeId: 'node-main', targetRuntime: 'codex',
  idempotencyKey: 'delivery-001', leaseMs: 30_000,
  approvalPolicyRef: 'policy-deny-by-default',
  expiresAt: '2026-10-07T01:00:00Z', originRef: 'work-order-001',
} as const;

describe('shared fleet contract adapter', () => {
  it('projects a validated manifest for registration and heartbeat', () => {
    const validators = createSharedFleetValidators();
    expect(validators.nodeManifest.validate(manifest)).toMatchObject({
      ok: true,
      meta: { nodeId: 'node-main', tenantIds: ['tenant-a'], agentVersion: '0.1.0' },
    });
    expect(validators.heartbeat.validate(manifest)).toMatchObject({
      ok: true,
      meta: { nodeId: 'node-main', running: 0 },
    });
  });

  it('derives a retry-safe relay task id from the envelope idempotency key', () => {
    const result = createSharedFleetValidators().taskEnvelope.validate(envelope);
    expect(result).toMatchObject({
      ok: true,
      meta: {
        taskId: 'delivery-001',
        workOrderId: 'work-order-001',
        tenantId: 'tenant-a',
      },
    });
  });

  it('rejects unknown contract fields before projecting routing claims', () => {
    const result = createSharedFleetValidators().taskEnvelope.validate({
      ...envelope,
      autoApprove: true,
    });
    expect(result).toMatchObject({ ok: false });
  });
});
