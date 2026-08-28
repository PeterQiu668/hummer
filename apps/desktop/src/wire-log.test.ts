import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { TextLineDecoder, WireLog } from './wire-log.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('Codex diagnostic wire log', () => {
  it('decodes stderr chunks into complete lines without losing a trailing fragment', () => {
    const decoder = new TextLineDecoder();

    expect(decoder.push('first warning\r\npartial')).toEqual(['first warning']);
    expect(decoder.push(' failure\n')).toEqual(['partial failure']);
    expect(decoder.finish()).toEqual([]);
  });

  it('persists the exact outbound JSON text and stderr lines when explicitly enabled', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-wire-log-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'codex-wire.jsonl');
    const log = new WireLog(path);
    const outbound = '{"id":"hummer-1","method":"initialize","params":{}}';

    log.append('outbound', outbound);
    log.append('stderr', 'server rejected response');

    const entries = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { channel: string; raw: string });
    expect(entries).toMatchObject([
      { channel: 'outbound', raw: outbound },
      { channel: 'stderr', raw: 'server rejected response' },
    ]);
  });

  it('applies the configured secret redactor before any channel reaches disk', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-wire-redaction-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'wire.jsonl');
    const secret = 'runtime-secret-value';
    const log = new WireLog(path, (raw) => raw.replaceAll(secret, '[REDACTED]'));

    log.append('outbound', `Authorization: Bearer ${secret}`);
    log.append('stderr', `provider rejected ${secret}`);

    const persisted = readFileSync(path, 'utf8');
    expect(persisted).not.toContain(secret);
    expect(persisted.match(/\[REDACTED\]/g)).toHaveLength(2);
  });
});
