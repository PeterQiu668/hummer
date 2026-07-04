/**
 * CausalChainCard — 个体进化因果链（grills/01 的灵魂）
 * 「周一 bad case → Hermes 归因 → SOP 候选 → 沙箱回归 → 审批 → 灰度 → 周四同类任务成功 → 能力分提升」
 * 垂直时间线，每步带图标、时间与说明。
 */
import {
  AlertTriangle, Brain, GitBranch, FlaskConical,
  UserCheck, Rocket, CheckCircle2, TrendingUp, Link2,
} from 'lucide-react';
import type { CausalChain, CausalStepKind } from '../../data/evolution';

const STEP_META: Record<CausalStepKind, { icon: typeof Brain; color: string; soft: string; label: string }> = {
  badcase:     { icon: AlertTriangle, color: 'var(--error)',   soft: 'var(--error-soft)',   label: 'Bad case' },
  attribution: { icon: Brain,         color: '#7E22CE',        soft: '#F8F0FC',             label: '归因' },
  candidate:   { icon: GitBranch,     color: 'var(--brand)',   soft: 'var(--brand-soft)',   label: '候选版本' },
  sandbox:     { icon: FlaskConical,  color: '#0F766E',        soft: '#EFFAF8',             label: '沙箱回归' },
  approval:    { icon: UserCheck,     color: 'var(--warning)', soft: 'var(--warning-soft)', label: '人审' },
  gray:        { icon: Rocket,        color: 'var(--info)',    soft: '#EDF4FE',             label: '灰度' },
  success:     { icon: CheckCircle2,  color: 'var(--success)', soft: 'var(--success-soft)', label: '任务成功' },
  score:       { icon: TrendingUp,    color: 'var(--brand)',   soft: 'var(--brand-soft)',   label: '能力分' },
};

export default function CausalChainCard({ chain }: { chain: CausalChain }) {
  return (
    <div className="hum-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Link2 size={13} style={{ color: 'var(--brand)' }} className="shrink-0" />
          <span className="text-[13px] font-semibold text-neutral-900 truncate">因果链 · {chain.title}</span>
        </div>
        <span className="hum-chip is-brand shrink-0" style={{ padding: '1px 8px', fontSize: 10.5 }}>
          {chain.scoreFrom} → {chain.scoreTo}
        </span>
      </div>

      <div className="relative pl-1">
        {chain.steps.map((s, i) => {
          const meta = STEP_META[s.kind];
          const Icon = meta.icon;
          const isLast = i === chain.steps.length - 1;
          return (
            <div key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
              {/* 竖线 */}
              {!isLast && (
                <span
                  className="absolute left-[11px] top-6 bottom-0 w-px"
                  style={{ background: 'var(--border)' }}
                />
              )}
              {/* 图标 */}
              <span
                className="w-[23px] h-[23px] rounded-full grid place-items-center shrink-0 relative z-[1]"
                style={{ background: meta.soft, color: meta.color, border: `1px solid ${meta.color}30` }}
              >
                <Icon size={11.5} />
              </span>
              {/* 内容 */}
              <div className="flex-1 min-w-0 -mt-0.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[10.5px] hum-faint font-mono hum-tabular shrink-0">{s.ts}</span>
                  <span className="text-[12.5px] font-medium text-neutral-900">{s.title}</span>
                  <span className="hum-chip" style={{ padding: '0 5px', fontSize: 9, color: meta.color, background: meta.soft, borderColor: `${meta.color}25` }}>
                    {meta.label}
                  </span>
                </div>
                <div className="text-[11.5px] hum-muted mt-0.5 leading-relaxed">{s.detail}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-2.5 text-[10.5px] hum-faint" style={{ borderTop: '1px dashed var(--border-subtle)' }}>
        引用 bad case #{chain.badCaseId} · 全链路入审计账本，可在「审计」页回放
      </div>
    </div>
  );
}
