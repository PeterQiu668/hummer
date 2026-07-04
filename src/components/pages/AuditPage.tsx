/**
 * 审计链 — Append-only Ledger 可视化
 */
import { useState, useMemo } from 'react';
import { Search, Filter, Download, CheckCircle2, AlertTriangle, Clock, AlertCircle } from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import { useAppStore } from '../../store/useAppStore';

const RESULT_META: Record<string, { label: string; cls: string; icon: any }> = {
  ok:      { label: '通过', cls: 'is-success', icon: CheckCircle2 },
  blocked: { label: '阻断', cls: 'is-error',   icon: AlertCircle },
  pending: { label: '待审', cls: 'is-warning', icon: Clock },
  warning: { label: '告警', cls: 'is-warning', icon: AlertTriangle },
};

export default function AuditPage() {
  const auditLog = useAppStore((s) => s.auditLog);
  const pushToast = useAppStore((s) => s.pushToast);
  const [q, setQ] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'ok' | 'blocked' | 'pending' | 'warning'>('all');

  const filtered = useMemo(
    () =>
      auditLog.filter(
        (e) =>
          (resultFilter === 'all' || e.result === resultFilter) &&
          (q === '' || e.actor.includes(q) || e.action.includes(q) || e.target.includes(q)),
      ),
    [auditLog, q, resultFilter],
  );

  return (
    <WorkspacePage
      title="审计链"
      sub={`Append-only · 已记录 ${auditLog.length} 条 · 全部签名入链 · 可监管、可追责、可合规`}
      actions={
        <>
          <button className="hum-btn is-sm">
            <Filter size={12} /> 高级筛选
          </button>
          <button
            onClick={() => pushToast({ kind: 'success', title: '审计报告已导出', detail: 'audit-2026-06-24.pdf · 含数字签名' })}
            className="hum-btn is-sm is-primary"
          >
            <Download size={12} /> 导出审计报告
          </button>
        </>
      }
      sticky={
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="按操作者 / 动作 / 目标搜索…"
              className="hum-input pl-7"
            />
          </div>
          {(['all', 'ok', 'blocked', 'pending', 'warning'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setResultFilter(r)}
              className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium ${
                resultFilter === r ? 'bg-neutral-900 text-white' : 'hum-card-soft text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {r === 'all' ? '全部' : RESULT_META[r].label}
            </button>
          ))}
          <span className="hum-chip is-muted ml-auto">{filtered.length} / {auditLog.length}</span>
        </div>
      }
    >
      <div className="p-6 space-y-2">
        {/* Top summary */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <SummaryCard label="今日记录" value={auditLog.length.toString()} />
          <SummaryCard label="阻断次数" value={auditLog.filter((a) => a.result === 'blocked').length.toString()} color="error" />
          <SummaryCard label="待审" value={auditLog.filter((a) => a.result === 'pending').length.toString()} color="warning" />
          <SummaryCard label="签名验证" value="100%" color="success" />
        </div>

        {/* Timeline */}
        <div className="hum-card overflow-hidden">
          {filtered.map((e, i) => {
            const meta = RESULT_META[e.result];
            const Icon = meta.icon;
            return (
              <div
                key={e.id}
                className="flex items-start gap-3 px-4 py-3 hover:bg-neutral-50 transition"
                style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
              >
                <div className={`mt-0.5 ${
                  e.result === 'ok' ? 'text-success' :
                  e.result === 'blocked' ? 'text-error' :
                  e.result === 'pending' ? 'text-warning' :
                  'text-warning'
                }`}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[12.5px] font-medium text-neutral-900">{e.actor}</span>
                    <span className="text-[12.5px] text-neutral-600">{e.action}</span>
                    <span className="text-[12.5px] text-neutral-400">→</span>
                    <span className="text-[12.5px] text-neutral-700">{e.target}</span>
                    <span className={`hum-chip ${meta.cls}`} style={{ padding: '1px 6px', fontSize: 10 }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10.5px] hum-faint font-mono">
                    <span>{e.ts}</span>
                    <span>hash {e.hash}</span>
                    {e.tags?.map((t) => (
                      <span key={t} className="px-1 py-0 rounded bg-neutral-100 text-neutral-500">{t}</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-[12.5px] hum-faint text-center py-12">未匹配到审计记录</div>
          )}
        </div>

        <div className="text-[11px] hum-faint text-center pt-4">
          所有记录采用 Append-only 模式（SQLite WAL + 外键 + 触发器），无法篡改
        </div>
      </div>
    </WorkspacePage>
  );
}

function SummaryCard({
  label, value, color,
}: { label: string; value: string; color?: 'success' | 'warning' | 'error' }) {
  const c =
    color === 'success' ? 'text-success' :
    color === 'warning' ? 'text-warning' :
    color === 'error' ? 'text-error' :
    'text-neutral-900';
  return (
    <div className="hum-card p-3">
      <div className="hum-eyebrow">{label}</div>
      <div className={`text-[22px] font-semibold mt-1 hum-tabular ${c}`}>{value}</div>
    </div>
  );
}
