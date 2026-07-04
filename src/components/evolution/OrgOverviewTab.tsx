/**
 * OrgOverviewTab — 进化中心 Tab1 组织层总览
 * 四指标卡（SOP 升级 / 平均能力分 / bad case 修复率 / 进化 ROI）
 * + 本月进化事件时间线 + 各部门能力分对比条形图（纯 div）
 */
import {
  GitCommitHorizontal, TrendingUp, Wrench, Clock3,
  PackagePlus, BadgeCheck, Ban, ArrowRight,
} from 'lucide-react';
import { orgOverview, evolutionEvents, deptScores, type EvolutionEventKind } from '../../data/evolution';

const EVENT_META: Record<EvolutionEventKind, { icon: typeof Wrench; color: string; soft: string; label: string }> = {
  sop:       { icon: GitCommitHorizontal, color: 'var(--brand)',   soft: 'var(--brand-soft)',   label: 'SOP 升级' },
  skill:     { icon: PackagePlus,         color: '#7E22CE',        soft: '#F8F0FC',             label: '技能上架' },
  cert:      { icon: BadgeCheck,          color: 'var(--success)', soft: 'var(--success-soft)', label: '重新认证' },
  eliminate: { icon: Ban,                 color: 'var(--error)',   soft: 'var(--error-soft)',   label: '淘汰建议' },
};

export default function OrgOverviewTab() {
  const o = orgOverview;
  const maxScore = Math.max(...deptScores.map((d) => d.score));

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* 四指标卡 */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          icon={<GitCommitHorizontal size={14} />} color="var(--brand)"
          label="本月 SOP 升级" value={String(o.sopUpgrades)} sub={o.sopUpgradesDelta}
        />
        <StatCard
          icon={<TrendingUp size={14} />} color="var(--success)"
          label="平均能力分" value={`${o.avgScoreFrom} → ${o.avgScoreTo}`} sub={`月环比 +${o.avgScoreTo - o.avgScoreFrom} 分`}
        />
        <StatCard
          icon={<Wrench size={14} />} color="#7E22CE"
          label="Bad case 修复率" value={`${o.badCaseFixRate}%`} sub={`${o.badCaseFixed} / ${o.badCaseTotal} 已修复上线`}
        />
        <StatCard
          icon={<Clock3 size={14} />} color="var(--warning)"
          label="进化 ROI" value={`+${o.roiHours} 人时`} sub={o.roiNote}
        />
      </div>

      {/* 总览横幅 */}
      <div className="hum-card p-4 flex items-center gap-4">
        <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
          <TrendingUp size={17} />
        </div>
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-neutral-900">
            {o.monthLabel}数字团队整体在变强：平均能力分 {o.avgScoreFrom} → {o.avgScoreTo}，{o.sopUpgrades} 次 SOP 升级全部经沙箱回归与人审
          </div>
          <div className="text-[11.5px] hum-muted mt-0.5">
            每一分提升都可下钻到「个体进化档案」的因果链：bad case → 归因 → 候选 → 沙箱 → 审批 → 灰度 → 复测
          </div>
        </div>
        <span className="hum-chip is-success" style={{ fontSize: 12, padding: '3px 10px' }}>
          +{o.avgScoreTo - o.avgScoreFrom} 分
        </span>
      </div>

      <div className="grid grid-cols-5 gap-4">
        {/* 本月进化事件时间线 */}
        <section className="hum-card p-4 col-span-3">
          <div className="hum-eyebrow mb-3">本月进化事件</div>
          <div className="relative">
            {evolutionEvents.map((ev, i) => {
              const meta = EVENT_META[ev.kind];
              const Icon = meta.icon;
              const isLast = i === evolutionEvents.length - 1;
              return (
                <div key={ev.id} className="relative flex gap-3 pb-3.5 last:pb-0">
                  {!isLast && <span className="absolute left-[10px] top-6 bottom-0 w-px" style={{ background: 'var(--border-subtle)' }} />}
                  <span
                    className="w-[21px] h-[21px] rounded-full grid place-items-center shrink-0 relative z-[1]"
                    style={{ background: meta.soft, color: meta.color, border: `1px solid ${meta.color}28` }}
                  >
                    <Icon size={10.5} />
                  </span>
                  <div className="flex-1 min-w-0 -mt-0.5">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[10.5px] hum-faint font-mono hum-tabular">{ev.ts}</span>
                      <span className="text-[12.5px] font-medium text-neutral-900">{ev.title}</span>
                      <span className="hum-chip" style={{ padding: '0 5px', fontSize: 9, color: meta.color, background: meta.soft, borderColor: `${meta.color}25` }}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="text-[11px] hum-muted mt-0.5">
                      <span className="text-neutral-700">{ev.agent}</span> · {ev.detail}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 各部门能力分对比（纯 div 条形图） */}
        <section className="hum-card p-4 col-span-2">
          <div className="flex items-baseline justify-between mb-3">
            <div className="hum-eyebrow">各部门能力分对比</div>
            <div className="text-[10px] hum-faint">灰条为上月</div>
          </div>
          <div className="space-y-3.5">
            {deptScores.map((d) => (
              <div key={d.dept}>
                <div className="flex items-baseline justify-between text-[11.5px] mb-1">
                  <span className="text-neutral-800">{d.dept}</span>
                  <span className="hum-tabular flex items-center gap-1">
                    <span className="hum-faint">{d.prev}</span>
                    <ArrowRight size={9} className="text-neutral-300" />
                    <span className="font-semibold" style={{ color: 'var(--brand)' }}>{d.score}</span>
                  </span>
                </div>
                {/* 上月 */}
                <div className="h-[5px] rounded-full overflow-hidden mb-[3px]" style={{ background: 'var(--bg-subtle)' }}>
                  <div className="h-full rounded-full" style={{ width: `${(d.prev / maxScore) * 100}%`, background: 'var(--border-strong)' }} />
                </div>
                {/* 本月 */}
                <div className="h-[5px] rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
                  <div className="h-full rounded-full" style={{ width: `${(d.score / maxScore) * 100}%`, background: 'var(--brand)' }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 text-[10.5px] hum-faint leading-relaxed" style={{ borderTop: '1px dashed var(--border-subtle)' }}>
            能力分口径：持续在线评测（任务通过率 × 验收质量 × 风险事件），月度报告仅为快照
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div className="hum-card p-3.5">
      <div className="flex items-center gap-1.5 hum-eyebrow" style={{ color }}>
        {icon} <span style={{ color: 'var(--text-faint)' }}>{label}</span>
      </div>
      <div className="text-[22px] font-semibold hum-tabular text-neutral-900 mt-1.5">{value}</div>
      <div className="text-[11px] hum-muted mt-0.5">{sub}</div>
    </div>
  );
}
