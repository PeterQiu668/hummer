import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleStop, RefreshCw, ShieldCheck, ShieldX } from 'lucide-react';
import type {
  RemoteRelayApprovalRequest,
  RemoteRelayTask,
} from '../execution-nodes/remoteRelayClient';

export interface FleetControlPort {
  listTasks(): Promise<readonly RemoteRelayTask[]>;
  listApprovalRequests(): Promise<readonly RemoteRelayApprovalRequest[]>;
  decideApproval(input: {
    requestId: string;
    decision: 'approved' | 'denied';
    rationale?: string;
  }): Promise<unknown>;
  stopTask(taskId: string): Promise<unknown>;
}

export interface FleetControlPanelProps {
  port?: FleetControlPort;
  refreshMs?: number;
}

type BusyAction = `approve:${string}` | `deny:${string}` | `stop:${string}`;

/**
 * Workbench-local Relay control surface. Polling is deliberately read-only:
 * decisions and stops can only originate from an explicit button click.
 */
export default function FleetControlPanel({ port, refreshMs = 1_000 }: FleetControlPanelProps) {
  const [tasks, setTasks] = useState<readonly RemoteRelayTask[]>([]);
  const [approvals, setApprovals] = useState<readonly RemoteRelayApprovalRequest[]>([]);
  const [resolvedRequests, setResolvedRequests] = useState<ReadonlySet<string>>(() => new Set());
  const [stoppedTasks, setStoppedTasks] = useState<ReadonlySet<string>>(() => new Set());
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!port) return;
    try {
      const [nextTasks, nextApprovals] = await Promise.all([
        port.listTasks(),
        port.listApprovalRequests(),
      ]);
      setTasks(nextTasks);
      setApprovals(nextApprovals);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取 Relay 控制面');
    }
  }, [port]);

  useEffect(() => {
    if (!port) return;
    let active = true;
    const update = async () => {
      if (!active) return;
      await refresh();
    };
    void update();
    const timer = window.setInterval(() => { void update(); }, refreshMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [port, refresh, refreshMs]);

  const actionableApprovals = useMemo(
    () => approvals.filter((request) => !resolvedRequests.has(request.requestId) && !approvalDecision(request)),
    [approvals, resolvedRequests],
  );

  const decide = async (request: RemoteRelayApprovalRequest, decision: 'approved' | 'denied') => {
    if (!port || busyAction) return;
    const action: BusyAction = `${decision === 'approved' ? 'approve' : 'deny'}:${request.requestId}`;
    setBusyAction(action);
    setError(null);
    setStatus(null);
    try {
      await port.decideApproval({
        requestId: request.requestId,
        decision,
        ...(decision === 'denied' ? { rationale: '操作者在 HUMMER 工作台明确拒绝' } : {}),
      });
      setResolvedRequests((current) => new Set(current).add(request.requestId));
      setStatus(decision === 'approved'
        ? `审批 ${request.requestId} 已批准；节点现在可以消费这次授权。`
        : `审批 ${request.requestId} 已拒绝；该任务不会获得执行授权。`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Relay 未能记录审批决定');
    } finally {
      setBusyAction(null);
    }
  };

  const stop = async (task: RemoteRelayTask) => {
    if (!port || busyAction || !canStop(task)) return;
    setBusyAction(`stop:${task.taskId}`);
    setError(null);
    setStatus(null);
    try {
      await port.stopTask(task.taskId);
      setStoppedTasks((current) => new Set(current).add(task.taskId));
      setStatus(`停止命令已由 Relay 记录：${task.taskId}`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Relay 未能停止任务');
    } finally {
      setBusyAction(null);
    }
  };

  if (!port) return null;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 pb-6 sm:px-6" aria-labelledby="fleet-control-title">
      <div className="hum-card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="hum-eyebrow">待我决定</p>
            <h2 id="fleet-control-title" className="mt-1 hum-h2">远程任务与审批</h2>
            <p className="mt-1 text-xs hum-muted">这里的刷新只读取状态；批准、拒绝和停止都必须由你点击。</p>
          </div>
          <button type="button" className="hum-btn is-sm" onClick={() => { void refresh(); }} disabled={Boolean(busyAction)} aria-label="刷新远程任务与审批">
            <RefreshCw size={13} />刷新
          </button>
        </div>

        {actionableApprovals.length ? (
          <div className="mt-4 space-y-3" aria-label="待审批动作">
            {actionableApprovals.map((request) => {
              const details = approvalDetails(request);
              const approving = busyAction === `approve:${request.requestId}`;
              const denying = busyAction === `deny:${request.requestId}`;
              return (
                <article key={request.requestId} className="rounded-md border border-[var(--warning)] bg-[var(--warning-soft)] p-3" aria-label={`审批请求 ${request.requestId}`}>
                  <div className="text-xs font-semibold text-[var(--text-ink)]">{details.action}</div>
                  <dl className="mt-2 grid gap-1 text-xs text-[var(--text-muted)] sm:grid-cols-2">
                    <div><dt className="inline">对象：</dt><dd className="inline break-all">{details.target}</dd></div>
                    <div><dt className="inline">风险：</dt><dd className="inline">{details.riskClass}</dd></div>
                    <div><dt className="inline">节点：</dt><dd className="inline break-all">{stringValue(request.nodeId, undefined, '未知节点')}</dd></div>
                    <div><dt className="inline">到期：</dt><dd className="inline">{details.expiresAt}</dd></div>
                  </dl>
                  <p className="mt-2 text-xs text-[var(--text-muted)]">{details.preview}</p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      className="hum-btn is-sm is-primary"
                      disabled={Boolean(busyAction)}
                      onClick={() => { void decide(request, 'approved'); }}
                      aria-label={`批准并继续：${details.action} → ${details.target}`}
                    >
                      <ShieldCheck size={13} />{approving ? '正在记录批准…' : '批准并继续'}
                    </button>
                    <button
                      type="button"
                      className="hum-btn is-sm is-danger"
                      disabled={Boolean(busyAction)}
                      onClick={() => { void decide(request, 'denied'); }}
                      aria-label={`拒绝并停止本次任务：${details.action} → ${details.target}`}
                    >
                      <ShieldX size={13} />{denying ? '正在记录拒绝…' : '拒绝并停止本次任务'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-md border border-[var(--border-soft)] bg-[var(--bg-canvas)] px-3 py-2 text-xs hum-muted">当前没有待审批动作。</p>
        )}

        <div className="mt-4 space-y-2" aria-label="远程任务列表">
          {tasks.length ? tasks.map((task) => {
            const stopped = stoppedTasks.has(task.taskId);
            return (
              <article key={task.taskId} className="rounded-md border border-[var(--border-soft)] p-3" aria-label={`远程任务 ${task.taskId}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-[var(--text-ink)]">{taskTitle(task)}</div>
                    <div className="mt-1 break-all text-[11px] hum-muted">{task.taskId} · {stringValue(task.targetNodeId, undefined, '未知节点')} · {stringValue(task.targetRuntime, undefined, '未知运行时')}</div>
                    <div className="mt-1 text-[11px] hum-muted">Relay 状态：{task.status}{stopped ? ' · 本窗口已记录停止命令' : ''}</div>
                  </div>
                  <button
                    type="button"
                    className="hum-btn is-sm is-danger shrink-0"
                    disabled={Boolean(busyAction) || !canStop(task)}
                    onClick={() => { void stop(task); }}
                    aria-label={`停止远程任务：${taskTitle(task)}`}
                  >
                    <CircleStop size={13} />{busyAction === `stop:${task.taskId}` ? '正在停止…' : '停止任务'}
                  </button>
                </div>
              </article>
            );
          }) : <p className="text-xs hum-muted">Relay 中还没有任务。</p>}
        </div>

        <div aria-live="polite" aria-atomic="true">
          {status ? <p className="mt-3 text-xs text-[var(--success)]" role="status">{status}</p> : null}
          {error ? <p className="mt-3 text-xs text-[var(--error)]" role="alert">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

function approvalDetails(request: RemoteRelayApprovalRequest) {
  const body = request.request;
  return {
    action: stringValue(body.action, request.action, '受控动作'),
    target: stringValue(body.target, request.taskId, '未提供目标'),
    riskClass: stringValue(body.riskClass, request.riskClass, 'unknown'),
    preview: stringValue(body.redactedPreview, undefined, 'Relay 未提供可公开预览'),
    expiresAt: stringValue(body.expiresAt, request.expiresAt, '未知'),
  };
}

function approvalDecision(request: RemoteRelayApprovalRequest): unknown {
  return request.decision ?? request.decisionRecord ?? null;
}

function taskTitle(task: RemoteRelayTask): string {
  const envelope = task.envelope;
  if (!envelope || typeof envelope !== 'object') return task.taskId;
  const workOrderTask = (envelope as Record<string, unknown>).workOrderTask;
  if (!workOrderTask || typeof workOrderTask !== 'object') return task.taskId;
  return stringValue((workOrderTask as Record<string, unknown>).title, undefined, task.taskId);
}

function canStop(task: RemoteRelayTask): boolean {
  return task.status === 'queued' || task.status === 'leased';
}

function stringValue(primary: unknown, secondary: unknown, fallback: string): string {
  if (typeof primary === 'string' && primary.trim()) return primary;
  if (typeof secondary === 'string' && secondary.trim()) return secondary;
  return fallback;
}
