import { motion } from 'framer-motion';
import { Bot, Workflow, Gauge, Sparkles, Shield, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { employees, TWIN_NAME } from '../../data/employees';

export default function RightConsole() {
  const { setShowHermes, setShowGovernance, setSelectedEmployee } = useAppStore();

  const working = employees.filter((e) => e.status === 'working');
  const blocked = employees.filter((e) => e.status === 'blocked');
  const meeting = employees.filter((e) => e.status === 'meeting');
  const training = employees.filter((e) => e.status === 'training');

  return (
    <aside className="absolute right-0 top-14 bottom-72 w-80 z-20 glass-strong border-l border-neon-cyan/15 flex flex-col">
      <div className="p-4 border-b border-neon-cyan/10 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/15 via-transparent to-neon-magenta/15" />
        <div className="relative">
          <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/60">数字分身</div>
          <div className="mt-1 flex items-center gap-3">
            <motion.div
              className="relative w-14 h-14 rounded-full bg-gradient-to-br from-neon-purple to-neon-magenta border-2 border-neon-cyan/60 flex items-center justify-center font-display font-black text-xl shadow-neon-magenta"
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 2.4, repeat: Infinity }}
            >
              昆
              <motion.div
                className="absolute -inset-2 rounded-full border border-neon-cyan/40"
                animate={{ rotate: 360 }}
                transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
              />
            </motion.div>
            <div>
              <div className="font-display text-base neon-text-magenta">{TWIN_NAME}</div>
              <div className="text-[10px] font-mono text-neon-green/80">代表昆仑 · 管理 {employees.length} 个 Agent</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <MiniStat label="在工作" value={working.length} color="cyan" />
            <MiniStat label="开会" value={meeting.length} color="magenta" />
            <MiniStat label="阻断" value={blocked.length} color="red" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <Section title="实时状态" subtitle="Manager / Worker">
          {employees.slice(0, 8).map((e) => (
            <button
              key={e.id}
              onClick={() => setSelectedEmployee(e)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-white/5 transition group"
            >
              <span className={`relative w-7 h-7 rounded-sm flex items-center justify-center font-display font-bold text-xs
                ${e.status === 'working' ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40'
                  : e.status === 'blocked' ? 'bg-neon-red/15 text-neon-red border border-neon-red/40 animate-breathe'
                  : e.status === 'meeting' ? 'bg-neon-magenta/15 text-neon-magenta border border-neon-magenta/40'
                  : e.status === 'training' ? 'bg-neon-purple/15 text-neon-purple border border-neon-purple/40'
                  : 'bg-white/5 text-slate-400 border border-white/10'}`}>
                {e.avatar}
                <span className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full
                  ${e.status === 'working' ? 'bg-neon-green shadow-neon-green animate-pulse'
                    : e.status === 'blocked' ? 'bg-neon-red shadow-neon-cyan animate-pulse'
                    : e.status === 'meeting' ? 'bg-neon-magenta'
                    : e.status === 'training' ? 'bg-neon-purple'
                    : 'bg-slate-500'}`} />
              </span>
              <div className="flex-1 text-left min-w-0">
                <div className="text-xs text-slate-200 truncate">{e.name} · <span className="text-slate-400">{e.role}</span></div>
                <div className="text-[10px] font-mono text-slate-400 truncate">{e.currentTask}</div>
              </div>
              <ChevronRight size={12} className="text-slate-500 group-hover:text-neon-cyan" />
            </button>
          ))}
        </Section>

        <Section title="责任划分" subtitle="OpenHuman 模型">
          <div className="space-y-1.5 px-1">
            <ResponsibilityRow icon={<Bot size={12} />} label="数字分身决策" value="自动" tone="cyan" />
            <ResponsibilityRow icon={<Workflow size={12} />} label="Agent 执行" value="授权范围内" tone="green" />
            <ResponsibilityRow icon={<Shield size={12} />} label="高风险动作" value="人审批准" tone="amber" />
            <ResponsibilityRow icon={<Gauge size={12} />} label="跨部门外发" value="四眼原则" tone="magenta" />
          </div>
        </Section>

        <Section title="进化与治理" subtitle="一键进入">
          <button onClick={() => setShowHermes(true)} className="w-full btn-neon-magenta justify-between">
            <span className="flex items-center gap-2"><Sparkles size={12} /> Hermes 进化飞轮</span>
            <span className="text-[10px] opacity-80">{training.length + 5} 任务</span>
          </button>
          <button onClick={() => setShowGovernance(true)} className="w-full btn-neon justify-between mt-2">
            <span className="flex items-center gap-2"><Shield size={12} /> HiClaw 治理舱</span>
            <span className="text-[10px] opacity-80">ALL GREEN</span>
          </button>
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-sm relative hud-corner">
      <div className="px-3 py-2 border-b border-neon-cyan/10 flex items-center justify-between">
        <div className="text-[11px] font-display tracking-wider text-neon-cyan">{title}</div>
        {subtitle && <div className="text-[9px] font-mono text-neon-cyan/50">{subtitle}</div>}
      </div>
      <div className="p-2">{children}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: 'cyan' | 'magenta' | 'red' }) {
  const map: Record<string, string> = {
    cyan: 'text-neon-cyan border-neon-cyan/30',
    magenta: 'text-neon-magenta border-neon-magenta/30',
    red: 'text-neon-red border-neon-red/30',
  };
  return (
    <div className={`glass border ${map[color]} rounded-sm py-1.5`}>
      <div className={`font-display text-base ${map[color].split(' ')[0]}`}>{value}</div>
      <div className="text-[9px] font-mono text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

function ResponsibilityRow({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: 'cyan' | 'green' | 'amber' | 'magenta' }) {
  const map: Record<string, string> = {
    cyan: 'text-neon-cyan', green: 'text-neon-green', amber: 'text-neon-amber', magenta: 'text-neon-magenta',
  };
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-sm bg-white/3">
      <span className={`${map[tone]}`}>{icon}</span>
      <span className="text-[11px] text-slate-300 flex-1">{label}</span>
      <span className={`text-[10px] font-mono ${map[tone]}`}>{value}</span>
    </div>
  );
}
