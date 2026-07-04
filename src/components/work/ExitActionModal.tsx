/**
 * 交付出口动作弹窗 — 对 approved/shipped 证据发起「生效动作」
 * 发送客户 / 回写 CRM / 发布 → 选目标 → 确认 → store.requestExit（进入待审批队列，写审计）
 */
import { useState } from 'react';
import { Send, Database, Rss, X, ArrowRight } from 'lucide-react';
import type { ExitActionKind } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { ROLE_NAMES } from './taskFlow';

export const ACTION_META: Record<ExitActionKind, {
  label: string;
  icon: typeof Send;
  color: string;
  targets: string[];
}> = {
  send_client: {
    label: '发送客户', icon: Send, color: '#0F70B7',
    targets: ['鲲鹏制造 · 王总邮箱', '云海制药 · 陈总监邮箱', '飞书外部群「鲲鹏项目组」'],
  },
  writeback_crm: {
    label: '回写 CRM', icon: Database, color: '#1E8F5C',
    targets: ['Salesforce · 商机 #4471', 'Salesforce · 客户档案「鲲鹏制造」', '金蝶 ERP · 应收单 #AR-0623'],
  },
  publish: {
    label: '发布', icon: Rss, color: '#7E22CE',
    targets: ['企业知识库 · SOP 专区', '官网博客 · 客户案例频道', '飞书公告 · 全员频道'],
  },
};

export default function ExitActionModal({
  evidenceId, evidenceName, action, onClose,
}: {
  evidenceId: string;
  evidenceName: string;
  action: ExitActionKind;
  onClose: () => void;
}) {
  const meta = ACTION_META[action];
  const Icon = meta.icon;
  const [target, setTarget] = useState<string | null>(null);
  const requestExit = useAppStore((s) => s.requestExit);
  const pushToast = useAppStore((s) => s.pushToast);
  const currentRole = useAppStore((s) => s.currentRole);

  const confirm = () => {
    if (!target) return;
    requestExit({
      evidenceId,
      evidenceName,
      action,
      target,
      requestedBy: ROLE_NAMES[currentRole],
    });
    pushToast({
      kind: 'info',
      title: `出口动作已发起 · ${meta.label}`,
      detail: `「${evidenceName}」→ ${target} · 等待老板审批后生效`,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: 'rgba(15,15,14,0.32)' }}>
      <div className="hum-card hum-elev-3 w-[400px] max-w-[92vw]">
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon size={14} style={{ color: meta.color }} />
          <span className="text-[13.5px] font-semibold text-neutral-900 flex-1">
            生效动作 · {meta.label}
          </span>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="hum-card-soft p-2.5 text-[12px] text-neutral-700 truncate">
            证据：<b className="text-neutral-900">{evidenceName}</b>
          </div>
          <div>
            <div className="hum-eyebrow mb-1.5">选择目标</div>
            <div className="space-y-1.5">
              {meta.targets.map((t) => (
                <button
                  key={t}
                  onClick={() => setTarget(t)}
                  className="w-full text-left hum-card-soft p-2.5 flex items-center gap-2 transition hover:hum-elev-1"
                  style={target === t ? { borderColor: meta.color, background: `${meta.color}0D` } : undefined}
                >
                  <span
                    className="hum-dot shrink-0"
                    style={{ background: target === t ? meta.color : 'var(--border-strong)' }}
                  />
                  <span className="text-[12.5px] text-neutral-800">{t}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="text-[10.5px] hum-faint">
            确认后进入出口队列，须老板审批通过方可生效；全程写入审计链。
          </div>
        </div>
        <div className="px-4 py-3 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={onClose} className="hum-btn is-sm">取消</button>
          <button onClick={confirm} disabled={!target} className="hum-btn is-sm is-primary disabled:opacity-40">
            确认发起 <ArrowRight size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
