/**
 * 专家门户 · 声誉等级 — 评级卡 / 三指标 / 与下一级差距 / 权益说明
 */
import { Medal, TrendingUp, Eye, Percent, ArrowUpRight } from 'lucide-react';
import {
  reputationMetrics, reputationTiers, currentTier, type ReputationMetric,
} from '../../data/expertops';

const TIER_COLOR: Record<string, string> = {
  gold: '#B07706',
  silver: '#6B7280',
  bronze: '#92613A',
};

/** 与金牌门槛的差距描述（正向指标差多少 pp，反向指标是否已达标） */
function gapText(m: ReputationMetric): { met: boolean; text: string } {
  if (m.higherIsBetter) {
    const gap = Math.round((m.goldThreshold - m.value) * 10) / 10;
    return gap <= 0
      ? { met: true, text: `已达金牌门槛（≥ ${m.goldThreshold}%）` }
      : { met: false, text: `距金牌门槛还差 ${gap} 个百分点（需 ≥ ${m.goldThreshold}%）` };
  }
  const gap = Math.round((m.value - m.goldThreshold) * 10) / 10;
  return gap <= 0
    ? { met: true, text: `已达金牌门槛（≤ ${m.goldThreshold}%）` }
    : { met: false, text: `需再降 ${gap} 个百分点（需 ≤ ${m.goldThreshold}%）` };
}

export default function ReputationPanel() {
  const tier = currentTier();
  const gaps = reputationMetrics.map(gapText);
  const unmet = gaps.filter((g) => !g.met).length;

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      {/* 等级卡 */}
      <div className="hum-card p-5 hum-elev-1 flex items-start gap-4">
        <div
          className="w-14 h-14 rounded-xl grid place-items-center shrink-0"
          style={{ background: `${TIER_COLOR[tier.key]}14`, color: TIER_COLOR[tier.key] }}
        >
          <Medal size={26} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[18px] font-semibold text-neutral-900">{tier.label}</span>
            <span className="hum-chip is-warning">当前评级</span>
          </div>
          <div className="mt-1 text-[12.5px] hum-muted">
            {unmet === 0
              ? '三项指标均已达金牌门槛，保持 2 个结算周期后自动晋级'
              : `距离金牌还有 ${unmet} 项指标未达标 · 评级每结算周期（自然月）重算一次`}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[12px]">
            <span className="flex items-center gap-1.5 hum-muted">
              <Percent size={13} style={{ color: 'var(--brand)' }} />
              当前分成比例 <b className="text-neutral-900">{Math.round(tier.shareRate * 100)}%</b>
            </span>
            <span className="flex items-center gap-1.5 hum-muted">
              <Eye size={13} style={{ color: 'var(--brand)' }} />
              曝光权益：{tier.exposure}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right rounded-lg px-3 py-2" style={{ background: 'var(--warning-soft)' }}>
          <div className="text-[11px] font-semibold" style={{ color: 'var(--warning)' }}>晋级金牌可得</div>
          <div className="mt-0.5 text-[16px] font-semibold hum-tabular flex items-center gap-1 justify-end" style={{ color: 'var(--warning)' }}>
            <ArrowUpRight size={14} /> 18% 分成
          </div>
          <div className="text-[10.5px] hum-faint mt-0.5">较当前 +3 个百分点</div>
        </div>
      </div>

      {/* 三个指标 */}
      <div className="grid grid-cols-3 gap-3">
        {reputationMetrics.map((m, i) => {
          const g = gaps[i];
          // 进度条：正向指标按 value/门槛，反向指标按 门槛余量
          const pct = m.higherIsBetter
            ? Math.min(100, Math.round((m.value / m.goldThreshold) * 100))
            : Math.min(100, Math.round((m.goldThreshold / Math.max(m.value, 0.1)) * 100));
          return (
            <div key={m.key} className="hum-card p-4 hum-elev-1">
              <div className="text-[12px] font-medium hum-muted">{m.label}</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-[26px] font-semibold hum-tabular text-neutral-900">{m.value}%</span>
                <span className={`hum-chip ${g.met ? 'is-success' : 'is-warning'}`}>
                  {g.met ? '达标' : '未达金牌'}
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: g.met ? 'var(--success)' : 'var(--warning)' }}
                />
              </div>
              <div className="mt-2 text-[11.5px]" style={{ color: g.met ? 'var(--success)' : 'var(--warning)' }}>
                {g.text}
              </div>
              <div className="mt-1.5 text-[11px] hum-faint leading-relaxed">{m.desc}</div>
            </div>
          );
        })}
      </div>

      {/* 等级规则表 */}
      <div className="hum-card hum-elev-1 overflow-hidden">
        <div className="px-4 py-3 hum-h3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          等级规则与权益
        </div>
        {reputationTiers.map((t) => {
          const active = t.key === tier.key;
          return (
            <div
              key={t.key}
              className="px-4 py-3 flex items-start gap-3"
              style={{
                borderBottom: '1px solid var(--border-subtle)',
                background: active ? 'var(--brand-soft)' : undefined,
              }}
            >
              <Medal size={16} className="shrink-0 mt-0.5" style={{ color: TIER_COLOR[t.key] }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-neutral-900">{t.label}</span>
                  {active && <span className="hum-chip is-brand">我在这里</span>}
                </div>
                <div className="mt-0.5 text-[12px] hum-muted">{t.rule}</div>
              </div>
              <div className="shrink-0 text-right text-[12px]">
                <div className="font-semibold hum-tabular text-neutral-900">{Math.round(t.shareRate * 100)}% 分成</div>
                <div className="hum-faint text-[11px] mt-0.5">{t.exposure}</div>
              </div>
            </div>
          );
        })}
        <div className="px-4 py-3 flex items-start gap-2 text-[11.5px] hum-muted leading-relaxed" style={{ background: 'var(--bg-canvas)' }}>
          <TrendingUp size={13} className="shrink-0 mt-0.5 hum-faint" />
          <span>
            <b className="text-neutral-800">评级影响曝光与分成比例：</b>
            评级越高，你共创的数字员工在员工市场的检索权重与推荐位越靠前，分成比例越高；
            连续 2 个结算周期跌破当前档门槛将自动降级，介入工单 SLA 超时会直接计入 bad case 率。
          </span>
        </div>
      </div>
    </div>
  );
}
