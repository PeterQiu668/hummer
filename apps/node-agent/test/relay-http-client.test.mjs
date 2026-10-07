import assert from 'node:assert/strict';
import test from 'node:test';

import { RelayClientError, RelayHttpClient } from '../src/relay-http-client.mjs';

const context = { nodeId: 'node-a', tenantId: 'tenant-a', grantToken: 'opaque-task-grant-secret' };

test('rejects plaintext non-loopback Relay endpoints before a badge can be sent', () => {
  assert.throws(
    () => new RelayHttpClient({ baseUrl: 'http://relay.example', badgeToken: 'safe-test-badge' }),
    /Plain HTTP Relay endpoints are allowed only on loopback/,
  );
  assert.throws(
    () => new RelayHttpClient({
      baseUrl: 'https://relay.example',
      badgeToken: 'safe-test-badge',
      reconnect: { maxAttempts: Number.POSITIVE_INFINITY },
    }),
    /positive finite integer/,
  );
});

function jsonResponse(body, status = 200) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

test('uses the injected base URL and opaque badge for Relay operations without exposing it', async () => {
  const badgeToken = 'opaque-secret-badge';
  const requests = [];
  const logs = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/task-grant/')) {
      return jsonResponse({ authorization: {
        grantRef: 'grant:task-1', tenantId: 'tenant-a', workOrderId: 'work-1', nodeId: 'node-a',
        issuedToRunId: 'run-1', capabilities: ['task.execute'], paths: [],
        expiresAt: '2026-10-07T01:00:00.000Z', maxUses: 1, usedCount: 1,
      } });
    }
    if (String(url).endsWith('/tasks/claim')) {
      return jsonResponse({ task: { taskId: 'delivery-1', envelope: { schema: 'hummer.task-envelope' } } });
    }
    if (String(url).endsWith('/approval-requests')) {
      return jsonResponse({ request: { request: { schema: 'hummer.approval-request', requestId: 'request-1' } } });
    }
    if (String(url).endsWith('/decision')) {
      return jsonResponse({ decision: { decisionRecord: { schema: 'hummer.approval-decision', requestId: 'request-1' } } });
    }
    if (String(url).endsWith('/consume')) {
      return jsonResponse({ request: { requestId: 'request-1' }, decision: { requestId: 'request-1' } });
    }
    if (String(url).endsWith('/authorization')) {
      return jsonResponse({
        authorization: {
          state: 'approved', requestId: 'request-1', taskId: 'delivery-1', nodeId: 'node-a',
          expiresAt: '2026-10-07T01:00:00.000Z',
        },
      });
    }
    return jsonResponse({ ok: true });
  };
  const client = new RelayHttpClient({
    baseUrl: 'http://127.0.0.1:3010/', badgeToken, fetch,
    logger: (entry) => logs.push(entry),
  });

  await client.registerNode({ nodeId: 'node-a' }, context);
  await client.sendHeartbeat({ nodeId: 'node-a' }, context);
  const claim = await client.claimTask(context);
  await client.submitRunEvent({ type: 'started' }, context);
  await client.submitRunEvent({ type: 'progress' }, context);
  await client.submitRunEvent({ type: 'completed' }, context);
  await client.submitRunEvent({ type: 'failed' }, context);
  await client.submitApprovalRequest('delivery-1', { requestId: 'request-1' }, context);
  await client.decideApproval('request-1', { requestId: 'request-1' });
  await client.consumeApprovalDecision('delivery-1', 'request-1', context);
  assert.deepEqual(await client.getApprovalAuthorization('delivery-1', 'request-1', context), {
    state: 'approved', requestId: 'request-1', taskId: 'delivery-1', nodeId: 'node-a',
    expiresAt: '2026-10-07T01:00:00.000Z',
  });
  await client.consumeTaskGrant('delivery-1', 'request-1', context);
  await client.checkpointTaskGrant('delivery-1', 'request-1', context);
  await client.stopTask('delivery-2');

  assert.deepEqual(claim, {
    claimId: 'delivery-1', deliveryId: 'delivery-1', envelope: { schema: 'hummer.task-envelope' },
  });
  assert.deepEqual(requests.map((entry) => new URL(entry.url).pathname), [
    '/v1/nodes/register',
    '/v1/nodes/node-a/heartbeat',
    '/v1/nodes/node-a/tasks/claim',
    '/v1/tasks/ack',
    '/v1/tasks/events',
    '/v1/tasks/complete',
    '/v1/tasks/fail',
    '/v1/nodes/node-a/tasks/delivery-1/approval-requests',
    '/v1/approval-requests/request-1/decision',
    '/v1/nodes/node-a/tasks/delivery-1/approval-requests/request-1/consume',
    '/v1/nodes/node-a/tasks/delivery-1/approval-requests/request-1/authorization',
    '/v1/nodes/node-a/tasks/delivery-1/task-grant/consume',
    '/v1/nodes/node-a/tasks/delivery-1/task-grant/checkpoint',
    '/v1/tasks/delivery-2/stop',
  ]);
  assert.ok(requests.every((entry) => entry.init.headers.authorization === `Bearer ${badgeToken}`));
  const grantRequests = requests.filter((entry) => new URL(entry.url).pathname.includes('/task-grant/'));
  assert.equal(grantRequests.length, 2);
  assert.ok(grantRequests.every((entry) => entry.init.headers['x-hummer-task-grant'] === context.grantToken));
  assert.ok(requests.filter((entry) => !grantRequests.includes(entry))
    .every((entry) => entry.init.headers['x-hummer-task-grant'] === undefined));
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(badgeToken));
  assert.doesNotMatch(JSON.stringify(client), new RegExp(badgeToken));
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(context.grantToken));
  assert.doesNotMatch(JSON.stringify(client), new RegExp(context.grantToken));
});

