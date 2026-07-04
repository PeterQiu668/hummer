/**
 * MechanismTab — 进化中心 Tab3 机制层
 * 飞轮 5 阶段横向管道（detected → optimizing → sandbox → review → shipped）
 * + 各阶段 case 卡（hermes.badcases 按 stage 分组，点开看 trace 明细）
 * + 进化策略卡（evolutionConfig：频率 / 成本上限 / 风险阈值 / 强制人审）
 */
import { useState } from 'react';
import {
  Radar, Wrench, FlaskConical, UserCheck, Rocket, ChevronRight,
  Brain, TerminalSquare, Eye, XCircle, Timer, CircleDollarSign, ShieldAlert, UserCog,
} from 'lucide-react';
import { hermesBadCases, evolutionStats, traces, evolutionConfig } from '../../data/hermes';
import type { HermesBadCase } from '../../lib/types';

type StageId = HermesBadCase['stage'];

const STAGES: { id: StageId; label: string; en: string; icon: typeof Radar; color: string; soft: string; count: number }[] = [
  { id: 'detected',   label: '发现',     en: 'detected',   icon: Radar,        color: '#6B6B65',        soft: 'var(--bg-subtle)',    count: evolutionStats.detected },
  { id: 'optimizing', label: '优化中',   en: 'optimizing', icon: Wrench,       color: 'var(--warning)', soft: 'var(--warning-soft)', count: evolutionStats.optimizing },
  { id: 'sandbox',    label: '沙箱评测', en: 'sandbox',    icon: FlaskConical, color: '#0F766E',        soft: '#EFFAF8',             count: evolutionStats.sandbox },
  { id: 'review',     label: '人审',     en: 'review',     icon: UserCheck,    color: '#7E22CE',        soft: '#F8F0FC',             count: evolutionStats.reviewing },
  { id: 'shipped',    label: '已上线',   en: 'shipped',    icon: Rocket,       color: 'var(--success)', soft: 'var(--success-soft)', count: evolutionStats.shipped },
];

const LINE_META = {
  reason:      { icon: Brain,          color: '#7E22CE',        label: 'REASON' },
  tool:        { icon: TerminalSquare, color: 'var(--brand)',   label: 'TOOL' },
  observation: { icon: Eye,            color: 'var(--success)', label: 'OBS' },
  fail:        { icon: XCircle,        color: 'var(--error)',   label: 'FAIL' },
} as const;

