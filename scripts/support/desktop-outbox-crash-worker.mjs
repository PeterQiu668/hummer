import { openPersistence } from '../../apps/desktop/dist/persistence/index.js';

const [mode, dataDirectory, tenantId, actorRef] = process.argv.slice(2);
const now = new Date('2026-10-07T08:00:00.000Z');

if (!mode || !dataDirectory) {
  throw new Error('usage: desktop-outbox-crash-worker.mjs <prepare|recover> <data-directory> [tenant-id actor-ref]');
}

if (mode === 'prepare') {
  const persistence = openPersistence({ dataDirectory, now: () => now });
  const context = persistence.identity.createCompany({
    companyName: 'Outbox crash tenant',
    displayName: 'Owner',
    email: 'outbox-crash@example.test',
  });
  const identity = { tenantId: context.tenant.id, actorRef: `account:${context.account.id}` };
  const envelope = {
    schema: 'hummer.task-envelope',
    version: 1,
    workOrderTask: {
      schema: 'hummer.work-order-task',
      version: 1,
      title: 'Crash durable dispatch',
      target: 'Survive an abrupt process termination',
      expectedDeliverable: 'outputs/outbox-crash.md',
    },
    tenantId: identity.tenantId,
    targetNodeId: 'node-crash-gate',
    targetRuntime: 'codex',
    idempotencyKey: 'delivery-outbox-process-kill',
    leaseMs: 30_000,
    approvalPolicyRef: 'policy-human-confirmation',
    expiresAt: '2026-10-07T09:00:00.000Z',
    originRef: 'work-outbox-process-kill',
  };
  const staged = persistence.fleetDispatchOutbox.stage({
    ...identity,
    envelope,
    occurredAt: now.toISOString(),
  });
  process.stdout.write(`${JSON.stringify({ ...identity, outboxId: staged.outboxId, envelopeSha256: staged.envelopeSha256 })}\n`);
  setInterval(() => {}, 60_000);
} else if (mode === 'recover') {
  if (!tenantId || !actorRef) throw new Error('recover mode requires tenant-id and actor-ref');
  const persistence = openPersistence({ dataDirectory, now: () => now });
  const pending = persistence.fleetDispatchOutbox.listPending(tenantId, actorRef);
  process.stdout.write(`${JSON.stringify({ schemaVersion: persistence.schemaVersion(), pending })}\n`);
  persistence.close();
} else {
  throw new Error(`unknown mode ${mode}`);
}
