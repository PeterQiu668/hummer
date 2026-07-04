/**
 * EvolutionProfile — 个体进化档案（可复用：进化中心 Tab2 全幅 / EmployeeDrawer 紧凑）
 * 内容：能力分曲线（标注版本升级点）+ SOP 版本时间线（douyin.sopVersions）
 *       + 因果链卡片 + 同岗位对比小卡
 */
import { GitCommitHorizontal, Link2, Sparkles, Users } from 'lucide-react';
import { employees } from '../../data/employees';
import { sopVersions } from '../../data/douyin';
import { getAbilityProfile, getCausalChain } from '../../data/evolution';
import AbilityCurve from './AbilityCurve';
import CausalChainCard from './CausalChain';

type Props = {
  employeeId: string;
  /** Drawer 紧凑模式：曲线 + 最近 3 条版本 + 因果链入口按钮 */
  compact?: boolean;
  /** 紧凑模式下点击「查看完整因果链」 */
  onOpenCenter?: () => void;
};

export default function EvolutionProfile({ employeeId, compact = false, onOpenCenter }: Props) {
  const emp = employees.find((e) => e.id === employeeId);
  const profile = getAbilityProfile(employeeId);
  const chain = getCausalChain(employeeId);
  const sop = sopVersions.find((s) => s.agentId === employeeId);

  if (!emp || !profile) {
    return <div className="text-[12px] hum-faint italic py-4 text-center">暂无进化档案</div>;
  }

  const gap = profile.currentScore - profile.roleAvgScore;
  const versionRows = compact ? sop?.history.slice(0, 3) : sop?.history;

  if (compact) {
    return (
      <div className="space-y-3">
        {/* 能力分 + 同岗位对比 */}
        <ScoreStrip current={profile.currentScore} delta={profile.weekDelta} roleAvg={profile.roleAvgScore} gap={gap} />
        {/* 曲线 */}
        <div className="hum-card-soft p-2">
          <div className="hum-eyebrow px-1 pt-0.5 mb-1">能力分 · 近 8 周</div>
          <AbilityCurve points={profile.points} height={96} compact />
        </div>
        {/* 最近 3 条版本记录 */}
        <div className="hum-card-soft p-2.5">
          <div className="hum-eyebrow mb-1.5">SOP 版本 · 最近 {versionRows?.length ?? 0} 条</div>
          {versionRows?.length ? (
            <div className="space-y-1.5">
              {versionRows.map((h) => (
                <div key={h.version} className="flex items-baseline gap-2 text-[11px]">
                  <span className="hum-chip is-brand shrink-0" style={{ padding: '0 5px', fontSize: 9.5 }}>{h.version}</span>
                  <span className="text-neutral-700 flex-1 min-w-0 truncate">{h.note}</span>
                  <span className="hum-faint font-mono hum-tabular shrink-0">{h.accuracy ? `${h.accuracy}%` : '—'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] hum-faint italic">暂无版本记录</div>
          )}
        </div>
        {/* 因果链入口 */}
        <button className="hum-btn is-sm is-primary w-full justify-center" onClick={onOpenCenter}>
          <Link2 size={11} />
          {chain ? `查看完整因果链（${chain.scoreFrom} → ${chain.scoreTo}）` : '进入进化中心查看档案'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 头部：能力分 + 同岗位对比 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="hum-card p-4 col-span-2">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="hum-eyebrow">当前能力分</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-[30px] font-semibold hum-tabular text-neutral-900 leading-none">{profile.currentScore}</span>
                <span
                  className="text-[12px] font-medium hum-tabular"
                  style={{ color: profile.weekDelta >= 0 ? 'var(--success)' : 'var(--error)' }}
                >
                  {profile.weekDelta >= 0 ? '+' : ''}{profile.weekDelta} 本周
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="hum-eyebrow">进化等级</div>
              <div className="flex items-center gap-1 justify-end mt-1 text-[15px] font-semibold" style={{ color: '#7E22CE' }}>
                <Sparkles size={13} /> Lv.{emp.evolution.level}
              </div>
              <div className="text-[10.5px] hum-faint mt-0.5 hum-tabular">
                改进 {emp.evolution.improved} · 待审 {emp.evolution.pending}
              </div>
            </div>
          </div>
          <div className="mt-2">
            <AbilityCurve points={profile.points} height={128} />
          </div>
          <div className="text-[10.5px] hum-faint mt-1 flex items-center gap-1.5">
            <span className="hum-dot" style={{ background: '#7E22CE' }} /> 紫点为 SOP/Skill 版本升级点
          </div>
        </div>

        {/* 同岗位对比小卡 */}
        <div className="hum-card p-4 flex flex-col">
          <div className="hum-eyebrow flex items-center gap-1.5"><Users size={11} /> 同岗位对比</div>
          <div className="mt-3 space-y-3 flex-1">
            <CompareBar label={emp.name} value={profile.currentScore} max={100} color="var(--brand)" bold />
            <CompareBar label={`${emp.role} 平均`} value={profile.roleAvgScore} max={100} color="var(--border-strong)" />
          </div>
          <div
            className="mt-3 text-[11.5px] rounded-md px-2.5 py-2"
            style={{
              background: gap >= 0 ? 'var(--success-soft)' : 'var(--warning-soft)',
              color: gap >= 0 ? 'var(--success)' : 'var(--warning)',
            }}
          >
            {gap >= 0 ? `高于岗位平均 ${gap} 分` : `低于岗位平均 ${-gap} 分`} · 岗位口径：平台同类 Agent 在线评测
          </div>
        </div>
      </div>

      {/* 因果链 */}
      {chain ? (
        <CausalChainCard chain={chain} />
      ) : (
        <div className="hum-card-soft p-4 text-[12px] hum-muted">
          近 4 周无 bad case 触发的完整因果链 · 该员工处于稳定运行期，仅接受周度在线评测
        </div>
      )}

      {/* SOP 版本时间线 */}
      <div className="hum-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GitCommitHorizontal size={13} style={{ color: 'var(--brand)' }} />
            <span className="text-[13px] font-semibold text-neutral-900">SOP 版本时间线</span>
          </div>
          {sop && (
            <span className="text-[10.5px] hum-faint hum-tabular">
              当前 {sop.current} · 累计训练 {sop.trainedRounds} 轮 · 上次升级 {sop.lastBumpAt}
            </span>
          )}
        </div>
        {versionRows?.length ? (
          <div className="space-y-0">
            {versionRows.map((h, i) => (
              <div key={h.version} className="flex items-center gap-3 py-2" style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
                <span className="text-[10.5px] hum-faint font-mono hum-tabular w-14 shrink-0">R{h.round}</span>
                <span className={`hum-chip shrink-0 ${i === 0 ? 'is-brand' : ''}`} style={{ padding: '1px 7px', fontSize: 10.5 }}>{h.version}</span>
                <span className="text-[12px] text-neutral-700 flex-1 min-w-0 truncate">{h.note}</span>
                <span className="text-[11px] hum-tabular w-16 text-right shrink-0" style={{ color: h.accuracy >= 90 ? 'var(--success)' : h.accuracy === 0 ? 'var(--error)' : 'var(--text-muted)' }}>
                  {h.accuracy ? `${h.accuracy}%` : '失败'}
                </span>
                <span className="text-[11px] hum-faint hum-tabular w-14 text-right shrink-0">{h.cost}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px] hum-faint italic py-2">暂无版本记录 · 该员工使用内置 SOP 基线版本</div>
        )}
      </div>
    </div>
  );
}

function ScoreStrip({ current, delta, roleAvg, gap }: { current: number; delta: number; roleAvg: number; gap: number }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <div className="bg-white border border-neutral-150 rounded-md px-2 py-1.5">
        <div className="text-[9.5px] uppercase tracking-wider hum-faint">能力分</div>
        <div className="text-[14px] font-semibold hum-tabular text-neutral-900 mt-0.5">{current}</div>
      </div>
      <div className="bg-white border border-neutral-150 rounded-md px-2 py-1.5">
        <div className="text-[9.5px] uppercase tracking-wider hum-faint">本周</div>
        <div className="text-[14px] font-semibold hum-tabular mt-0.5" style={{ color: delta >= 0 ? 'var(--success)' : 'var(--error)' }}>
          {delta >= 0 ? '+' : ''}{delta}
        </div>
      </div>
      <div className="bg-white border border-neutral-150 rounded-md px-2 py-1.5">
        <div className="text-[9.5px] uppercase tracking-wider hum-faint">vs 岗位均值</div>
        <div className="text-[14px] font-semibold hum-tabular mt-0.5" style={{ color: gap >= 0 ? 'var(--brand)' : 'var(--warning)' }}>
          {gap >= 0 ? '+' : ''}{gap}
        </div>
        <div className="text-[9px] hum-faint hum-tabular">均值 {roleAvg}</div>
      </div>
    </div>
  );
}

function CompareBar({ label, value, max, color, bold }: { label: string; value: number; max: number; color: string; bold?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] mb-1">
        <span className={bold ? 'font-medium text-neutral-900' : 'hum-muted'}>{label}</span>
        <span className={`hum-tabular ${bold ? 'font-semibold text-neutral-900' : 'hum-muted'}`}>{value}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
        <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </div>
    </div>
  );
}
