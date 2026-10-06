import assert from 'node:assert/strict';
import test from 'node:test';

import { probeAllRuntimes, probeRuntime, selectResolvedPath } from '../src/runtime-probes.mjs';

test('keeps Windows PATH precedence instead of preferring a later executable', () => {
  const selected = selectResolvedPath([
    'C:\\npm\\codex',
    'C:\\npm\\codex.cmd',
    'C:\\app\\codex.exe',
  ], 'win32');

  assert.equal(selected, 'C:\\npm\\codex.cmd');
});

test('reports a missing runtime with an explicit missing status and null path/version', async () => {
  const result = await probeRuntime(
    { provider: 'codex' },
    { resolve: async () => null, version: async () => assert.fail('version must not run') },
  );

  assert.deepEqual(result, {
    provider: 'codex',
    executable: 'codex',
    status: 'missing',
    path: null,
    version: null,
    detail: 'Executable was not found on PATH',
  });
});

test('rejects an unknown provider instead of probing an arbitrary command', async () => {
  await assert.rejects(
    // @ts-expect-error exercises an untrusted JavaScript caller.
    () => probeRuntime({ provider: 'powershell' }, { resolve: async () => null, version: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }),
    { code: 'unsupported_provider' },
  );
});

test('requires an explicit executable for cli-other', async () => {
  await assert.rejects(
    () => probeRuntime({ provider: 'cli-other' }, { resolve: async () => null, version: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }),
    { code: 'invalid_probe_request' },
  );
});

test('probes all four runtime classes without hiding a failed version check', async () => {
  const paths = new Map([
    ['codex', 'C:\\bin\\codex.cmd'],
    ['claude', 'C:\\bin\\claude.exe'],
    ['other-agent', 'C:\\bin\\other-agent.exe'],
  ]);
  const runner = {
    resolve: async (name) => paths.get(name) ?? null,
    version: async (path) => path.includes('claude')
      ? { exitCode: 2, stdout: '', stderr: 'broken install' }
      : { exitCode: 0, stdout: `${path} 1.2.3\n`, stderr: '' },
  };

  const results = await probeAllRuntimes({ cliOtherExecutable: 'other-agent' }, runner);

  assert.equal(results.length, 4);
  assert.deepEqual(results.map((item) => item.provider), ['codex', 'claude', 'deepseek', 'cli-other']);
  assert.equal(results[0].status, 'available');
  assert.equal(results[1].status, 'unavailable');
  assert.match(results[1].detail, /exit code 2/i);
  assert.equal(results[2].status, 'missing');
  assert.equal(results[3].path, 'C:\\bin\\other-agent.exe');
});
