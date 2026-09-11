import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPersistence } from './database.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('work order intake fact source', () => {
  it('keeps an unconfirmed folder order pending, durable, tenant-scoped and non-executing', () => {
    const directory = temporaryDirectory();
    const first = openPersistence({ dataDirectory: directory });
    const companyA = first.identity.createCompany({ companyName: '订单企业 A', displayName: '负责人 A', email: 'intake-a@example.test' });
    const companyB = first.identity.createCompany({ companyName: '订单企业 B', displayName: '负责人 B', email: 'intake-b@example.test' });
    const pending = first.workOrderIntakes.intake({
      tenantId: companyA.tenant.id,
      source: 'folder',
      externalRef: 'folder:orders.xlsx:sha256-1',
      payload: {
        title: '处理 orders.xlsx', target: '提取订单并生成交付摘要', expectedDeliverable: '订单摘要',
        assignee: '自动推荐', dueAt: null, attachmentNames: ['orders.xlsx'], prompt: '使用 doc.extract 读取 orders.xlsx 并生成摘要',
      },
      payloadBytes: Buffer.from('xlsx bytes'),
      payloadMediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      payloadName: 'orders.xlsx',
      actorRef: `account:${companyA.account.id}`,
      receivedAt: '2026-09-12T01:00:00.000Z',
    });

    expect(pending).toMatchObject({ source: 'folder', status: 'pending', workOrderId: null });
    expect(pending.payloadEvidenceRef).toMatch(/^evidence:\/\/sha256\/[a-f0-9]{64}$/);
    expect(first.workOrderIntakes.list(companyA.tenant.id)).toHaveLength(1);
    expect(first.workOrderIntakes.list(companyB.tenant.id)).toHaveLength(0);
    expect(first.runtimeEvents.listSessions().filter((session) => session.tenantId === companyA.tenant.id)).toHaveLength(0);
    expect(first.tools.listInvocations(companyA.tenant.id, 'any')).toHaveLength(0);
    expect(first.listDomainEvents(companyA.session.token).map((event) => event.type)).toContain('work_order_intake.received');
    expect(first.verifyDomainEventIntegrity()).toMatchObject({ valid: true });
    first.close();

    const reopened = openPersistence({ dataDirectory: directory });
    expect(reopened.workOrderIntakes.list(companyA.tenant.id)).toEqual([pending]);
    expect(reopened.runtimeEvents.listSessions().filter((session) => session.tenantId === companyA.tenant.id)).toHaveLength(0);
    reopened.close();
  });

  it('confirms through the existing work_orders projection exactly once', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const owner = persistence.identity.createCompany({ companyName: '表单企业', displayName: '验收人', email: 'form@example.test' });
    const actorRef = `account:${owner.account.id}`;
    const intake = persistence.workOrderIntakes.intake({
      tenantId: owner.tenant.id,
      source: 'form',
      externalRef: 'form:crm-cleanup-001',
      payload: {
        title: '客户资料整理', target: '提取订单信息', expectedDeliverable: '结构化清单', assignee: '我的分身',
        dueAt: '2026-09-15T09:00:00.000Z', attachmentNames: ['客户订单.xlsx'], prompt: '读取客户订单.xlsx 并生成结构化清单',
      },
      payloadBytes: Buffer.from('{"title":"客户资料整理"}'), payloadMediaType: 'application/json', payloadName: 'work-order.json',
      actorRef, receivedAt: '2026-09-12T02:00:00.000Z',
    });

    const confirmed = persistence.workOrderIntakes.confirm(owner.tenant.id, intake.id, actorRef, '2026-09-12T02:01:00.000Z');
    expect(confirmed).toMatchObject({ status: 'confirmed', confirmedBy: actorRef, workOrderId: expect.stringMatching(/^wo_intake_/) });
    expect(persistence.workOrderIntakes.confirm(owner.tenant.id, intake.id, actorRef, '2026-09-12T02:02:00.000Z')).toEqual(confirmed);
    expect(persistence.listDomainEvents(owner.session.token).filter((event) => event.type === 'work_order_intake.confirmed')).toHaveLength(1);
    expect(persistence.verifyDomainEventIntegrity()).toMatchObject({ valid: true });
    persistence.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-intake-'));
  directories.push(directory);
  return directory;
}
