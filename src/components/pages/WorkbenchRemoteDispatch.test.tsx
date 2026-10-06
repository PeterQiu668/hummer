import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { configureRemoteRelayDeployment } from '../../features/home/remoteRelayDispatch';
import { draftPlanFromPrompt } from '../../features/sessions/model/session';
import { MemorySessionStore } from '../../features/sessions/persistence/sessionStore';
import { MockRuntimeAdapter } from '../../features/sessions/runtime/mockRuntimeAdapter';
import WorkbenchPage from './WorkbenchPage';

let disposeRelay: (() => void) | undefined;
afterEach(() => {
  disposeRelay?.();
  disposeRelay = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('routes browser start-work confirmation to the explicitly configured Remote Relay', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/v1/control/nodes')) {
      return new Response(JSON.stringify({ nodes: [{
        nodeId: 'node-office', tenantId: 'tenant_demo', status: 'online', lastSeenAt: '2026-10-07T08:00:00.000Z',
        manifest: { runtimes: [{ kind: 'codex', available: true }], capabilities: ['workspace.exec'] },
      }] }), { status: 200 });
    }
    if (url.endsWith('/v1/tasks/enqueue')) {
      return new Response(JSON.stringify({ task: { taskId: 'task-start' }, inserted: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: 'not_found', message: 'not found' } }), { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  disposeRelay = configureRemoteRelayDeployment({
    baseUrl: 'https://relay.example.test',
    getBadge: () => 'in-memory-badge',
  });
  render(<WorkbenchPage
    runtime={new MockRuntimeAdapter({ stepDelayMs: 1 })}
    sessionStore={new MemorySessionStore(() => 'tenant_demo')}
    planner={{ draft: vi.fn().mockResolvedValue(draftPlanFromPrompt('整理客户资料并生成摘要')) }}
  />);

  fireEvent.click(screen.getByRole('button', { name: '开始做' }));
  fireEvent.change(screen.getByRole('textbox', { name: '你想完成什么' }), { target: { value: '整理客户资料并生成摘要' } });
  fireEvent.click(screen.getByRole('button', { name: '生成待确认计划' }));
  await screen.findByText('等待你的确认');
  fireEvent.click(screen.getByRole('button', { name: '确认计划' }));

  expect(await screen.findByLabelText('派发回执')).toHaveTextContent('任务已提交到 Relay');
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v1/tasks/enqueue'))).toHaveLength(1));
});
