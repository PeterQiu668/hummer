/**
 * 账本完整性状态卡 — Append-only Ledger 校验状态（mock）
 * 最近校验时间 / 校验通过 N 条 / 篡改检测 0 / 链式哈希连续性
 */
import { ShieldCheck, Link2, Fingerprint, TimerReset } from 'lucide-react';
import type { AuditEntry } from '../../store/useAppStore';

interface LedgerIntegrityCardProps {
  auditLog: AuditEntry[];
}

export default function LedgerIntegrityCard({ auditLog }: LedgerIntegrityCardProps) {
  const latest = auditLog[0];
  const verifiedAt = latest ? latest.ts : '—';
  const total = auditLog.length;

  return (
    <div className="hum-card p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 text-success flex items-center justify-center">
          <ShieldCheck size={14} />
        </span>
        <div>
          <div className="text-[12.5px] font-semibold text-neutral-900">账本完整性 · 校验通过</div>
          <div className="text-[10.5px] hum-faint">
            Append-only（SQLite WAL + 触发器）· 每条记录以前序 hash 链式签名，任何篡改都会使后续全链失效
          </div>
        </div>
        <span className="hum-chip is-success ml-auto" style={{ fontSize: 10.5 }}>实时守护中</span>
      </div>

      {/* 校验进度感 */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10.5px] hum-faint mb-1">
          <span>链式哈希逐条重算 · 创世块 0x0000 → 最新块 {latest ? latest.hash : '—'}</span>
          <span className="hum-tabular text-success font-medium">{total} / {total} 条通过 · 100%</span>
        </div>
        <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: '100%', background: 'var(--success)' }} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <IntegrityStat icon={TimerReset} label="最近校验时间" value={verifiedAt} sub="每次写入后自动重校验" />
        <IntegrityStat icon={Link2} label="校验通过" value={`${total} 条`} sub="哈希链连续 · 无断点" />
        <IntegrityStat icon={Fingerprint} label="篡改检测" value="0" sub="签名 / 时序 / 哈希三重比对" good />
      </div>
    </div>
  );
}

function IntegrityStat({
  icon: Icon, label, value, sub, good,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  sub: string;
  good?: boolean;
}) {
  return (
    <div className="hum-card-soft rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 hum-eyebrow">
        <Icon size={11} /> {label}
      </div>
      <div className={`text-[16px] font-semibold mt-0.5 hum-tabular ${good ? 'text-success' : 'text-neutral-900'}`}>
        {value}
      </div>
      <div className="text-[10px] hum-faint mt-0.5">{sub}</div>
    </div>
  );
}
