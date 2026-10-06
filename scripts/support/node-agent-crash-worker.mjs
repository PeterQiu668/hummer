import { FileExecutionJournal, canonicalJson, sha256Hex } from '../../apps/node-agent/src/execution-journal.mjs';
import { HummerNodeAgent } from '../../apps/node-agent/src/node-agent.mjs';

const [mode, journalPath] = process.argv.slice(2);
if (!mode || !journalPath) throw new Error('usage: node-agent-crash-worker.mjs <prepare|recover> <journal-path>');

const now = '2026-10-07T00:00:00.000Z';
const scope = { tenantId: 'tenant-chaos', nodeId: 'node-chaos' };
const envelope = {
  tenantId: scope.tenantId,
  targetNodeId: scope.nodeId,
  expiresAt: '2026-10-07T01:00:00.000Z',
  originRef: 'work-chaos',
};
const identity = {
  claimId: 'claim-chaos',
  deliveryId: 'delivery-chaos',
  workOrderId: 'work-chaos',
  envelopeHash: sha256Hex(canonicalJson(envelope)),
};

if (mode === 'prepare') {
  const journal = new FileExecutionJournal({ path: journalPath, clock: () => new Date(now) });
  journal.initialize(scope);
  journal.append({ type: 'claim_accepted', ...identity });
  journal.append({
    type: 'approval_request_recorded', ...identity,
    requestId: 'request-chaos', approvalRequestHash: 'a'.repeat(64),
  });
  journal.append({
    type: 'approval_decision_consumed', ...identity,
    requestId: 'request-chaos', approvalRequestHash: 'a'.repeat(64), approvalDecisionHash: 'b'.repeat(64),
  });
  journal.append({
    type: 'executing', ...identity,
    requestId: 'request-chaos', approvalRequestHash: 'a'.repeat(64), approvalDecisionHash: 'b'.repeat(64),
  });
  process.stdout.write(`${JSON.stringify({ state: 'executing', pid: process.pid })}\n`);
  setInterval(() => {}, 60_000);
} else if (mode === 'recover') {
  let executions = 0;
  const agent = new HummerNodeAgent({
    ...scope,
    heartbeatIntervalMs: 20_000,
    grant: {
      token: 'process-private-grant', tenantId: scope.tenantId, nodeId: scope.nodeId,
      expiresAt: '2026-10-07T01:00:00.000Z', scopes: ['task.claim', 'approval.request', 'task.execute'],
    },
    transport: {
      sendHeartbeat: async () => undefined,
      claimTask: async () => ({ claimId: identity.claimId, deliveryId: identity.deliveryId, envelope }),
      reportClaimStatus: async () => undefined,
      submitRunEvent: async () => undefined,
      submitReceipt: async () => undefined,
      submitApprovalRequest: async () => ({}),
      consumeApprovalDecision: async () => ({}),
    },
    contractValidator: {
      validateNodeManifest: (value) => ({ ok: true, value }),
      validateTaskEnvelope: (value) => ({ ok: true, value }),
      validateApprovalRequest: (value) => ({ ok: true, value }),
      validateApprovalDecision: (value) => ({ ok: true, value }),
      validateRunEvent: (value) => ({ ok: true, value }),
      validateOutcomeReceipt: (value) => ({ ok: true, value }),
    },
    executor: { execute: async () => { executions += 1; return { events: [], receipt: {} }; } },
    journal: new FileExecutionJournal({ path: journalPath, clock: () => new Date(now) }),
    clock: () => new Date(now),
  });
  const poll = await agent.pollOnce();
  const confirm = await agent.confirmAndExecute(identity.claimId);
  process.stdout.write(`${JSON.stringify({ inspection: agent.inspectRecovery(identity.claimId), poll, confirm, executions })}\n`);
} else {
  throw new Error(`unknown mode: ${mode}`);
}
