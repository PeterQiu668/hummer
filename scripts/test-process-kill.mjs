import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const worker = resolve(import.meta.dirname, 'support', 'node-agent-crash-worker.mjs');

function waitForLine(child, timeoutMs) {
  return new Promise((resolveLine, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('worker did not become ready before timeout')), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline >= 0) {
        clearTimeout(timer);
        resolveLine(output.slice(0, newline));
      }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      if (!output.includes('\n')) { clearTimeout(timer); reject(new Error(`worker exited before ready: ${code}`)); }
    });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => reject(new Error('worker did not exit before timeout')), timeoutMs);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolveExit({ code, signal }); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function runRecovery(journalPath) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [worker, 'recover', journalPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) reject(new Error(`recovery worker failed (${code}): ${stderr}`));
      else resolveResult(JSON.parse(stdout.trim()));
    });
  });
}

test('a forcibly killed node restarts recovery-required within 30 seconds and never re-executes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-process-kill-'));
  const journalPath = join(directory, 'execution.jsonl');
  try {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [worker, 'prepare', journalPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const ready = JSON.parse(await waitForLine(child, 5_000));
    assert.equal(ready.state, 'executing');
    assert.equal(ready.pid, child.pid);
    assert.equal(child.kill('SIGKILL'), true);
    const stopped = await waitForExit(child, 5_000);
    assert.notEqual(stopped.code, 0);

    const recovered = await runRecovery(journalPath);
    assert.equal(recovered.inspection.requiresDecision, true);
    assert.equal(recovered.inspection.journalStage, 'executing');
    assert.deepEqual(recovered.poll, { state: 'recovery_required', claimId: 'claim-chaos' });
    assert.deepEqual(recovered.confirm, { state: 'recovery_required', claimId: 'claim-chaos' });
    assert.equal(recovered.executions, 0);
    assert.ok(Date.now() - startedAt < 30_000);
    assert.doesNotMatch(readFileSync(journalPath, 'utf8'), /process-private-grant/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
