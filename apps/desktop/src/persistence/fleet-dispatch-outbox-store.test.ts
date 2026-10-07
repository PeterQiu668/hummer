import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

const directories: string[] = [];
const NOW = '2026-10-07T08:00:00.000Z';

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('transactional Fleet dispatch outbox', () => {
  it('stages before delivery, persists attempts, and returns the same delivered response after reopen', () => {
    const directory = temporaryDirectory();
    const first = openPersistence({ dataDirectory: directory, now: () => new Date(NOW) });
    const identity = first.identity.createCompany({
      companyName: 'Outbox tenant', displayName: 'Owner', email: 'outbox-owner@example.test',
    });
    const tenantId = identity.tenant.id;
    const actorRef = `account:${identity.account.id}`;
    const staged = first.fleetDispatchOutbox.stage({ tenantId, actorRef, envelope: envelope(tenantId), occurredAt: NOW });

    expect(staged).toMatchObject({ status: 'pending', attemptCount: 0, tenantId, actorRef, idempotencyKey: 'delivery-outbox-1' });
    expect(first.fleetDispatchOutbox.listPending(tenantId, actorRef)).toHaveLength(1);
    expect(first.fleetDispatchOutbox.recordAttempt(staged.outboxId, '2026-10-07T08:00:01.000Z')).toMatchObject({ attemptCount: 1 });
    expect(first.fleetDispatchOutbox.recordFailure(staged.outboxId, 'network_error', '2026-10-07T08:00:02.000Z'))
      .toMatchObject({ status: 'pending', lastErrorCode: 'network_error' });
    expect(first.fleetDispatchOutbox.recordAttempt(staged.outboxId, '2026-10-07T08:00:03.000Z')).toMatchObject({ attemptCount: 2 });
    const response = { inserted: false, task: { taskId: 'delivery-outbox-1', tenantId, envelope: envelope(tenantId) } };
    expect(first.fleetDispatchOutbox.recordDelivered(staged.outboxId, response, '2026-10-07T08:00:04.000Z'))
      .toMatchObject({ status: 'delivered', relayTaskId: 'delivery-outbox-1', relayInserted: false, response });
    const converged = first.fleetDispatchOutbox.recordDelivered(staged.outboxId, {
      inserted: true,
      task: { taskId: 'delivery-outbox-1', tenantId, envelope: envelope(tenantId) },
    }, '2026-10-07T08:00:05.000Z');
    expect(converged).toMatchObject({ status: 'delivered', relayInserted: false, deliveredAt: '2026-10-07T08:00:04.000Z' });
    expect(first.fleetDispatchOutbox.listPending(tenantId, actorRef)).toEqual([]);
    first.close();

    const reopened = openPersistence({ dataDirectory: directory, now: () => new Date(NOW) });
    expect(reopened.fleetDispatchOutbox.stage({ tenantId, actorRef, envelope: envelope(tenantId), occurredAt: NOW }))
      .toMatchObject({ status: 'delivered', attemptCount: 2, response });
    reopened.close();
  });

  it('rejects idempotency drift, tenant/actor forgery, unknown fields, and oversized bytes', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory(), now: () => new Date(NOW) });
    const owner = persistence.identity.createCompany({
      companyName: 'Tenant A', displayName: 'Owner A', email: 'outbox-a@example.test',
    });
    const other = persistence.identity.createCompany({
      companyName: 'Tenant B', displayName: 'Owner B', email: 'outbox-b@example.test',
    });
    const tenantId = owner.tenant.id;
    const actorRef = `account:${owner.account.id}`;
    persistence.fleetDispatchOutbox.stage({ tenantId, actorRef, envelope: envelope(tenantId), occurredAt: NOW });

    expect(() => persistence.fleetDispatchOutbox.stage({
      tenantId, actorRef, envelope: envelope(tenantId, { targetNodeId: 'node-other' }), occurredAt: NOW,
    })).toThrow('idempotency key was reused');
    expect(() => persistence.fleetDispatchOutbox.stage({
      tenantId, actorRef: `account:${other.account.id}`, envelope: envelope(tenantId, { idempotencyKey: 'delivery-other-actor' }), occurredAt: NOW,
    })).toThrow('not an active tenant member');
    expect(() => persistence.fleetDispatchOutbox.stage({
      tenantId, actorRef, envelope: envelope(other.tenant.id, { idempotencyKey: 'delivery-foreign' }), occurredAt: NOW,
    })).toThrow('tenant does not match');
    expect(persistence.fleetDispatchOutbox.stage({
      tenantId: other.tenant.id,
      actorRef: `account:${other.account.id}`,
      envelope: envelope(other.tenant.id),
      occurredAt: NOW,
    })).toMatchObject({ tenantId: other.tenant.id, idempotencyKey: 'delivery-outbox-1' });
    expect(persistence.fleetDispatchOutbox.listPending(tenantId, actorRef)).toHaveLength(1);
    expect(persistence.fleetDispatchOutbox.listPending(other.tenant.id, `account:${other.account.id}`)).toHaveLength(1);
    expect(() => persistence.fleetDispatchOutbox.stage({
      tenantId, actorRef, envelope: { ...envelope(tenantId, { idempotencyKey: 'delivery-unknown' }), badgeToken: 'forbidden' }, occurredAt: NOW,
    })).toThrow('unknown field');
    expect(() => persistence.fleetDispatchOutbox.stage({
      tenantId, actorRef, envelope: envelope(tenantId, {
        idempotencyKey: 'delivery-large', workOrderTask: {
          ...workOrderTask(), target: 'x'.repeat(32_768), expectedDeliverable: 'y'.repeat(32_768),
        },
      }), occurredAt: NOW,
    })).toThrow('exceeds the persistence limit');
    expect(() => persistence.fleetDispatchOutbox.stage({
      tenantId, actorRef, envelope: { ...envelope(tenantId, { idempotencyKey: 'delivery-invalid-nested' }), workOrderTask: { schema: 'hummer.work-order-task', version: 1 } }, occurredAt: NOW,
    })).toThrow('WorkOrderTask title is invalid');
    persistence.close();
  });

  it('terminalizes a rejected delivery without deleting its retained payload', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory(), now: () => new Date(NOW) });
    const identity = persistence.identity.createCompany({
      companyName: 'Rejected outbox tenant', displayName: 'Owner', email: 'outbox-rejected@example.test',
    });
    const tenantId = identity.tenant.id;
    const actorRef = `account:${identity.account.id}`;
    const staged = persistence.fleetDispatchOutbox.stage({ tenantId, actorRef, envelope: envelope(tenantId), occurredAt: NOW });

    const rejected = persistence.fleetDispatchOutbox.recordRejected(
      staged.outboxId, 'task_expired', '2026-10-07T08:00:01.000Z',
    );
    expect(rejected).toMatchObject({
      status: 'rejected', lastErrorCode: 'task_expired', rejectedAt: '2026-10-07T08:00:01.000Z',
      envelopeSha256: staged.envelopeSha256,
    });
    expect(persistence.fleetDispatchOutbox.listPending(tenantId, actorRef)).toEqual([]);
    expect(() => persistence.fleetDispatchOutbox.recordAttempt(staged.outboxId, '2026-10-07T08:00:02.000Z'))
      .toThrow('not pending');
    expect(() => persistence.fleetDispatchOutbox.recordDelivered(staged.outboxId, {
      inserted: false, task: { taskId: 'delivery-outbox-1', tenantId, envelope: envelope(tenantId) },
    }, '2026-10-07T08:00:02.000Z')).toThrow('is rejected');
    persistence.close();
  });
});

function envelope(tenantId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'hummer.task-envelope', version: 1, workOrderTask: workOrderTask(), tenantId,
    targetNodeId: 'node-a', targetRuntime: 'codex', idempotencyKey: 'delivery-outbox-1',
    leaseMs: 30_000, approvalPolicyRef: 'policy-human-confirmation',
    expiresAt: '2026-10-07T09:00:00.000Z', originRef: 'work-outbox-1', ...overrides,
  };
}

function workOrderTask(): Record<string, unknown> {
  return {
    schema: 'hummer.work-order-task', version: 1, title: 'Outbox task',
    target: 'Prove durable delivery', expectedDeliverable: 'outputs/outbox.md',
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-fleet-outbox-'));
  directories.push(directory);
  return directory;
}
