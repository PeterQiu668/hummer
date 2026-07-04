import { AlertOctagon, X, CheckCircle2, XCircle, Shield } from 'lucide-react';
import type { RiskAlert } from '../../lib/types';

const levelMeta: Record<
  RiskAlert['level'],
  { label: string; ring: string; bar: string; chip: string }
> = {
  low:      { label: 'LOW',      ring: 'ring-success/30',  bar: 'bg-success',  chip: 'bg-success/10 text-success' },
  medium:   { label: 'MEDIUM',   ring: 'ring-warning/30',  bar: 'bg-warning',  chip: 'bg-warning/10 text-warning' },
  high:     { label: 'HIGH',     ring: 'ring-error/30',    bar: 'bg-error',    chip: 'bg-error/10 text-error' },
  critical: { label: 'CRITICAL', ring: 'ring-error/40',    bar: 'bg-error',    chip: 'bg-error text-white' },
};

export default function RiskAlertModal({
  alert,
  onClose,
  onApprove,
  onReject,
  onSafer,
}: {
  alert: RiskAlert;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSafer: () => void;
}) {
  const meta = levelMeta[alert.level];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-[520px] max-w-[92vw] bg-white rounded-lg shadow-large border border-neutral-200 ring-4 ${meta.ring} overflow-hidden`}
      >
        <div className={`h-1 ${meta.bar}`} />
        <div className="px-5 pt-4 pb-2 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center shrink-0">
            <AlertOctagon size={20} className="text-error" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                EXEC-GUARDIAN · {alert.ts}
              </span>
              <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${meta.chip}`}>
                {meta.label}
              </span>
            </div>
            <div className="font-display text-base font-semibold text-neutral-900 mt-0.5">
              风险阻断 · 等待昆仑决策
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-700 rounded transition"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pb-4 space-y-3 text-[12px] text-neutral-700">
          <Row label="触发员工">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-primary-500 text-white text-[10px] font-display font-semibold flex items-center justify-center">
                {alert.agentAvatar}
              </span>
              <span className="font-medium">{alert.agent}</span>
            </span>
          </Row>
          <Row label="动作">{alert.action}</Row>
          <Row label="涉及数据">
            <div className="flex flex-wrap gap-1">
              {alert.data.map((d, i) => (
                <span
                  key={i}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-200 text-neutral-700"
                >
                  {d}
                </span>
              ))}
            </div>
          </Row>
          <Row label="阻断原因">
            <span className="text-error">{alert.reason}</span>
          </Row>
          <Row label="建议">
            <span className="inline-flex items-start gap-1 text-tertiary-700">
              <Shield size={11} className="mt-0.5 shrink-0" />
              {alert.suggestion}
            </span>
          </Row>
        </div>

        <div className="px-5 py-3 bg-neutral-50 border-t border-neutral-200 flex gap-2">
          <button
            onClick={onReject}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-error/40 text-error bg-white hover:bg-error/5 text-[12px] font-medium transition"
          >
            <XCircle size={14} /> 拒绝
          </button>
          <button
            onClick={onSafer}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-tertiary-500/40 text-tertiary-700 bg-white hover:bg-tertiary-500/5 text-[12px] font-medium transition"
          >
            <Shield size={14} /> 改为更安全方式
          </button>
          <button
            onClick={onApprove}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-success/40 text-white bg-success hover:opacity-90 text-[12px] font-medium transition"
          >
            <CheckCircle2 size={14} /> 批准
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-20 shrink-0 text-[10px] font-mono uppercase tracking-wider text-neutral-500 pt-0.5">
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
