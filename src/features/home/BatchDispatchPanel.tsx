import { useEffect, useRef, useState } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import type { RemoteRelayBatchResult } from '../execution-nodes/remoteRelayClient';
import {
  buildBatchTaskEnvelopes,
  type BatchDispatchDraft,
  type BatchDispatchNode,
  type BatchDispatchPort,
} from './batchDispatch';

interface DraftRow extends BatchDispatchDraft { id: string }

export interface BatchDispatchPanelProps {
  port?: BatchDispatchPort;
  tenantId: string;
  confirmedBy?: string;
  now?: () => string;
  createBatchId?: () => string;
}

export default function BatchDispatchPanel({
  port,
  tenantId,
  confirmedBy = 'human:operator',
  now = () => new Date().toISOString(),
  createBatchId = defaultBatchId,
}: BatchDispatchPanelProps) {
  const nextRowId = useRef(3);
  const submitting = useRef(false);
  const [rows, setRows] = useState<DraftRow[]>([emptyRow('row-1'), emptyRow('row-2')]);
  const [nodes, setNodes] = useState<readonly BatchDispatchNode[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(Boolean(port));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<readonly RemoteRelayBatchResult[]>([]);

  useEffect(() => {
    let active = true;
    if (!port) {
      setNodes([]);
      setLoadingNodes(false);
      return () => { active = false; };
    }
    setLoadingNodes(true);
    void port.listNodes().then((listed) => {
      if (!active) return;
      setNodes(listed.filter((node) => node.status === 'online'));
      setError(null);
    }).catch(() => {
      if (!active) return;
      setNodes([]);
      setError('无法读取 Relay 执行节点，批量派活已禁用');
    }).finally(() => {
      if (active) setLoadingNodes(false);
    });
    return () => { active = false; };
  }, [port]);

  const updateRow = (id: string, patch: Partial<BatchDispatchDraft>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
    resetDecision();
  };

  const addRow = () => {
    if (rows.length >= 20 || !port || busy) return;
    setRows((current) => [...current, emptyRow(`row-${nextRowId.current++}`)]);
    resetDecision();
  };

  const removeRow = (id: string) => {
    if (rows.length <= 2 || !port || busy) return;
    setRows((current) => current.filter((row) => row.id !== id));
    resetDecision();
  };

  const resetDecision = () => {
    setConfirmed(false);
    setResults([]);
    setError(null);
  };

  const submit = async () => {
    if (!port || !confirmed || busy || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setResults([]);
    setError(null);
    try {
      const envelopes = buildBatchTaskEnvelopes({
        drafts: rows,
        nodes,
        tenantId,
        confirmedBy,
        confirmedAt: now(),
        batchId: createBatchId(),
      });
      const received = await port.enqueueBatch(envelopes);
      setResults(rows.map((_, index) => received.find((entry) => entry.index === index) ?? {
        index,
        ok: false,
        status: 0,
        code: 'missing_result',
        message: 'Relay 未返回此任务结果',
      }));
      setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量派活失败');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const unavailable = !port || loadingNodes || nodes.length === 0;

  return (
    <section className="mx-auto w-full min-w-0 max-w-3xl px-4 pb-6 sm:px-6" aria-labelledby="batch-dispatch-title">
      <div className="hum-card min-w-0 p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="hum-eyebrow">手机批量派活</p>
            <h2 id="batch-dispatch-title" className="mt-1 hum-h2">一次确认，逐项发送 2–20 条任务</h2>
            <p className="mt-1 text-xs hum-muted">每条任务独立返回成功或失败；认证失败不会自动重试。</p>
          </div>
          <button type="button" className="hum-btn is-sm w-full justify-center sm:w-auto" onClick={addRow} disabled={!port || busy || rows.length >= 20}>
            <Plus size={13} />添加一条
          </button>
        </div>

        {!port ? (
          <p className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-xs hum-muted" role="status">
            Relay 未配置，当前只读，不能发送批量任务。
          </p>
        ) : loadingNodes ? (
          <p className="mt-4 text-xs hum-muted" role="status">正在读取可用执行节点…</p>
        ) : nodes.length === 0 ? (
          <p className="mt-4 text-xs text-[var(--error)]" role="alert">没有可用的 Relay 执行节点，不能发送批量任务。</p>
        ) : null}

        <div className="mt-4 space-y-3">
          {rows.map((row, index) => {
            const result = results.find((entry) => entry.index === index);
            return (
              <fieldset key={row.id} className="hum-card-soft min-w-0 p-3" aria-label={`批量任务 ${index + 1}`} disabled={!port || busy}>
                <div className="flex items-center justify-between gap-2">
                  <legend className="text-xs font-semibold text-[var(--text-ink)]">第 {index + 1} 条</legend>
                  <button type="button" aria-label={`删除第 ${index + 1} 条`} className="hum-btn is-sm is-danger" onClick={() => removeRow(row.id)} disabled={!port || busy || rows.length <= 2}>
                    <Trash2 size={12} />删除
                  </button>
                </div>
                <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="min-w-0 text-xs hum-muted sm:col-span-2">目标
                    <textarea aria-label={`第 ${index + 1} 条目标`} className="hum-input mt-1 min-h-16 resize-y" value={row.target} onChange={(event) => updateRow(row.id, { target: event.target.value })} />
                  </label>
                  <label className="min-w-0 text-xs hum-muted">交付物
                    <input aria-label={`第 ${index + 1} 条交付物`} className="hum-input mt-1 min-w-0" value={row.expectedDeliverable} onChange={(event) => updateRow(row.id, { expectedDeliverable: event.target.value })} placeholder="例如 outputs/report.md" />
                  </label>
                  <label className="min-w-0 text-xs hum-muted">目标节点
                    <select aria-label={`第 ${index + 1} 条目标节点`} className="hum-input mt-1 min-w-0" value={row.targetNodeId} onChange={(event) => updateRow(row.id, { targetNodeId: event.target.value })}>
                      <option value="">请选择在线节点</option>
                      {nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.runtime}</option>)}
                    </select>
                  </label>
                </div>
                {result ? (
                  <div className={`mt-3 rounded-md px-3 py-2 text-xs ${result.ok ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--error-soft)] text-[var(--error)]'}`}>
                    {result.ok ? '已派发' : <><div>失败（{result.status || '网络'}）{result.code}</div><div className="mt-1 break-words">{result.message}</div></>}
                  </div>
                ) : null}
              </fieldset>
            );
          })}
        </div>

        <div className="mt-4 border-t border-[var(--border-soft)] pt-4">
          <label className="flex min-w-0 items-start gap-2 text-xs text-[var(--text-ink)]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={confirmed}
              disabled={unavailable || busy}
              onChange={(event) => { setConfirmed(event.target.checked); setError(null); }}
            />
            <span>我确认发送这 {rows.length} 条任务</span>
          </label>
          <button
            type="button"
            className="hum-btn is-primary mt-3 w-full justify-center sm:w-auto"
            disabled={unavailable || busy || !confirmed}
            onClick={() => { void submit(); }}
          >
            <Send size={13} />{busy ? '正在逐项发送…' : `发送 ${rows.length} 条任务`}
          </button>
          {error ? <p className="mt-3 text-xs text-[var(--error)]" role="alert">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

function emptyRow(id: string): DraftRow {
  return { id, target: '', expectedDeliverable: '', targetNodeId: '' };
}

function defaultBatchId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `batch-${random}`;
}
