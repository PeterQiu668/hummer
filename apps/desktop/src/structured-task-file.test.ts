import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPersistence } from './persistence/database.js';
import { isStructuredTaskFile, MAX_STRUCTURED_TASK_BYTES, parseStructuredTaskFile } from './structured-task-file.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

const valid = {
  schema: 'hummer.work-order-task',
  version: 1,
  title: '整理九月华东订单',
  target: '汇总订单并标出逾期项',
  expectedDeliverable: '订单汇总表与逾期清单',
  assignee: '销售运营分身',
  dueAt: '2026-10-10T18:00:00+08:00',
  attachmentNames: ['orders/九月订单.xlsx'],
  origin: { system: 'agent-hub', device: 'desktop-37dld71', taskId: 'task-20261006-001' },
};

function bytes(value: unknown): Uint8Array {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

describe('structured task file', () => {
  it('recognizes only the dedicated suffix', () => {
    expect(isStructuredTaskFile('inbox/a.hummer-task.json')).toBe(true);
    expect(isStructuredTaskFile('inbox/A.HUMMER-TASK.JSON')).toBe(true);
    expect(isStructuredTaskFile('inbox/a.json')).toBe(false);
    expect(isStructuredTaskFile('inbox/a.hummer-task.json.part')).toBe(false);
  });

  it('maps every structured field instead of the fixed folder defaults', () => {
    const result = parseStructuredTaskFile(bytes(valid));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      title: '整理九月华东订单',
      assignee: '销售运营分身',
      dueAt: '2026-10-10T10:00:00.000Z',
      attachmentNames: ['orders/九月订单.xlsx'],
      executable: true,
      structuredTask: true,
      origin: { system: 'agent-hub', device: 'desktop-37dld71', taskId: 'task-20261006-001' },
    });
    expect(result.payload.prompt).toContain('汇总订单并标出逾期项');
  });

  it('applies the same defaults as the form entry when optional fields are absent', () => {
    const { schema, version, title, target, expectedDeliverable } = valid;
    const result = parseStructuredTaskFile(bytes({ schema, version, title, target, expectedDeliverable }));
    expect(result.ok && result.payload).toMatchObject({ assignee: '自动推荐', dueAt: null, attachmentNames: [] });
  });

  it('accepts a UTF-8 byte order mark written by Windows tools', () => {
    expect(parseStructuredTaskFile(bytes(`\uFEFF${JSON.stringify(valid)}`)).ok).toBe(true);
  });

  it.each([
    ['invalid JSON', '{ not json', '不是有效的 JSON'],
    ['top-level array', [], '顶层必须是 JSON 对象'],
    ['wrong schema', { ...valid, schema: 'other' }, 'schema 必须是'],
    ['wrong version', { ...valid, version: 2 }, 'version 必须是 1'],
    ['unknown field', { ...valid, autoConfirm: true }, '未支持的字段：autoConfirm'],
    ['missing title', { ...valid, title: '  ' }, 'title 必填'],
    ['bad dueAt', { ...valid, dueAt: '下周五' }, 'dueAt 必须是 ISO 8601'],
    ['absolute attachment', { ...valid, attachmentNames: ['C:\\secret.xlsx'] }, '相对路径'],
    ['escaping attachment', { ...valid, attachmentNames: ['../secret.xlsx'] }, '相对路径'],
    ['unknown origin field', { ...valid, origin: { system: 'agent-hub', token: 'x' } }, 'origin 包含未支持的字段'],
  ])('fails closed with an explicit reason: %s', (_name, input, reason) => {
    const result = parseStructuredTaskFile(bytes(input));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(reason);
  });

  it('rejects oversized files before parsing', () => {
    const result = parseStructuredTaskFile(new Uint8Array(MAX_STRUCTURED_TASK_BYTES + 1));
    expect(result).toMatchObject({ ok: false });
  });

  it('lands as a pending intake that still needs a human, and invalid files cannot be confirmed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-structured-task-'));
    directories.push(directory);
    const persistence = openPersistence({ dataDirectory: directory });
    const owner = persistence.identity.createCompany({ companyName: '结构化派活企业', displayName: '负责人', email: 'structured@example.test' });
    const actorRef = 'system:inbox-watcher';
    const parsed = parseStructuredTaskFile(bytes(valid));
    if (!parsed.ok) throw new Error(parsed.error);

    const accepted = persistence.workOrderIntakes.intake({
      tenantId: owner.tenant.id, source: 'folder', externalRef: 'folder:inbox/a.hummer-task.json:sha-a', actorRef,
      receivedAt: '2026-10-06T08:00:00.000Z', payloadBytes: bytes(valid), payloadMediaType: 'application/json',
      payloadName: 'inbox/a.hummer-task.json', payload: parsed.payload,
    });
    expect(accepted).toMatchObject({ status: 'pending', workOrderId: null, payload: { assignee: '销售运营分身' } });
    expect(persistence.runtimeEvents.listSessions().filter((session) => session.tenantId === owner.tenant.id)).toHaveLength(0);

    const rejected = persistence.workOrderIntakes.intake({
      tenantId: owner.tenant.id, source: 'folder', externalRef: 'folder:inbox/b.hummer-task.json:sha-b', actorRef,
      receivedAt: '2026-10-06T08:01:00.000Z', payloadBytes: bytes('{'), payloadMediaType: 'application/json',
      payloadName: 'inbox/b.hummer-task.json',
      payload: {
        title: '无法解析的结构化任务：inbox/b.hummer-task.json', target: '修正任务文件后重新投递', expectedDeliverable: '无',
        assignee: '自动推荐', dueAt: null, attachmentNames: ['inbox/b.hummer-task.json'], prompt: '无效，未执行。',
        executable: false, preReadError: '结构化任务文件无效：不是有效的 JSON',
      },
    });
    expect(() => persistence.workOrderIntakes.confirm(owner.tenant.id, rejected.id, actorRef, '2026-10-06T08:02:00.000Z')).toThrow();
    expect(persistence.verifyDomainEventIntegrity()).toMatchObject({ valid: true });
    persistence.close();
  });
});
