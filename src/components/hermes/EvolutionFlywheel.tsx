import { motion } from 'framer-motion';
import { X, Sparkles, Activity, FlaskConical, FileCheck2, Rocket, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { hermesBadCases, evolutionStats } from '../../data/hermes';

const stages = [
  { id: 'detected', label: 'Bad Case 发现', icon: AlertTriangle, color: '#ff3860' },
  { id: 'optimizing', label: 'GEPA 优化', icon: Activity, color: '#ffb800' },
  { id: 'sandbox', label: '沙箱评测', icon: FlaskConical, color: '#a855f7' },
  { id: 'review', label: '人审待发布', icon: FileCheck2, color: '#00ffff' },
  { id: 'shipped', label: '已发布上线', icon: Rocket, color: '#00ff88' },
];

export default function EvolutionFlywheel() {
  const { setShowHermes } = useAppStore();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 bg-ink-900/85 backdrop-blur-md flex"
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        className="m-6 flex-1 glass-strong rounded-sm relative hud-corner flex flex-col overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-neon-cyan/20 flex items-center gap-3 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-neon-magenta/10 to-transparent pointer-events-none" />
          <Sparkles size={22} className="text-neon-magenta relative" />
          <div className="relative">
            <div className="font-display text-xl tracking-widest neon-text-magenta">Hermes 进化飞轮</div>
            <div className="text-[11px] font-mono text-neon-magenta/70">CLOSED-LOOP SELF-EVOLUTION · GEPA + DSPy · 进化 Prompt / SOP / Skill / 工具路由</div>
          </div>
          <div className="flex-1" />
          <button onClick={() => setShowHermes(false)} className="text-slate-400 hover:text-neon-cyan">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-12 gap-4">
          {/* Flywheel */}
          <div className="col-span-12 lg:col-span-6 glass rounded-sm relative hud-corner p-6 flex flex-col items-center justify-center min-h-[420px]">
            <div className="relative w-80 h-80">
              {/* Outer rotating rings */}
              <motion.div
                className="absolute inset-0 rounded-full border border-neon-magenta/40"
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              />
              <motion.div
                className="absolute inset-6 rounded-full border border-neon-cyan/30 border-dashed"
                animate={{ rotate: -360 }}
                transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
              />
              <motion.div
                className="absolute inset-12 rounded-full border border-neon-purple/30"
                animate={{ rotate: 360 }}
                transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
              />

              {/* Stage nodes on outer ring */}
              {stages.map((s, i) => {
                const angle = (i / stages.length) * Math.PI * 2 - Math.PI / 2;
                const x = Math.cos(angle) * 145 + 160;
                const y = Math.sin(angle) * 145 + 160;
                const Icon = s.icon;
                return (
                  <div
                    key={s.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
                    style={{ left: x, top: y }}
                  >
                    <div
                      className="w-12 h-12 rounded-sm glass-strong border flex items-center justify-center"
                      style={{ borderColor: `${s.color}88`, boxShadow: `0 0 14px ${s.color}55` }}
                    >
                      <Icon size={16} style={{ color: s.color }} />
                    </div>
                    <div className="text-[10px] font-mono text-center whitespace-nowrap" style={{ color: s.color }}>
                      {s.label}
                    </div>
                  </div>
                );
              })}

              {/* Center hub */}
              <div className="absolute inset-1/3 rounded-full bg-gradient-to-br from-neon-magenta/20 to-neon-cyan/20 border border-neon-magenta/40 flex flex-col items-center justify-center shadow-neon-magenta">
                <div className="font-display text-2xl neon-text-magenta">⟁</div>
                <div className="font-display text-xs neon-text-magenta tracking-widest">HERMES</div>
                <div className="text-[10px] font-mono text-neon-cyan/70 mt-1">v0.9.3 · OnLoop</div>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-2 mt-6 w-full">
              <Pill label="发现" value={evolutionStats.detected} color="#ff3860" />
              <Pill label="优化中" value={evolutionStats.optimizing} color="#ffb800" />
              <Pill label="沙箱" value={evolutionStats.sandbox} color="#a855f7" />
              <Pill label="待审" value={evolutionStats.reviewing} color="#00ffff" />
              <Pill label="已发布" value={evolutionStats.shipped} color="#00ff88" />
            </div>
          </div>

          {/* Bad case stream */}
          <div className="col-span-12 lg:col-span-6 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <KV label="累计运行" value={String(evolutionStats.totalRuns)} />
              <KV label="累计成本" value={evolutionStats.costToDate} />
              <KV label="平均增益" value={evolutionStats.avgGain} />
            </div>

            <div className="glass rounded-sm relative hud-corner">
              <div className="px-3 py-2 border-b border-neon-cyan/10 flex items-center justify-between">
                <div className="text-[11px] font-display tracking-widest text-neon-cyan">Bad Case 流水</div>
                <span className="text-[10px] font-mono text-neon-magenta animate-pulse">● 实时</span>
              </div>
              <div className="p-3 space-y-2 max-h-[480px] overflow-y-auto">
                {hermesBadCases.map((b) => {
                  const stage = stages.find((s) => s.id === b.stage)!;
                  const Icon = stage.icon;
                  return (
                    <div key={b.id} className="glass rounded-sm p-3 border" style={{ borderColor: `${stage.color}40` }}>
                      <div className="flex items-center gap-2 mb-1">
                        <Icon size={14} style={{ color: stage.color }} />
                        <span className="text-xs font-display text-slate-200 flex-1">{b.title}</span>
                        <span className="chip" style={{ color: stage.color, borderColor: `${stage.color}66`, background: `${stage.color}11` }}>
                          {stage.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        来源：<span className="text-slate-200">{b.agent}</span> · 成本 {b.cost}
                      </div>
                      <div className="text-[11px] text-slate-300 mt-1.5">
                        <span className="text-neon-cyan">原因：</span>{b.cause}
                      </div>
                      <div className="text-[11px] text-slate-300 mt-1">
                        <span className="text-neon-magenta">改进：</span>{b.improvement}
                      </div>
                      <div className="text-[11px] text-neon-green mt-1 font-mono">↗ {b.delta}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="col-span-12 glass rounded-sm p-4 border border-neon-magenta/30 relative hud-corner">
            <div className="text-[11px] font-display tracking-widest text-neon-magenta mb-2">闭环说明</div>
            <div className="text-xs text-slate-300 leading-relaxed">
              每次任务结束 → 记录执行轨迹（reasoning trace + 工具调用 + 文件 diff）→ GEPA 分析失败模式 → DSPy 生成改进候选 →
              沙箱评测（单元 + 基准用例）→ 人审批准 → 自动发布到对应员工 / Skill / SOP 模板。
              进化对象仅为 <span className="text-neon-cyan">Prompt / SOP / Skill 描述 / 工具路由 / Team 模板</span>，
              <span className="text-neon-magenta">不训练模型权重</span>，单次约 $2-10，企业可负担。
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Pill({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="glass rounded-sm py-2 text-center border" style={{ borderColor: `${color}55` }}>
      <div className="font-display text-lg" style={{ color }}>{value}</div>
      <div className="text-[10px] font-mono text-slate-400">{label}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-sm px-3 py-2 border border-white/5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-neon-cyan/70">{label}</div>
      <div className="font-display text-lg neon-text">{value}</div>
    </div>
  );
}
