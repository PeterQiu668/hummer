/**
 * 我的招聘 · 生命周期看板（Phase 0 缺口⑥）
 * 候选数字员工按五阶段（market→trial→scoring→authorizing→onboarded）分组，
 * 卡片展示生命周期进度条；点击卡片打开试岗报告卡（TrialReportCard），
 * 转正走授权仪式（AuthorizationCeremony），完成信任闭环。
 */
import { useMemo, useState } from 'react';
import { Users, AlertTriangle, BadgeCheck, Clock3, Undo2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  buildCandidateViews, STAGE_META, STAGE_ORDER, TRIAL_DAYS,
  type CandidateView,
} from '../../data/trial';
import type { LifecycleStage } from '../../lib/types';
import TrialReportCard from './TrialReportCard';
import AuthorizationCeremony from './AuthorizationCeremony';

const STAGE_INDEX: Record<LifecycleStage, number> = {
  market: 0, trial: 1, scoring: 2, authorizing: 3, onboarded: 4,
};

/** 五段生命周期进度条 */
export function LifecycleProgress({ stage }: { stage: LifecycleStage }) {
  const idx = STAGE_INDEX[stage];
  return (
    <div>
      <div className="flex items-center gap-1">
        {STAGE_META.map((s, i) => (
          <div
            key={s.id}
            className="h-1.5 flex-1 rounded-full transition-colors"
            style={{ background: i <= idx ? STAGE_META[idx].color : 'var(--bg-subtle)' }}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between text-[9.5px] hum-faint">
        <span>市场</span><span>试岗</span><span>评分</span><span>授权</span><span>入工区</span>
      </div>
    </div>
  );
}

/** 决策终态徽标 */
function DecisionBadge({ v }: { v: CandidateView }) {
  if (v.grant || (v.decision?.decision === 'promote' && v.stage === 'onboarded')) {
    return <span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}><BadgeCheck size={10} /> 已转正</span>;
  }
  if (v.decision?.decision === 'promote') {
    return <span className="hum-chip is-brand" style={{ padding: '1px 6px', fontSize: 10 }}><Clock3 size={10} /> 待授权签署</span>;
  }
  if (v.decision?.decision === 'extend') {
    return <span className="hum-chip is-warning" style={{ padding: '1px 6px', fontSize: 10 }}><Clock3 size={10} /> 试岗延长 +3 天</span>;
  }
  if (v.decision?.decision === 'return') {
    return <span className="hum-chip is-error" style={{ padding: '1px 6px', fontSize: 10 }}><Undo2 size={10} /> 已退回市场</span>;
  }
  return null;
}

function CandidateCard({ v, onOpen }: { v: CandidateView; onOpen: () => void }) {
  const needDecision = !v.decision && (v.cand.trialDay ?? 0) >= TRIAL_DAYS && v.stage !== 'onboarded' && v.stage !== 'authorizing';
  const m = v.cand.trialMetrics;
  return (
    <button
      onClick={onOpen}
      className="hum-card p-3.5 text-left w-full hover:hum-elev-2 transition flex flex-col gap-2.5"
      style={needDecision ? { borderColor: 'var(--warning)' } : undefined}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg grid place-items-center text-white font-bold shrink-0" style={{ background: v.emp.color }}>
          {v.emp.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-neutral-900 truncate">{v.emp.name}</div>
          <div className="text-[10.5px] hum-faint truncate">{v.emp.category} · {v.emp.expert} 共创</div>
        </div>
        {typeof v.cand.trialScore === 'number' && (
          <div className="text-right shrink-0">
            <div className="text-[18px] font-bold hum-tabular leading-none" style={{ color: v.cand.trialScore >= 85 ? 'var(--success)' : v.cand.trialScore >= 70 ? 'var(--text-ink)' : 'var(--warning)' }}>
              {v.cand.trialScore}
            </div>
            <div className="text-[9px] hum-faint">试岗评分</div>
          </div>
        )}
      </div>

      <LifecycleProgress stage={v.stage} />

      <div className="flex items-center gap-1.5 flex-wrap">
        {v.stage !== 'market' && v.stage !== 'onboarded' && (
          <span className="hum-chip" style={{ padding: '1px 6px', fontSize: 10 }}>
            试岗第 {Math.min(v.cand.trialDay ?? 1, v.deadlineDays)}/{v.deadlineDays} 天
          </span>
        )}
        {m && (
          <span className="hum-chip" style={{ padding: '1px 6px', fontSize: 10 }}>
            完成 {m.completed} · 质量 {m.quality}
          </span>
        )}
        {m && m.risks > 0 && (
          <span className="hum-chip is-error" style={{ padding: '1px 6px', fontSize: 10 }}>
            <AlertTriangle size={9} /> 风险 {m.risks}
          </span>
        )}
        <span className="flex-1" />
        <DecisionBadge v={v} />
        {!v.decision && v.stage === 'authorizing' && (
          <span className="hum-chip is-brand" style={{ padding: '1px 6px', fontSize: 10 }}>授权待签署</span>
        )}
        {needDecision && (
          <span className="hum-chip is-warning hum-pulse" style={{ padding: '1px 6px', fontSize: 10 }}>
            第 7 天 · 待决策
          </span>
        )}
      </div>
    </button>
  );
}

export default function LifecycleBoard({ installed }: { installed: Record<string, boolean> }) {
  const trialDecisions = useAppStore((s) => s.trialDecisions);
  const grants = useAppStore((s) => s.grants);

  const [openId, setOpenId] = useState<string | null>(null);          // 试岗报告卡
  const [ceremonyId, setCeremonyId] = useState<string | null>(null);  // 授权仪式

  const views = useMemo(
    () => buildCandidateViews(installed, trialDecisions, grants),
    [installed, trialDecisions, grants],
  );

  const grouped = useMemo(() => {
    const order = [...STAGE_ORDER].reverse(); // onboarded 在前，market（已退回）殿后
    return order
      .map((stage) => ({ stage, meta: STAGE_META.find((s) => s.id === stage)!, items: views.filter((v) => v.stage === stage) }))
      .filter((g) => g.items.length > 0);
  }, [views]);

  const openView = openId ? views.find((v) => v.emp.id === openId) ?? null : null;
  const ceremonyView = ceremonyId ? views.find((v) => v.emp.id === ceremonyId) ?? null : null;

  if (views.length === 0) {
    return (
      <div className="flex-1 grid place-items-center p-12">
        <div className="hum-card-soft p-8 text-center max-w-md">
          <div className="w-12 h-12 rounded-full bg-neutral-100 grid place-items-center text-neutral-500 mx-auto mb-3">
            <Users size={20} />
          </div>
          <div className="text-[14px] font-semibold text-neutral-900">尚未招聘任何员工</div>
          <p className="text-[12.5px] hum-muted mt-1">从「浏览员工」选择岗位，或直接选「团队套餐」一键部署</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 relative">
      <div className="hum-card-soft px-4 py-2.5 flex items-center gap-2 text-[12px] text-neutral-700">
        <Clock3 size={13} className="text-warning shrink-0" />
        招聘 → 沙箱试岗 7 天 → 评分 → <span className="font-medium">第 7 天强制决策</span>（转正并授权 / 延长 3 天 / 退回市场）→ 授权仪式签署后入工区
      </div>

      {grouped.map((g) => (
        <section key={g.stage}>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="hum-dot" style={{ background: g.meta.color, width: 8, height: 8 }} />
            <span className="text-[12.5px] font-semibold text-neutral-900">
              {g.stage === 'market' ? '已退回市场' : g.meta.label}
            </span>
            <span className="text-[11px] hum-faint hum-tabular">({g.items.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {g.items.map((v) => (
              <CandidateCard key={v.emp.id} v={v} onOpen={() => setOpenId(v.emp.id)} />
            ))}
          </div>
        </section>
      ))}

      {openView && (
        <TrialReportCard
          view={openView}
          onClose={() => setOpenId(null)}
          onPromote={() => { setOpenId(null); setCeremonyId(openView.emp.id); }}
        />
      )}
      {ceremonyView && (
        <AuthorizationCeremony view={ceremonyView} onClose={() => setCeremonyId(null)} />
      )}
    </div>
  );
}
