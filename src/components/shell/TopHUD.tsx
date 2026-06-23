import { useEffect, useState } from 'react';
import { Activity, Cpu, ShieldCheck, Zap, AlertTriangle, Sparkles } from 'lucide-react';
import { employees } from '../../data/employees';

function useTicker(min: number, max: number, step = 1, interval = 1400) {
  const [v, setV] = useState(Math.floor((min + max) / 2));
  useEffect(() => {
    const t = setInterval(() => {
      setV((cur) => {
        const next = cur + (Math.random() > 0.5 ? step : -step) * Math.ceil(Math.random() * 3);
        return Math.max(min, Math.min(max, next));
      });
    }, interval);
    return () => clearInterval(t);
  }, [min, max, step, interval]);
  return v;
}

export default function TopHUD() {
  const tokens = useTicker(720_000, 960_000, 1000, 1800);
  const cost = useTicker(180, 320, 1, 2200);
  const risk = useTicker(2, 6, 1, 3000);
  const evo = useTicker(60, 88, 1, 2400);

  const onlineCount = employees.filter((e) => e.status !== 'idle').length;

  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  return (
    <div className="absolute top-0 left-0 right-0 h-14 z-30 px-4 flex items-center gap-4 glass-strong border-b border-neon-cyan/20">
      <div className="flex items-center gap-3 relative hud-corner px-3 py-1">
        <div className="w-8 h-8 rounded-sm bg-gradient-to-br from-neon-cyan/20 to-neon-magenta/20 border border-neon-cyan/40 flex items-center justify-center neon-text font-display text-sm">
          🦞
        </div>
        <div>
          <div className="font-display text-sm tracking-widest neon-text">LOBSTER FACTORY</div>
          <div className="text-[10px] font-mono text-neon-cyan/60 tracking-wider">
            ENTERPRISE AGENT TEAM OS · v0.2.0
          </div>
        </div>
      </div>

      <div className="h-8 w-px bg-neon-cyan/15" />

      <HudMetric icon={<Activity size={12} />} label="在岗员工" value={`${onlineCount} / ${employees.length}`} color="cyan" />
      <HudMetric icon={<Cpu size={12} />} label="今日 Token" value={tokens.toLocaleString()} color="green" />
      <HudMetric icon={<Zap size={12} />} label="今日成本" value={`$${cost.toFixed(2)}`} color="amber" />
      <HudMetric icon={<AlertTriangle size={12} />} label="风险事件" value={`${risk}`} color="red" pulse={risk > 4} />
      <HudMetric icon={<Sparkles size={12} />} label="进化度" value={`${evo}%`} color="magenta" />
      <HudMetric icon={<ShieldCheck size={12} />} label="治理状态" value="ALL GREEN" color="green" />

      <div className="flex-1" />

      <div className="text-right">
        <div className="font-mono text-xs text-neon-cyan/80">{time}</div>
        <div className="text-[10px] font-mono text-neon-cyan/40 tracking-wider">SHENZHEN · 2026.06.21</div>
      </div>

      <div className="flex items-center gap-2 ml-4">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-purple to-neon-magenta border-2 border-neon-cyan/60 flex items-center justify-center font-display font-bold text-sm">
          昆
        </div>
        <div>
          <div className="text-xs font-display">昆仑</div>
          <div className="text-[9px] font-mono text-neon-green/80">DIGITAL TWIN · ONLINE</div>
        </div>
      </div>
    </div>
  );
}

function HudMetric({
  icon, label, value, color, pulse,
}: { icon: React.ReactNode; label: string; value: string; color: 'cyan' | 'green' | 'amber' | 'red' | 'magenta'; pulse?: boolean }) {
  const map: Record<string, string> = {
    cyan: 'text-neon-cyan',
    green: 'text-neon-green',
    amber: 'text-neon-amber',
    red: 'text-neon-red',
    magenta: 'text-neon-magenta',
  };
  return (
    <div className={`flex flex-col leading-none ${pulse ? 'animate-pulse' : ''}`}>
      <div className={`flex items-center gap-1 ${map[color]} text-[10px] font-mono uppercase tracking-wider opacity-70`}>
        {icon}
        {label}
      </div>
      <div className={`font-mono text-sm font-bold mt-0.5 ${map[color]}`}>{value}</div>
    </div>
  );
}
