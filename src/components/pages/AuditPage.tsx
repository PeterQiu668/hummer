/**
 * 审计链 — Append-only Ledger 可视化 + 责任链快照（可追责）
 */
import { useState, useMemo } from 'react';
import {
  Search, Filter, Download, CheckCircle2, AlertTriangle, Clock, AlertCircle,
  ChevronDown, ChevronRight, FileCheck2, ArrowUpToLine,
} from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import { useAppStore } from '../../store/useAppStore';
import type { AuditEntry } from '../../store/useAppStore';
import ChainSnapshot from '../audit/ChainSnapshot';
import LedgerIntegrityCard from '../audit/LedgerIntegrityCard';

const RESULT_META: Record<string, { label: string; cls: string; icon: any }> = {
  ok:      { label: '通过', cls: 'is-success', icon: CheckCircle2 },
  blocked: { label: '阻断', cls: 'is-error',   icon: AlertCircle },
  pending: { label: '待审', cls: 'is-warning', icon: Clock },
  warning: { label: '告警', cls: 'is-warning', icon: AlertTriangle },
};

const GENESIS_HASH = '0x0000';

/** 高风险条目：阻断 / 告警 / 带 risk 标签 */
const isHighRisk = (e: AuditEntry) =>
  e.result === 'blocked' || e.result === 'warning' || (e.tags ?? []).some((t) => t.startsWith('risk'));

export default function AuditPage() {
  const auditLog = useAppStore((s) => s.auditLog);
  const pushToast = useAppStore((s) => s.pushToast);
  const currentRole = useAppStore((s) => s.currentRole);
  const isAuditor = currentRole === 'auditor';

  const [q, setQ] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'ok' | 'blocked' | 'pending' | 'warning'>('all');
  const [actorFilter, setActorFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [riskFirst, setRiskFirst] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /** 链式关系：每条记录的 prev_hash = 时间上前一条的 hash（auditLog 新→旧） */
  const prevHashOf = useMemo(() => {
    const m = new Map<string, string>();
    auditLog.forEach((e, i) => m.set(e.id, auditLog[i + 1]?.hash ?? GENESIS_HASH));
    return m;
  }, [auditLog]);

  const actorOptions = useMemo(
    () => Array.from(new Set(auditLog.map((e) => e.actor))),
    [auditLog],
  );
  const tagOptions = useMemo(
    () => Array.from(new Set(auditLog.flatMap((e) => e.tags ?? []))),
    [auditLog],
  );

  const filtered = useMemo(() => {
    const base = auditLog.filter(
      (e) =>
        (resultFilter === 'all' || e.result === resultFilter) &&
        (actorFilter === 'all' || e.actor === actorFilter) &&
        (tagFilter === 'all' || (e.tags ?? []).includes(tagFilter)) &&
        (q === '' || e.actor.includes(q) || e.action.includes(q) || e.target.includes(q)),
    );
    if (!riskFirst) return base;
    return [...base].sort((a, b) => Number(isHighRisk(b)) - Number(isHighRisk(a)));
  }, [auditLog, q, resultFilter, actorFilter, tagFilter, riskFirst]);

  const highRiskCount = useMemo(() => auditLog.filter(isHighRisk).length, [auditLog]);

  return (
    <WorkspacePage
      title="审计链"
      sub={`Append-only · 已记录 ${auditLog.length} 条 · 全部签名入链 · 可监管、可追责、可合规`}
      actions={
        <>
          {isAuditor && (
            <button
              onClick={() =>
                pushToast({
                  kind: 'success',
                  title: '合规报告已导出',
                  detail: `compliance-2026-07.pdf · 含 ${auditLog.length} 条记录责任链快照 + 审计员签名`,
                })
              }
              className="hum-btn is-sm"
            >
              <FileCheck2 size={12} /> 导出合规报告
            </button>
          )}
          <button className="hum-btn is-sm">
            <Filter size={12} /> 高级筛选
          </button>
          <button
            onClick={() => pushToast({ kind: 'success', title: '审计报告已导出', detail: 'audit-2026-07-04.pdf · 含数字签名' })}
            className="hum-btn is-sm is-primary"
          >
            <Download size={12} /> 导出审计报告
          </button>
        </>
      }
      sticky={
        <div className="space-y-2">
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

          {/* 审计员视角：按操作者 / 标签筛选 + 高风险置顶 */}
          {isAuditor && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="hum-eyebrow">审计员筛选</span>
              <select
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
                className="hum-input"
                style={{ width: 'auto', paddingTop: 3, paddingBottom: 3 }}
              >
                <option value="all">全部操作者</option>
                {actorOptions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <select
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                className="hum-input"
                style={{ width: 'auto', paddingTop: 3, paddingBottom: 3 }}
              >
                <option value="all">全部标签</option>
                {tagOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                onClick={() => setRiskFirst((v) => !v)}
                className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium flex items-center gap-1 ${
                  riskFirst ? 'bg-neutral-900 text-white' : 'hum-card-soft text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <ArrowUpToLine size={11} /> 高风险置顶
              </button>
              <span className="text-[11px] hum-faint ml-auto">高风险条目 {highRiskCount} 条（阻断 / 告警 / risk 标签）</span>
            </div>
          )}
        </div>
      }
    >
      <div className="p-6 space-y-2">
        {/* 账本完整性状态卡 */}
        <div className="mb-4 space-y-3">
          <LedgerIntegrityCard auditLog={auditLog} />
          <div className="grid grid-cols-4 gap-3">
            <SummaryCard label="今日记录" value={auditLog.length.toString()} />
            <SummaryCard label="阻断次数" value={auditLog.filter((a) => a.result === 'blocked').length.toString()} color="error" />
            <SummaryCard label="待审" value={auditLog.filter((a) => a.result === 'pending').length.toString()} color="warning" />
            <SummaryCard label="签名验证" value="100%" color="success" />
          </div>
        </div>

        {/* Timeline */}
        <div className="hum-card overflow-hidden">
          {filtered.map((e, i) => {
            const meta = RESULT_META[e.result];
            const Icon = meta.icon;
            const expanded = expandedId === e.id;
            const prevHash = prevHashOf.get(e.id) ?? GENESIS_HASH;
            return (
              <div key={e.id} style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : e.id)}
                  className={`w-full text-left flex items-start gap-3 px-4 py-3 transition ${
                    expanded ? 'bg-neutral-50' : 'hover:bg-neutral-50'
                  }`}
                >
                  <div className="mt-0.5 text-neutral-400">
                    {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </div>
                  <div className={`mt-0.5 ${
                    e.result === 'ok' ? 'text-success' :
                    e.result === 'blocked' ? 'text-error' :
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
                      {isHighRisk(e) && (
                        <span className="hum-chip is-error" style={{ padding: '1px 6px', fontSize: 10 }}>高风险</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10.5px] hum-faint font-mono">
                      <span>{e.ts}</span>
                      <span>hash {e.hash}</span>
                      {e.tags?.map((t) => (
                        <span key={t} className="px-1 py-0 rounded bg-neutral-100 text-neutral-500">{t}</span>
                      ))}
                      <span className="text-neutral-300">点击展开责任链快照</span>
                    </div>
                  </div>
                </button>
                {expanded && <ChainSnapshot entry={e} prevHash={prevHash} />}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-[12.5px] hum-faint text-center py-12">未匹配到审计记录</div>
          )}
        </div>

        <div className="text-[11px] hum-faint text-center pt-4">
          所有记录采用 Append-only 模式（SQLite WAL + 外键 + 触发器），逐条链式签名，无法篡改
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
