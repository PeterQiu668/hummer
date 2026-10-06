import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { validateFleetContract, type TaskEnvelope } from '@hummer/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BatchDispatchPanel from './BatchDispatchPanel';
import type { BatchDispatchPort } from './batchDispatch';

const nodes = [
  { id: 'node-a', label: '办公室节点', runtime: 'codex' as const, status: 'online' as const },
  { id: 'node-b', label: '云端节点', runtime: 'claude' as const, status: 'online' as const },
];

function configuredPort(results?: Awaited<ReturnType<BatchDispatchPort['enqueueBatch']>>) {
  return {
    listNodes: vi.fn().mockResolvedValue(nodes),
    enqueueBatch: vi.fn().mockResolvedValue(results ?? [
      { index: 0, ok: true, result: { task: { taskId: 'task-a' } } },
      { index: 1, ok: true, result: { task: { taskId: 'task-b' } } },
    ]),
  } satisfies BatchDispatchPort;
}

async function fillTwoRows() {
  expect(await screen.findAllByRole('option', { name: '办公室节点 · codex' })).toHaveLength(2);
  fireEvent.change(screen.getByRole('textbox', { name: '第 1 条目标' }), { target: { value: '整理华东客户名单' } });
  fireEvent.change(screen.getByRole('textbox', { name: '第 1 条交付物' }), { target: { value: 'outputs/east-customers.md' } });
  fireEvent.change(screen.getByRole('combobox', { name: '第 1 条目标节点' }), { target: { value: 'node-a' } });
  fireEvent.change(screen.getByRole('textbox', { name: '第 2 条目标' }), { target: { value: '整理华南客户名单' } });
  fireEvent.change(screen.getByRole('textbox', { name: '第 2 条交付物' }), { target: { value: 'outputs/south-customers.md' } });
  fireEvent.change(screen.getByRole('combobox', { name: '第 2 条目标节点' }), { target: { value: 'node-b' } });
}

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

describe('BatchDispatchPanel', () => {
  it('is operable at a 390px viewport and builds validated TaskEnvelope v1 records only after confirmation', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.dispatchEvent(new Event('resize'));
    const port = configuredPort();
    render(<BatchDispatchPanel
      port={port}
      tenantId="tenant-mobile"
      now={() => '2026-10-07T08:00:00.000Z'}
      createBatchId={() => 'batch-mobile'}
    />);

    await fillTwoRows();
    expect(screen.getAllByRole('group', { name: /批量任务/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '发送 2 条任务' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: '我确认发送这 2 条任务' }));
    fireEvent.click(screen.getByRole('button', { name: '发送 2 条任务' }));

    await waitFor(() => expect(port.enqueueBatch).toHaveBeenCalledTimes(1));
    const envelopes = port.enqueueBatch.mock.calls[0][0] as readonly TaskEnvelope[];
    expect(envelopes).toHaveLength(2);
    for (const envelope of envelopes) {
      expect(validateFleetContract('TaskEnvelope', envelope).issues).toBeUndefined();
      expect(envelope).toMatchObject({ schema: 'hummer.task-envelope', version: 1, tenantId: 'tenant-mobile' });
    }
    expect(envelopes[0]).toMatchObject({
      targetNodeId: 'node-a', targetRuntime: 'codex',
      workOrderTask: { target: '整理华东客户名单', expectedDeliverable: 'outputs/east-customers.md' },
    });
    expect(envelopes[1]).toMatchObject({ targetNodeId: 'node-b', targetRuntime: 'claude' });
    expect(await screen.findAllByText('已派发')).toHaveLength(2);
  });

  it('is explicitly read-only when Relay deployment configuration is absent', () => {
    render(<BatchDispatchPanel port={undefined} tenantId="tenant-mobile" />);

    expect(screen.getByRole('status')).toHaveTextContent('Relay 未配置，当前只读，不能发送批量任务');
    expect(screen.getByRole('textbox', { name: '第 1 条目标' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送 2 条任务' })).toBeDisabled();
  });

  it('enforces the 2–20 row bounds in the panel', async () => {
    render(<BatchDispatchPanel port={configuredPort()} tenantId="tenant-mobile" />);
    await screen.findAllByRole('option', { name: '办公室节点 · codex' });
    expect(screen.getByRole('button', { name: '删除第 1 条' })).toBeDisabled();
    const add = screen.getByRole('button', { name: '添加一条' });
    for (let index = 0; index < 18; index += 1) fireEvent.click(add);
    expect(screen.getAllByRole('group', { name: /批量任务/ })).toHaveLength(20);
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '删除第 20 条' }));
    expect(screen.getAllByRole('group', { name: /批量任务/ })).toHaveLength(19);
  });

  it('shows each partial failure and does not turn a 403 into success', async () => {
    const port = configuredPort([
      { index: 0, ok: true, result: { task: { taskId: 'task-a' } } },
      { index: 1, ok: false, status: 403, code: 'scope_denied', message: 'badge does not grant task.enqueue' },
    ]);
    render(<BatchDispatchPanel port={port} tenantId="tenant-mobile" />);
    await fillTwoRows();
    fireEvent.click(screen.getByRole('checkbox', { name: '我确认发送这 2 条任务' }));
    fireEvent.click(screen.getByRole('button', { name: '发送 2 条任务' }));

    expect(await screen.findByText('已派发')).toBeInTheDocument();
    expect(screen.getByText('失败（403）scope_denied')).toBeInTheDocument();
    expect(screen.getByText('badge does not grant task.enqueue')).toBeInTheDocument();
    expect(port.enqueueBatch).toHaveBeenCalledTimes(1);
  });

  it('ignores repeated submit clicks while one batch is in flight', async () => {
    let resolveBatch!: (value: Awaited<ReturnType<BatchDispatchPort['enqueueBatch']>>) => void;
    const port = configuredPort();
    port.enqueueBatch.mockImplementation(() => new Promise((resolve) => { resolveBatch = resolve; }));
    render(<BatchDispatchPanel port={port} tenantId="tenant-mobile" />);
    await fillTwoRows();
    fireEvent.click(screen.getByRole('checkbox', { name: '我确认发送这 2 条任务' }));
    const submit = screen.getByRole('button', { name: '发送 2 条任务' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(port.enqueueBatch).toHaveBeenCalledTimes(1);
    resolveBatch([
      { index: 0, ok: true, result: {} },
      { index: 1, ok: true, result: {} },
    ]);
    expect(await screen.findAllByText('已派发')).toHaveLength(2);
  });
});
