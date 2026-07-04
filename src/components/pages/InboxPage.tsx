/**
 * 老板收件箱 — 五类事件统一承接面（Phase 0）
 * 数据三路合并：douyin.ts 静态收件箱 + store.riskAlerts(pending) + store.exitActions(pending_approval)
 * 每条可展开处理：审批类 批准/拒绝，其余 去处理/标记已阅；处理即写审计 + toast。
 */
import { useMemo, useState } from 'react';
import {
  FileCheck2, Ban, Hourglass, PackageCheck, Activity,
  ChevronDown, ChevronRight, Check, X, ArrowRight, Eye, Inbox,
} from 'lucide-react';
import WorkspacePage, { EmptyState } from './WorkspacePage';
import { inboxItems, INBOX_KINDS } from '../../data/douyin';
import { useAppStore } from '../../store/useAppStore';
import type { InboxKind } from '../../lib/types';

type Source = 'static' | 'risk' | 'exit';

interface UnifiedItem {
  id: string;
  kind: InboxKind;
  title: string;
  agent: string;
  channel: string;
  ts: string;
  detail: string;
  urgent: boolean;
  source: Source;
  done: boolean;
  doneLabel?: string;
}

const KIND_META: Record<InboxKind, { label: string; color: string; icon: React.ReactNode }> = {
  approval: { label: '待我审批', color: '#3B82F6', icon: <FileCheck2 size={13} /> },
  block:    { label: '已阻断',   color: '#EF4444', icon: <Ban size={13} /> },
  stuck:    { label: '卡住',     color: '#F59E0B', icon: <Hourglass size={13} /> },
  accept:   { label: '待验收',   color: '#A855F7', icon: <PackageCheck size={13} /> },
  anomaly:  { label: '异常',     color: '#14B8A6', icon: <Activity size={13} /> },
};

const EXIT_ACTION_LABEL: Record<string, string> = {
  send_client: '发送客户',
  writeback_crm: '回写 CRM',
  publish: '发布',
};