export default function MechanismTab() {
  const [openCase, setOpenCase] = useState<string | null>(null);

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* 飞轮 5 阶段横向管道 */}
      <section className="hum-card p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="hum-eyebrow">质量飞轮 · 5 阶段受控管道</div>
          <div className="text-[10.5px] hum-faint hum-tabular">累计运行 {evolutionStats.totalRuns} 次 · 平均增益 {evolutionStats.avgGain} · 累计成本 {evolutionStats.costToDate}</div>
        </div>
        <div className="flex items-stretch gap-0">
          {STAGES.map((s, i) => {
            const Icon = s.icon;
            const cases = hermesBadCases.filter((c) => c.stage === s.id);
            return (
              <div key={s.id} className="flex items-stretch flex-1 min-w-0">
                <div className="flex-1 min-w-0 rounded-lg p-3" style={{ background: s.soft, border: `1px solid ${s.color}22` }}>
                  <div className="flex items-center gap-1.5" style={{ color: s.color }}>
                    <Icon size={13} />
                    <span className="text-[12px] font-semibold">{s.label}</span>
                  </div>
                  <div className="text-[9.5px] font-mono mt-0.5" style={{ color: s.color, opacity: 0.7 }}>{s.en}</div>
                  <div className="text-[20px] font-semibold hum-tabular mt-1.5 text-neutral-900">{s.count}</div>
                  <div className="text-[10px] hum-muted">在此阶段 · 本页示例 {cases.length} 例</div>
                </div>
                {i < STAGES.length - 1 && (
                  <div className="grid place-items-center px-1 shrink-0">
                    <ChevronRight size={13} className="text-neutral-300" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-[10.5px] hum-faint">
          进化是受控的：候选改进必须通过沙箱回归，涉敏 / 涉资金变更强制人审，上线后灰度放量并持续复测
        </div>
      </section>

      {/* 进化策略卡 */}
      <section>
        <div className="hum-eyebrow mb-2">进化策略（Hermes 配置）</div>
        <div className="grid grid-cols-4 gap-3">
          <ConfigCard icon={<Timer size={14} />} color="var(--brand)" label="进化频率" value={`每 ${evolutionConfig.evolutionFreqHours} 小时`} sub="自动扫描 bad case 队列并触发归因" />
          <ConfigCard icon={<CircleDollarSign size={14} />} color="var(--warning)" label="成本上限" value={`$${evolutionConfig.costCapPerDay}/天`} sub="超限自动暂停训练，次日恢复" />
          <ConfigCard icon={<ShieldAlert size={14} />} color="#0F766E" label="风险阈值" value={{ low: '低', medium: '中', high: '高' }[evolutionConfig.riskThreshold]} sub="高于阈值的改动不允许自动上线" />
          <ConfigCard icon={<UserCog size={14} />} color="#7E22CE" label="强制人审" value={evolutionConfig.humanReviewRequired ? '已开启' : '关闭'} sub="涉敏 / 涉资金 / 外发类改动必须人签" />
        </div>
      </section>

      {/* case 列表（按阶段分组，点开看 trace） */}
      <section className="hum-card overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="hum-eyebrow">Bad case 明细 · 按阶段</span>
          <span className="text-[10.5px] hum-faint">点击 case 展开执行轨迹（trace）</span>
        </div>
        {STAGES.slice().reverse().map((s) => {
          const cases = hermesBadCases.filter((c) => c.stage === s.id);
          if (!cases.length) return null;
          return (
            <div key={s.id}>
              <div className="px-4 py-1.5 flex items-center gap-2" style={{ background: 'var(--bg-canvas)', borderTop: '1px solid var(--border-subtle)' }}>
                <span className="hum-dot" style={{ background: s.color }} />
                <span className="text-[10.5px] font-semibold" style={{ color: s.color }}>{s.label} · {s.en}</span>
              </div>
              {cases.map((c) => (
                <CaseRow key={c.id} c={c} open={openCase === c.id} onToggle={() => setOpenCase(openCase === c.id ? null : c.id)} />
              ))}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function CaseRow({ c, open, onToggle }: { c: HermesBadCase; open: boolean; onToggle: () => void }) {
  const trace = traces.find((t) => t.caseId === c.id);
  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <button onClick={onToggle} className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-neutral-25 transition text-left">
        <ChevronRight size={12} className={`text-neutral-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-[10.5px] hum-faint font-mono shrink-0">#{c.id}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-neutral-900 truncate">{c.title}</div>
          <div className="text-[11px] hum-muted truncate">{c.agent} · {c.cause}</div>
        </div>
        <span className="hum-chip is-brand shrink-0" style={{ padding: '1px 7px', fontSize: 10 }}>{c.delta}</span>
        <span className="text-[11px] hum-faint hum-tabular w-12 text-right shrink-0">{c.cost}</span>
      </button>

      {open && (
        <div className="px-4 pb-3 pl-11">
          <div className="hum-card-soft p-3">
            <div className="text-[11.5px] text-neutral-700 mb-2">
              <span className="hum-eyebrow mr-2">改进</span>{c.improvement}
            </div>
            {trace ? (
              <>
                <div className="flex items-center gap-3 text-[10.5px] hum-faint hum-tabular mb-2 pb-2" style={{ borderBottom: '1px dashed var(--border-subtle)' }}>
                  <span className="font-medium text-neutral-700">{trace.taskName}</span>
                  <span>{(trace.durationMs / 1000).toFixed(1)}s</span>
                  <span>{trace.tokens.toLocaleString()} tok</span>
                  <span>{trace.cost}</span>
                  <span className="text-error truncate">失败点：{trace.failurePoint}</span>
                </div>
                <div className="space-y-1 font-mono">
                  {trace.lines.map((l, i) => {
                    const meta = LINE_META[l.kind];
                    const Icon = meta.icon;
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-[10.5px] leading-relaxed rounded px-1.5 py-0.5"
                        style={l.kind === 'fail' ? { background: 'var(--error-soft)' } : undefined}
                      >
                        <span className="hum-faint hum-tabular shrink-0 w-[74px]">{l.ts}</span>
                        <span className="shrink-0 flex items-center gap-1 w-[58px] font-semibold" style={{ color: meta.color }}>
                          <Icon size={9.5} /> {meta.label}
                        </span>
                        <span className={l.kind === 'fail' ? 'text-error' : l.kind === 'tool' ? 'text-neutral-800' : 'text-neutral-600'}>
                          {l.text}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="text-[11px] hum-faint italic">该 case 尚未生成执行轨迹（trace）· 归因排队中</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div className="hum-card p-3.5">
      <div className="flex items-center gap-1.5 hum-eyebrow" style={{ color }}>
        {icon} <span style={{ color: 'var(--text-faint)' }}>{label}</span>
      </div>
      <div className="text-[17px] font-semibold hum-tabular text-neutral-900 mt-1.5">{value}</div>
      <div className="text-[10.5px] hum-muted mt-0.5 leading-relaxed">{sub}</div>
    </div>
  );
}
