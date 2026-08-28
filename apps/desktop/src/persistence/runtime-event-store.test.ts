import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';
import type { PersistableRuntimeEvent } from './runtime-event-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('RuntimeEvent persistence', () => {
  it('retains a session plan and handle across event updates and database reopen', () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory });
    persistence.runtimeEvents.saveSession({
      sessionId: 'ses_descriptor',
      tenantId: 'tenant_demo',
      runtimeId: 'codex-cli',
      workOrderId: 'wo_descriptor',
      startedAt: '2026-08-28T03:00:00.000Z',
      plan: { id: 'plan_1', prompt: 'persist me' },
      handle: { runtimeId: 'codex-cli', sessionId: 'ses_descriptor', nativeSessionId: 'thread_1' },
    });
    persistence.runtimeEvents.save({
      sessionId: 'ses_descriptor', sequence: 1, occurredAt: '2026-08-28T03:00:01.000Z', actorRef: 'system:desktop',
      type: 'status', status: 'running', evidenceRefs: [],
    }, { tenantId: 'tenant_demo', runtimeId: 'codex-cli', correlationId: 'corr_descriptor', workOrderId: 'wo_descriptor' });
    persistence.close();

    const reopened = openPersistence({ dataDirectory: directory });
    expect(reopened.runtimeEvents.listSessions()).toEqual([expect.objectContaining({
      sessionId: 'ses_descriptor',
      plan: { id: 'plan_1', prompt: 'persist me' },
      handle: { runtimeId: 'codex-cli', sessionId: 'ses_descriptor', nativeSessionId: 'thread_1' },
    })]);
    reopened.close();
  });

  it('persists an event before exposing it through the replay query', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const event: PersistableRuntimeEvent = {
      sessionId: 'ses_runtime_001',
      sequence: 1,
      occurredAt: '2026-08-28T03:00:00.000Z',
      actorRef: 'employee:analyst',
      type: 'tool',
      status: 'completed',
      title: '读取线索文件',
      tool: 'shell.command',
      args: { command: 'Get-Content leads.csv' },
      result: '读取 12 条线索',
      durationMs: 420,
      costCny: null,
      evidenceRefs: [],
    };

    persistence.runtimeEvents.save(event, {
      tenantId: 'tenant_demo',
      runtimeId: 'codex-cli',
      correlationId: 'corr_runtime_001',
    });

    expect(persistence.runtimeEvents.listBySession(event.sessionId)).toEqual([event]);
    expect(persistence.runtimeEvents.listBySession(event.sessionId, { afterSequence: 1 })).toEqual([]);
    expect(persistence.verifyDomainEventIntegrity()).toEqual({ valid: true, checked: 1 });
    persistence.close();
  });

  it('is idempotent for an identical session sequence and rejects conflicting replay data', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const event: PersistableRuntimeEvent = {
      sessionId: 'ses_runtime_002',
      sequence: 7,
      occurredAt: '2026-08-28T03:10:00.000Z',
      actorRef: 'human:owner',
      type: 'approval_required',
      approvalId: 'apr_001',
      title: '写回 CRM',
      message: '该操作将更新外部系统',
      tool: 'crm.update',
      args: { count: 3 },
      result: '等待审批',
      durationMs: null,
      costCny: null,
      evidenceRefs: ['evidence://sha256/abc'],
    };
    const options = { tenantId: 'tenant_demo', runtimeId: 'codex-cli', correlationId: 'corr_runtime_002' };

    persistence.runtimeEvents.save(event, options);
    persistence.runtimeEvents.save(event, options);

    expect(persistence.runtimeEvents.listBySession(event.sessionId)).toHaveLength(1);
    expect(persistence.listApprovals(event.sessionId)).toMatchObject([
      { id: 'apr_001', status: 'pending', sessionId: event.sessionId, sequence: 7 },
    ]);
    expect(() => persistence.runtimeEvents.save({ ...event, result: '冲突内容' }, options)).toThrow(/conflicting runtime event/i);
    persistence.close();
  });

  it('reconstructs persisted session, approval and result projections after reopen', () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory });
    const options = { tenantId: 'tenant_demo', runtimeId: 'codex-cli', correlationId: 'corr_restart' };

    persistence.runtimeEvents.save({
      sessionId: 'ses_restart', sequence: 1, occurredAt: '2026-08-27T04:00:00.000Z', actorRef: 'system:desktop',
      type: 'status', status: 'running', evidenceRefs: [],
    }, options);
    persistence.runtimeEvents.save({
      sessionId: 'ses_restart', sequence: 2, occurredAt: '2026-08-27T04:00:01.000Z', actorRef: 'employee:analyst',
      type: 'approval_required', approvalId: 'apr_restart', title: '发布报告', message: '等待负责人确认',
      tool: 'workspace.patch', args: { path: 'report.md' }, result: '等待审批', durationMs: null, costCny: null,
      evidenceRefs: [],
    }, options);
    persistence.runtimeEvents.save({
      sessionId: 'ses_restart', sequence: 3, occurredAt: '2026-08-27T04:00:02.000Z', actorRef: 'human:owner',
      type: 'approval_resolved', approvalId: 'apr_restart', approved: true, result: '已批准', evidenceRefs: [],
    }, options);
    persistence.runtimeEvents.save({
      sessionId: 'ses_restart', sequence: 4, occurredAt: '2026-08-27T04:00:03.000Z', actorRef: 'employee:analyst',
      type: 'result', title: '周报', summary: '已完成', deliverables: [{ name: 'report.md', kind: 'report' }],
      evidenceRefs: [], durationMs: 1000, costCny: null, rollback: { supported: true },
    }, options);
    persistence.close();

    const reopened = openPersistence({ dataDirectory: directory });
    expect(reopened.runtimeEvents.listBySession('ses_restart')).toHaveLength(4);
    expect(reopened.getSession('ses_restart')).toMatchObject({ status: 'delivered', runtimeId: 'codex-cli' });
    expect(reopened.listApprovals('ses_restart')).toMatchObject([{ id: 'apr_restart', status: 'approved' }]);
    expect(reopened.listResultPackages('ses_restart')).toMatchObject([{ sessionId: 'ses_restart', status: 'delivered' }]);
    reopened.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-runtime-store-'));
  temporaryDirectories.push(directory);
  return directory;
}