export default function InboxPage() {
  const riskAlerts = useAppStore((s) => s.riskAlerts);
  const exitActions = useAppStore((s) => s.exitActions);
  const inboxDone = useAppStore((s) => s.inboxDone);
  const resolveInbox = useAppStore((s) => s.resolveInbox);
  const approveAlert = useAppStore((s) => s.approveAlert);
  const decideExit = useAppStore((s) => s.decideExit);
  const pushToast = useAppStore((s) => s.pushToast);
  const pushAudit = useAppStore((s) => s.pushAudit);

  const [tab, setTab] = useState<InboxKind | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const items = useMemo<UnifiedItem[]>(() => {
    const fromStatic: UnifiedItem[] = inboxItems.map((it) => ({
      ...it, source: 'static' as const,
      done: it.id in inboxDone,
      doneLabel: inboxDone[it.id],
    }));
    const fromRisk: UnifiedItem[] = riskAlerts.map((a) => ({
      id: `risk-${a.id}`, kind: 'approval' as const,
      title: a.action, agent: a.agent, channel: a.channel, ts: a.ts,
      detail: `${a.reason} 建议：${a.suggestion}`,
      urgent: a.level === 'high' || a.level === 'critical',
      source: 'risk' as const,
      done: a.status !== 'pending',
      doneLabel: a.status === 'approved' ? '已批准' : a.status === 'rejected' ? '已拒绝' : a.status === 'safer' ? '已转安全方式' : undefined,
    }));
    const fromExit: UnifiedItem[] = exitActions.map((e) => ({
      id: `exit-${e.id}`, kind: 'approval' as const,
      title: `交付出口 · ${EXIT_ACTION_LABEL[e.action] ?? e.action}`,
      agent: e.requestedBy, channel: '证据库', ts: e.ts,
      detail: `${e.evidenceName} → ${e.target}，动作生效前需要您审批。`,
      urgent: true,
      source: 'exit' as const,
      done: e.status !== 'pending_approval',
      doneLabel: e.status === 'executed' ? '已批准执行' : e.status === 'rejected' ? '已拒绝' : undefined,
    }));
    return [...fromExit, ...fromRisk, ...fromStatic];
  }, [riskAlerts, exitActions, inboxDone]);

  const filtered = tab === 'all' ? items : items.filter((it) => it.kind === tab);
  const pending = filtered.filter((it) => !it.done);
  const done = filtered.filter((it) => it.done);

  const allPending = items.filter((it) => !it.done);
  const statToday = allPending.length;
  const statUrgent = allPending.filter((it) => it.urgent).length;
  const statDone = items.filter((it) => it.done).length;

  const countOf = (k: InboxKind) => items.filter((it) => it.kind === k && !it.done).length;

  // ── 处理动作 ──────────────────────────────────────────────
  const handleApprove = (item: UnifiedItem, approve: boolean) => {
    if (item.source === 'risk') {
      approveAlert(item.id.replace(/^risk-/, ''), approve ? 'approve' : 'reject');
    } else if (item.source === 'exit') {
      decideExit(item.id.replace(/^exit-/, ''), approve, '昆仑（您）');
    } else {
      resolveInbox(item.id, approve ? '已批准' : '已拒绝');
      pushAudit({
        actor: '昆仑（您）',
        action: approve ? '收件箱审批通过' : '收件箱审批拒绝',
        target: item.title,
        result: approve ? 'ok' : 'blocked',
        tags: ['inbox', 'human-in-loop'],
      });
    }
    pushToast({
      kind: approve ? 'success' : 'warning',
      title: approve ? '已批准' : '已拒绝',
      detail: `${item.title} · 已写入审计链`,
    });
    setExpanded(null);
  };

  const handleResolve = (item: UnifiedItem, mode: 'handle' | 'read') => {
    resolveInbox(item.id, mode === 'handle' ? '已处理' : '已阅');
    if (mode === 'handle') {
      pushAudit({
        actor: '昆仑（您）',
        action: '收件箱处理',
        target: item.title,
        result: 'ok',
        tags: ['inbox'],
      });
    }
    pushToast({
      kind: mode === 'handle' ? 'success' : 'info',
      title: mode === 'handle' ? '已去处理' : '已标记已阅',
      detail: item.title,
    });
    setExpanded(null);
  };

  return (
    <WorkspacePage
      title="收件箱"
      sub="审批 · 阻断 · 卡住 · 待验收 · 异常 — 所有需要您出手的事，都汇总在这里"
      actions={
        <div className="flex items-center gap-3 text-[12px] hum-muted hum-tabular">
          <span>今日待办 <b className="text-neutral-900">{statToday}</b></span>
          <span className="hum-faint">·</span>
          <span>紧急 <b style={{ color: 'var(--error)' }}>{statUrgent}</b></span>
          <span className="hum-faint">·</span>
          <span>已处理 <b style={{ color: 'var(--success)' }}>{statDone}</b></span>
        </div>
      }
      sticky={
        <div className="flex items-center gap-2 flex-wrap">
          <TabBtn active={tab === 'all'} onClick={() => setTab('all')} label={`全部 ${allPending.length}`} />
          {INBOX_KINDS.map((k) => (
            <TabBtn
              key={k.id}
              active={tab === k.id}
              onClick={() => setTab(k.id)}
              label={`${k.label} ${countOf(k.id)}`}
              color={k.color}
              icon={KIND_META[k.id].icon}
            />
          ))}
        </div>
      }
    >
      <div className="p-6 space-y-2 max-w-4xl">
        {pending.length === 0 && (
          <EmptyState
            icon={<Inbox size={18} />}
            title="当前分类没有待办"
            sub="所有事件都已处理，或切换其他分类查看"
          />
        )}
        {pending.map((item) => (
          <InboxRow
            key={item.id}
            item={item}
            expanded={expanded === item.id}
            onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
            onApprove={handleApprove}
            onResolve={handleResolve}
          />
        ))}

        {/* 已处理折叠分组 */}
        {done.length > 0 && (
          <div className="pt-4">
            <button
              onClick={() => setShowDone(!showDone)}
              className="flex items-center gap-1.5 text-[12px] hum-muted hover:text-neutral-900 transition"
            >
              {showDone ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              已处理（{done.length}）
            </button>
            {showDone && (
              <div className="mt-2 space-y-1.5">
                {done.map((item) => (
                  <div key={item.id} className="hum-card-soft px-3 py-2 flex items-center gap-2.5 opacity-70">
                    <span style={{ color: KIND_META[item.kind].color }}>{KIND_META[item.kind].icon}</span>
                    <span className="text-[12.5px] text-neutral-600 line-through decoration-neutral-300 flex-1 truncate">
                      {item.title}
                    </span>
                    <span className="hum-chip is-muted" style={{ padding: '1px 6px', fontSize: 10 }}>
                      {item.doneLabel ?? '已处理'}
                    </span>
                    <span className="hum-faint text-[11px] font-mono">{item.ts}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}

function TabBtn({ active, onClick, label, color, icon }: {
  active: boolean; onClick: () => void; label: string; color?: string; icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium transition ${
        active ? 'bg-neutral-900 text-white' : 'hum-card-soft text-neutral-600 hover:text-neutral-900'
      }`}
    >
      {icon && <span style={active ? undefined : { color }}>{icon}</span>}
      {label}
    </button>
  );
}

function InboxRow({ item, expanded, onToggle, onApprove, onResolve }: {
  item: UnifiedItem;
  expanded: boolean;
  onToggle: () => void;
  onApprove: (item: UnifiedItem, approve: boolean) => void;
  onResolve: (item: UnifiedItem, mode: 'handle' | 'read') => void;
}) {
  const meta = KIND_META[item.kind];
  return (
    <div className={`hum-card overflow-hidden transition ${expanded ? 'hum-elev-2' : ''}`}>
      <button onClick={onToggle} className="w-full text-left px-3.5 py-2.5 flex items-center gap-3 hover:bg-neutral-25 transition">
        <span
          className="w-6 h-6 rounded-md grid place-items-center shrink-0"
          style={{ background: `${meta.color}14`, color: meta.color }}
        >
          {meta.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {item.urgent && <span className="hum-dot shrink-0 hum-pulse" style={{ background: 'var(--error)' }} />}
            <span className="text-[13px] font-medium text-neutral-900 truncate">{item.title}</span>
          </div>
          <div className="text-[11px] hum-muted mt-0.5 truncate">
            {item.agent} · <span className="font-mono">{item.channel}</span>
          </div>
        </div>
        <span
          className="hum-chip shrink-0"
          style={{ padding: '1px 6px', fontSize: 10, background: `${meta.color}14`, color: meta.color, borderColor: `${meta.color}30` }}
        >
          {meta.label}
        </span>
        <span className="hum-faint text-[11px] font-mono shrink-0">{item.ts}</span>
        {expanded ? <ChevronDown size={14} className="text-neutral-400 shrink-0" /> : <ChevronRight size={14} className="text-neutral-400 shrink-0" />}
      </button>

      {expanded && (
        <div className="px-3.5 pb-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <p className="text-[12.5px] text-neutral-700 leading-relaxed pt-3 pl-9">{item.detail}</p>
          <div className="flex items-center gap-2 mt-3 pl-9">
            {item.kind === 'approval' ? (
              <>
                <button className="hum-btn is-sm is-primary" onClick={() => onApprove(item, true)}>
                  <Check size={11} /> 批准
                </button>
                <button className="hum-btn is-sm is-danger" onClick={() => onApprove(item, false)}>
                  <X size={11} /> 拒绝
                </button>
              </>
            ) : (
              <>
                <button className="hum-btn is-sm is-primary" onClick={() => onResolve(item, 'handle')}>
                  <ArrowRight size={11} /> 去处理
                </button>
                <button className="hum-btn is-sm" onClick={() => onResolve(item, 'read')}>
                  <Eye size={11} /> 标记已阅
                </button>
              </>
            )}
            <span className="hum-faint text-[10.5px] ml-auto">处理后自动写入审计链</span>
          </div>
        </div>
      )}
    </div>
  );
}
