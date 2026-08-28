import { describe, expect, it } from 'vitest';
import {
  completeForkedSession,
  createSessionFromPlan,
  createDemoSession,
  decideProtectedWrite,
  draftPlanFromPrompt,
  forkSession,
  injectHumanMessage,
  requestProtectedWrite,
  reviseSop,
  setApprovalMode,
  stopSession,
} from './session';

describe('ExecutionSession', () => {
  it('drafts a zero-configuration plan that echoes the operator prompt', () => {
    const plan = draftPlanFromPrompt('把这周的线索整理成跟进清单，写回 CRM 前先给我看');

    expect(plan.prompt).toContain('线索');
    expect(plan.understanding.join(' ')).toContain('线索');
    expect(plan.understanding.join(' ')).toContain('CRM');
    expect(plan.assignees.length).toBeGreaterThan(0);
    expect(plan.approvalMode).toBe('L2');
    expect(plan.humanGates.join(' ')).toContain('CRM');
  });

  it('creates an empty real session from a confirmed plan and records human messages', () => {
    const plan = draftPlanFromPrompt('整理本周线索');
    const session = createSessionFromPlan(plan);

    expect(session.steps).toEqual([]);
    expect(session.workOrder.goal).toContain('整理本周线索');

    const withHumanMessage = injectHumanMessage(session, '先只做华东区域');
    expect(withHumanMessage.steps).toHaveLength(1);
    expect(withHumanMessage.steps[0]).toMatchObject({
      kind: 'human_to_ai',
      actorRef: 'human:operator',
      result: '先只做华东区域',
    });
  });

  it('keeps a running WorkOrder and a visible evidence trajectory together', () => {
    const session = createDemoSession();

    expect(session.workOrder.status).toBe('running');
    expect(session.steps).toHaveLength(4);
    expect(session.steps.every((item) => item.evidenceRefs.length > 0)).toBe(true);
  });

  it('requires human approval before a protected CRM write and creates a ResultPackage after approval', () => {
    const waiting = requestProtectedWrite(createDemoSession());
    expect(waiting.status).toBe('awaiting_approval');
    expect(waiting.workOrder.status).toBe('awaiting_approval');
    expect(waiting.steps.at(-1)?.status).toBe('awaiting_human');

    const delivered = decideProtectedWrite(waiting, true);
    expect(delivered.status).toBe('delivered');
    expect(delivered.workOrder.status).toBe('delivered');
    expect(delivered.resultPackage?.evidenceRefs.length).toBeGreaterThan(0);
  });

  it('blocks external writes in L1 suggestion mode without creating a pending operation', () => {
    const blocked = requestProtectedWrite(setApprovalMode(createDemoSession(), 'L1'));
    expect(blocked.status).toBe('blocked');
    expect(blocked.workOrder.status).toBe('running');
    expect(blocked.steps.at(-1)?.status).toBe('blocked');
  });

  it('forks at a checkpoint and makes a revised SOP observable in the new ResultPackage', () => {
    const source = decideProtectedWrite(requestProtectedWrite(createDemoSession()), false);
    const revised = reviseSop(source, '# Account qualification\n- Prioritize accounts by industry and evidence quality.');
    const forked = forkSession(revised, 3);
    const delivered = completeForkedSession(forked);

    expect(forked.parentSessionId).toBe(source.id);
    expect(forked.steps.some((item) => item.title.includes('创建复跑分支'))).toBe(true);
    expect(delivered.resultPackage?.summary).toContain('行业优先级');
  });

  it('stops a running session with one state transition and records the token recall', () => {
    const stopped = stopSession(createDemoSession());
    expect(stopped.status).toBe('cancelled');
    expect(stopped.workOrder.status).toBe('cancelled');
    expect(stopped.steps.at(-1)?.title).toBe('已停止本次会话');
  });
});