test('401 and 403 failures are terminal and never leak or retry the badge', async () => {
  for (const status of [401, 403]) {
    const badgeToken = `badge-${status}-secret`;
    let attempts = 0;
    const client = new RelayHttpClient({
      baseUrl: 'https://relay.invalid', badgeToken,
      fetch: async () => {
        attempts += 1;
        return jsonResponse({ error: { code: 'denied', message: 'request denied' } }, status);
      },
    });

    await assert.rejects(() => client.claimTask(context), (error) => {
      assert.ok(error instanceof RelayClientError);
      assert.equal(error.statusCode, status);
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.message, new RegExp(badgeToken));
      return true;
    });
    assert.equal(attempts, 1);
  }
});

test('a hostile Relay error cannot reflect the task-grant token into diagnostics', async () => {
  const client = new RelayHttpClient({
    baseUrl: 'https://relay.invalid', badgeToken: 'safe-badge',
    fetch: async () => jsonResponse({
      error: { code: `bad-${context.grantToken}`, message: `rejected ${context.grantToken}` },
    }, 401),
  });

  await assert.rejects(() => client.consumeTaskGrant('delivery-1', 'request-1', context), (error) => {
    assert.ok(error instanceof RelayClientError);
    assert.equal(error.code, 'relay_request_failed');
    assert.doesNotMatch(error.message, new RegExp(context.grantToken));
    assert.match(error.message, /\[REDACTED\]/);
    return true;
  });
});

test('receipt submission fails closed unless node-owned persistence is injected', async () => {
  const client = new RelayHttpClient({
    baseUrl: 'https://relay.invalid', badgeToken: 'safe-badge',
    fetch: async () => { throw new Error('network must not be used'); },
  });
  await assert.rejects(() => client.submitReceipt({ receipt: true }, context), {
    code: 'receipt_transport_unavailable',
  });

  const persisted = [];
  const local = new RelayHttpClient({
    baseUrl: 'https://relay.invalid', badgeToken: 'safe-badge',
    fetch: async () => { throw new Error('network must not be used'); },
    receiptStore: { put: async (value) => { persisted.push(value); } },
  });
  await local.submitReceipt({ receipt: true }, context);
  assert.deepEqual(persisted, [{ receipt: true }]);
});

test('SSE authorization failures stop after one attempt with no reconnect', async () => {
  for (const status of [401, 403]) {
    let attempts = 0;
    const delays = [];
    const client = new RelayHttpClient({
      baseUrl: 'https://relay.invalid', badgeToken: `stream-badge-${status}`,
      fetch: async () => {
        attempts += 1;
        return jsonResponse({ error: { code: 'invalid_token', message: 'denied' } }, status);
      },
      sleep: async (delay) => { delays.push(delay); },
    });
    const stream = client.connectEvents({ nodeId: 'node-a' });

    await assert.rejects(stream.ready, { statusCode: status, retryable: false });
    await assert.rejects(stream.done, { statusCode: status, retryable: false });
    assert.equal(attempts, 1);
    assert.deepEqual(delays, []);
  }
});

test('SSE reconnect uses capped exponential backoff and stops after the configured bound', async () => {
  const delays = [];
  let attempts = 0;
  const client = new RelayHttpClient({
    baseUrl: 'https://relay.invalid', badgeToken: 'safe-test-badge',
    fetch: async () => {
      attempts += 1;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(': connected\n\n'));
          controller.close();
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    },
    sleep: async (delay) => { delays.push(delay); },
    reconnect: { initialDelayMs: 10, maxDelayMs: 20, maxAttempts: 3 },
  });

  const stream = client.connectEvents({ nodeId: 'node-a' });
  await stream.ready;
  await assert.rejects(stream.done, { code: 'relay_reconnect_exhausted' });

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});

test('connectAgent claims task.available but never confirms or executes, and applies stop plus revocation hints', async () => {
  let controller;
  const executions = [];
  const states = [];
  const agent = {
    nodeId: 'node-a',
    pollOnce: async () => { states.push('claimed'); return { state: 'pending_confirmation', claimId: 'delivery-1' }; },
    stopClaim: (claimId) => { states.push(`stopped:${claimId}`); },
    revokeClaim: (claimId, requestId) => { states.push(`revoked:${claimId}:${requestId}`); },
    confirmAndExecute: async () => { executions.push('executed'); },
  };
  const client = new RelayHttpClient({
    baseUrl: 'https://relay.invalid', badgeToken: 'safe-test-badge',
    fetch: async () => new Response(new ReadableStream({
      start(value) {
        controller = value;
        value.enqueue(new TextEncoder().encode(': connected\n\n'));
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  });

  const stream = client.connectAgent(agent);
  await stream.ready;
  controller.enqueue(new TextEncoder().encode('event: task.available\ndata: {"taskId":"delivery-1"}\n\n'));
  controller.enqueue(new TextEncoder().encode('event: task.stop\ndata: {"taskId":"delivery-1"}\n\n'));
  controller.enqueue(new TextEncoder().encode('event: approval.revoked\ndata: {"taskId":"delivery-1","requestId":"request-1"}\n\n'));
  await new Promise((resolve) => setImmediate(resolve));
  stream.close();
  await stream.done;

  assert.deepEqual(states, ['claimed', 'stopped:delivery-1', 'revoked:delivery-1:request-1']);
  assert.equal(executions.length, 0);
});
