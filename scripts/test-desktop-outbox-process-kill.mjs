import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const worker = resolve(import.meta.dirname, 'support', 'desktop-outbox-crash-worker.mjs');

test('a committed Desktop fleet outbox item survives an abrupt process kill', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-desktop-outbox-kill-'));
  try {
    const child = spawn(process.execPath, [worker, 'prepare', directory], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const staged = JSON.parse(await firstLine(child, 10_000));
    assert.match(staged.outboxId, /^outbox-/);
    assert.match(staged.envelopeSha256, /^[a-f0-9]{64}$/);
    assert.equal(child.kill('SIGKILL'), true);
    const stopped = await waitForExit(child, 10_000);
    assert.notEqual(stopped.code, 0);

    const recovered = await runWorker(['recover', directory, staged.tenantId, staged.actorRef]);
    assert.equal(recovered.schemaVersion, 16);
    assert.equal(recovered.pending.length, 1);
    assert.deepEqual(
      {
        outboxId: recovered.pending[0].outboxId,
        status: recovered.pending[0].status,
        attemptCount: recovered.pending[0].attemptCount,
        envelopeSha256: recovered.pending[0].envelopeSha256,
      },
      {
        outboxId: staged.outboxId,
        status: 'pending',
        attemptCount: 0,
        envelopeSha256: staged.envelopeSha256,
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function firstLine(child, timeoutMs) {
  return new Promise((resolveLine, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`worker did not stage before timeout: ${stderr}`)), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline >= 0) {
        clearTimeout(timer);
        resolveLine(stdout.slice(0, newline));
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      if (!stdout.includes('\n')) {
        clearTimeout(timer);
        reject(new Error(`worker exited before staging (${code}): ${stderr}`));
      }
    });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => reject(new Error('worker did not exit before timeout')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function runWorker(args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [worker, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker failed (${code}): ${stderr}`));
      else resolveResult(JSON.parse(stdout.trim()));
    });
  });
}
