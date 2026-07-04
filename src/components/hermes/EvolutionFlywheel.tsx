/**
 * 质量与复盘 (前身 Hermes 进化飞轮)
 * 按 brief 第四条：理念融入，不做对标名栏目。文案+视觉都剔除 Hermes/GEPA 等对标对象名。
 * 5 阶段闭环：bad case 发现 → 优化 → 沙箱评测 → 待审 → 上线，可见可点。
 */
import { motion } from 'framer-motion';
import {
  X, Sparkles, AlertTriangle, Activity, FlaskConical, FileCheck2, Rocket,
  TrendingUp, BookOpen, ChevronRight,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { hermesBadCases, evolutionStats } from '../../data/hermes';

const stages = [
  { id: 'detected',   label: 'Bad Case 发现', icon: AlertTriangle, color: '#C13D3D', bg: 'var(--error-soft)' },
  { id: 'optimizing', label: '改进中',         icon: Activity,      color: '#B07706', bg: 'var(--warning-soft)' },
  { id: 'sandbox',    label: '沙箱评测',       icon: FlaskConical,  color: '#7E22CE', bg: '#F8F0FC' },
  { id: 'review',     label: '人审待发布',     icon: FileCheck2,    color: '#0F70B7', bg: 'var(--brand-soft)' },
  { id: 'shipped',    label: '已发布上线',     icon: Rocket,        color: '#1E8F5C', bg: 'var(--success-soft)' },
];

export default function EvolutionFlywheel() {
  const setShowHermes = useAppStore((s) => s.setShowHermes);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex"
      style={{ background: 'rgba(15,15,14,0.32)', backdropFilter: 'blur(4px)' }}
      onClick={() => setShowHermes(false)}
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="m-6 flex-1 bg-white rounded-xl overflow-hidden flex flex-col"
        style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="w-10 h-10 rounded-lg bg-secondary-50 grid place-items-center">
            <Sparkles size={18} className="text-secondary-700" />
          </div>
          <div className="flex-1">
            <h1 className="hum-h1 text-[20px]">质量与复盘</h1>
            <p className="text-[12px] hum-muted mt-0.5">
              每次任务完成 → 记录轨迹 → 标记 bad case → 改进 SOP / Skill → 沙箱评测 → 人审 → 发布上线
            </p>
          </div>
          <button onClick={() => setShowHermes(false)} className="text-neutral-400 hover:text-neutral-900">
            <X size={20} />
          </button>
        </div>

        {/* Stats row */}
        <div className="px-6 pt-4 grid grid-cols-8 gap-2">
          <Stat label="累计运行" value={String(evolutionStats.totalRuns)} />
          <Stat label="累计成本" value={evolutionStats.costToDate} />
          <Stat label="平均增益" value={evolutionStats.avgGain} accent />
          {stages.map((s) => (
            <Pill key={s.id} label={s.label.replace('Bad Case ', '').replace('人审待', '')} value={
              s.id === 'detected' ? evolutionStats.detected :
              s.id === 'optimizing' ? evolutionStats.optimizing :
              s.id === 'sandbox' ? evolutionStats.sandbox :
              s.id === 'review' ? evolutionStats.reviewing :
              evolutionStats.shipped
            } color={s.color} bg={s.bg} />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-12 gap-4">
          {/* Closed-loop flow visual */}
          <div className="col-span-12 lg:col-span-5 hum-card-soft p-5 flex flex-col">
            <div className="hum-eyebrow mb-3">闭环 · 5 阶段</div>
            <div className="space-y-2 flex-1">
              {stages.map((s, i) => {
                const Icon = s.icon;
                const count =
                  s.id === 'detected' ? evolutionStats.detected :
                  s.id === 'optimizing' ? evolutionStats.optimizing :
                  s.id === 'sandbox' ? evolutionStats.sandbox :
                  s.id === 'review' ? evolutionStats.reviewing :
                  evolutionStats.shipped;
                return (
                  <div key={s.id} className="flex items-center gap-3 hum-card p-3"
                    style={{ borderLeft: `3px solid ${s.color}` }}>
                    <div className="w-9 h-9 rounded-md grid place-items-center" style={{ background: s.bg }}>
                      <Icon size={15} style={{ color: s.color }} />
                    </div>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium text-neutral-900">{s.label}</div>
                      <div className="text-[10.5px] hum-faint font-mono mt-0.5">阶段 {i + 1} / 5</div>
                    </div>
                    <div className="text-[18px] font-semibold hum-tabular" style={{ color: s.color }}>{count}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 hum-card-soft p-3 flex items-start gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <BookOpen size={14} className="text-tertiary-600 mt-0.5" />
              <div className="text-[11.5px] text-neutral-700 leading-relaxed">
                所有沉淀都会自动写入<b className="text-neutral-900">知识中枢</b>，作为下次执行的经验依据。
              </div>
            </div>
          </div>

          {/* Bad case stream */}
          <div className="col-span-12 lg:col-span-7 hum-card-soft overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="hum-eyebrow">最近 Bad Case 流水</div>
              <span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}>
                <span className="w-1.5 h-1.5 rounded-full hum-pulse" style={{ background: 'var(--success)' }} /> 实时
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {hermesBadCases.map((b) => {
                const stage = stages.find((s) => s.id === b.stage)!;
                const Icon = stage.icon;
                return (
                  <div key={b.id} className="hum-card p-3" style={{ borderLeft: `3px solid ${stage.color}` }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon size={13} style={{ color: stage.color }} />
                      <span className="text-[13px] font-semibold text-neutral-900 flex-1">{b.title}</span>
                      <span className="hum-chip" style={{ padding: '1px 6px', fontSize: 10, background: stage.bg, color: stage.color, borderColor: `${stage.color}33` }}>
                        {stage.label}
                      </span>
                    </div>
                    <div className="text-[11px] hum-muted mt-0.5">
                      来源：<span className="text-neutral-900">{b.agent}</span> · 成本 {b.cost}
                    </div>
                    <div className="text-[11.5px] text-neutral-700 mt-1.5 leading-snug">
                      <span className="text-error">原因：</span>{b.cause}
                    </div>
                    <div className="text-[11.5px] text-neutral-700 mt-1 leading-snug">
                      <span className="text-secondary-700">改进：</span>{b.improvement}
                    </div>
                    <div className="text-[11.5px] text-success mt-1 font-mono flex items-center gap-1">
                      <TrendingUp size={11} /> {b.delta}
                    </div>
                    <div className="mt-2 pt-2 flex items-center gap-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <button className="hum-btn is-sm">查看轨迹</button>
                      <button className="hum-btn is-sm">回写知识中枢 <ChevronRight size={11} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-2.5 flex items-center gap-3 bg-neutral-25 text-[11.5px] text-neutral-600" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <Sparkles size={12} className="text-secondary-600" />
          <span>质量复盘已嵌入员工详情 · 任务详情 · 知识中枢，每个产出物自动进入循环。</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="hum-card-soft px-2.5 py-2">
      <div className="hum-eyebrow">{label}</div>
      <div className={`text-[14px] font-semibold mt-0.5 hum-tabular ${accent ? 'text-secondary-700' : 'text-neutral-900'}`}>{value}</div>
    </div>
  );
}

function Pill({ label, value, color, bg }: { label: string; value: number | string; color: string; bg: string }) {
  return (
    <div className="rounded-md px-2.5 py-2" style={{ background: bg, border: `1px solid ${color}33` }}>
      <div className="text-[9.5px] uppercase tracking-wider hum-faint">{label}</div>
      <div className="text-[14px] font-semibold mt-0.5 hum-tabular" style={{ color }}>{value}</div>
    </div>
  );
}
