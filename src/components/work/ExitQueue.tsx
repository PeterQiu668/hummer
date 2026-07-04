/**
 * 出口队列 — 列出 store.exitActions（待审批 黄 / 已生效 绿 / 已拒绝 红）
 * 老板角色可直接 批准/拒绝（decideExit）；其他角色显示「等待老板审批」
 */
import { CheckCircle2, XCircle, Hourglass, ArrowRight } from 'lucide-react';
import type { DeliverableExitAction } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { ROLE_NAMES } from './taskFlow';
import { ACTION_META } from './ExitActionModal';

const STATUS_CHIP: Record<DeliverableExitAction['status'], { label: string; cls: string }> = {
  pending_approval: { label: '待审批', cls: 'hum-chip is-warning' },
  executed:         { label: '已生效', cls: 'hum-chip is-success' },
  rejected:         { label: '已拒绝', cls: 'hum-chip is-error' },
};

export default function ExitQueue() {
  const exitActions = useAppStore((s) => s.exitActions);
  const decideExit = useAppStore((s) => s.decideExit);
  const pushToast = useAppStore((s) => s.pushToast);
  const currentRole = useAppStore((s) => s.currentRole);
  const isBoss = currentRole === 'boss';

  const decide = (a: DeliverableExitAction, approve: boolean) => {
    decideExit(a.id, approve, ROLE_NAMES.boss);
    pushToast({
      kind: approve ? 'success' : 'warning',
      title: approve ? `已批准出口动作 · ${ACTION_META[a.action].label}` : `已拒绝出口动作 · ${ACTION_META[a.action].label}`,
      detail: `「${a.evidenceName}」→ ${a.target}`,
    });
  };

  const pendingCount = exitActions.filter((a) => a.status === 'pending_approval').length;

  return (
    <div className="hum-card hum-elev-1 overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <Hourglass size={13} className="text-warning" />
        <span className="text-[13px] font-semibold text-neutral-900">交付出口队列</span>
        <span className="hum-chip is-muted">{exitActions.length} 条</span>
        {pendingCount > 0 && <span className="hum-chip is-warning">{pendingCount} 待审批</span>}
        <span className="flex-1" />
        <span className="text-[10.5px] hum-faint">
          {isBoss ? '您可直接批准 / 拒绝' : '出口动作须由老板审批后生效'}
        </span>
      </div>

      {exitActions.length === 0 ? (
        <div className="px-4 py-4 text-[11.5px] hum-faint">
          暂无出口动作。对下方 <b>已审批 / 已交付</b> 的证据点击「发送客户 / 回写 CRM / 发布」即可发起。
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {exitActions.map((a) => {
            const am = ACTION_META[a.action];
            const Icon = am.icon;
            const sc = STATUS_CHIP[a.status];
            return (
              <div key={a.id} className="px-4 py-2.5 flex items-center gap-2.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <Icon size={13} style={{ color: am.color }} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[12.5px]">
                    <span className="font-medium text-neutral-900 truncate">{a.evidenceName}</span>
                    <ArrowRight size={10} className="text-neutral-400 shrink-0" />
                    <span className="text-neutral-700 truncate">{a.target}</span>
                  </div>
                  <div className="text-[10.5px] hum-faint font-mono mt-0.5">
                    {am.label} · 发起 {a.requestedBy} · {a.ts}
                    {a.approvedBy && ` · 审 ${a.approvedBy}`}
                  </div>
                </div>
                <span className={sc.cls} style={{ padding: '1px 6px', fontSize: 10 }}>{sc.label}</span>
                {a.status === 'pending_approval' && (
                  isBoss ? (
                    <span className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => decide(a, true)} className="hum-btn is-sm is-primary">
                        <CheckCircle2 size={11} /> 批准
                      </button>
                      <button onClick={() => decide(a, false)} className="hum-btn is-sm is-danger">
                        <XCircle size={11} /> 拒绝
                      </button>
                    </span>
                  ) : (
                    <span className="text-[10.5px] hum-faint shrink-0">等待老板审批</span>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
