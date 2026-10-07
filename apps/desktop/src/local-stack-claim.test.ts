import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { consumeLocalStackClaimClient } from './local-stack-claim.js';

const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
});

describe('Desktop local stack identity claim', () => {
  it('is absent by default and consumes both environment entries when enabled', async () => {
    expect(consumeLocalStackClaimClient({})).toBeNull();
    const token = `claim_${randomBytes(32).toString('base64url')}`;
    const pipeName = localPipe('success');
    const requests: unknown[] = [];
    await listen(createServer((socket) => {
      let input = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        input += chunk;
        if (!input.includes('\n')) return;
        const request = JSON.parse(input.trim());
        requests.push(request);
        socket.end(`${JSON.stringify({
          schema: 'hummer.local-stack-claim-result', version: 1,
          identity: request.identity,
          relay: {
            baseUrl: 'http://127.0.0.1:4317/', badgeToken: 'control-badge-value',
            tenantId: request.identity.tenantId, actorRef: request.identity.actorRef,
          },
        })}\n`);
      });
    }), pipeName);
    const environment = {
      HUMMER_LOCAL_STACK_CLAIM_PIPE: pipeName,
      HUMMER_LOCAL_STACK_CLAIM_TOKEN: token,
    };
    const client = consumeLocalStackClaimClient(environment)!;
    expect(environment.HUMMER_LOCAL_STACK_CLAIM_PIPE).toBeUndefined();
    expect(environment.HUMMER_LOCAL_STACK_CLAIM_TOKEN).toBeUndefined();
    await expect(client.claim({ tenantId: 'tenant-a', actorRef: 'account:owner-a' })).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:4317/', badgeToken: 'control-badge-value',
      tenantId: 'tenant-a', actorRef: 'account:owner-a',
    });
    expect(requests).toEqual([{
      command: 'claim', auth: token, identity: { tenantId: 'tenant-a', actorRef: 'account:owner-a' },
    }]);
    await expect(client.claim({ tenantId: 'tenant-b', actorRef: 'account:owner-b' }))
      .rejects.toMatchObject({ code: 'identity_already_bound' });
  });

  it('rejects incomplete, nonlocal, mismatched, and secret-echoing responses', async () => {
    expect(() => consumeLocalStackClaimClient({ HUMMER_LOCAL_STACK_CLAIM_PIPE: localPipe('missing') }))
      .toThrow('incomplete');
    expect(() => consumeLocalStackClaimClient({
      HUMMER_LOCAL_STACK_CLAIM_PIPE: 'tcp://127.0.0.1:1234',
      HUMMER_LOCAL_STACK_CLAIM_TOKEN: 'x'.repeat(32),
    })).toThrow('not local');

    const token = `claim_${randomBytes(32).toString('base64url')}`;
    const pipeName = localPipe('negative');
    let calls = 0;
    await listen(createServer((socket) => {
      let input = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        input += chunk;
        if (!input.includes('\n')) return;
        calls += 1;
        if (calls === 1) {
          socket.end(`${JSON.stringify({
            schema: 'hummer.local-stack-claim-result', version: 1,
            identity: { tenantId: 'tenant-other', actorRef: 'account:owner-a' },
            relay: { baseUrl: 'http://127.0.0.1:1/', badgeToken: 'x', tenantId: 'tenant-other', actorRef: 'account:owner-a' },
          })}\n`);
        } else {
          socket.end(`${JSON.stringify({ error: { code: 'claim_rejected', message: `do not echo ${token}` } })}\n`);
        }
      });
    }), pipeName);
    const client = consumeLocalStackClaimClient({
      HUMMER_LOCAL_STACK_CLAIM_PIPE: pipeName,
      HUMMER_LOCAL_STACK_CLAIM_TOKEN: token,
    })!;
    await expect(client.claim({ tenantId: 'tenant-a', actorRef: 'account:owner-a' }))
      .rejects.toMatchObject({ code: 'claim_identity_mismatch' });
    let failure: unknown;
    try { await client.claim({ tenantId: 'tenant-a', actorRef: 'account:owner-a' }); } catch (error) { failure = error; }
    expect((failure as Error).message).not.toContain(token);
    expect((failure as Error).message).toContain('[redacted]');
  });
});

function localPipe(_suffix: string): string {
  const id = randomBytes(12).toString('hex');
  return process.platform === 'win32' ? `\\\\.\\pipe\\hummer-local-${id}` : join(tmpdir(), `hummer-local-${id}.sock`);
}

function listen(server: ReturnType<typeof createServer>, pipeName: string): Promise<void> {
  servers.add(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipeName, () => { server.off('error', reject); resolve(); });
  });
}
