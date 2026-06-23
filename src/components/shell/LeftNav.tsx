import {
  MessagesSquare, Users, Wrench, CalendarClock, Cable, ShieldCheck, Store, Activity, Sparkles, Building2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { channels } from '../../data/feishu';

const sections = [
  {
    title: '工作台',
    items: [
      { key: 'office', label: '办公室全景', icon: Building2, badge: '6 分区' },
      { key: 'chat', label: '对话流', icon: MessagesSquare, badge: '12' },
      { key: 'tasks', label: '定时任务', icon: CalendarClock, badge: '4' },
    ],
  },
  {
    title: '员工',
    items: [
      { key: 'employees', label: '我的员工', icon: Users, badge: '12' },
      { key: 'market', label: '员工市场', icon: Store, badge: '56+', highlight: 'market' },
      { key: 'skills', label: '技能库', icon: Wrench, badge: '128' },
    ],
  },
  {
    title: '连接',
    items: [
      { key: 'connect', label: 'MCP / 应用', icon: Cable, badge: '23' },
    ],
  },
  {
    title: '治理',
    items: [
      { key: 'governance', label: 'HiClaw 治理舱', icon: ShieldCheck, badge: 'NEW', highlight: 'governance' },
      { key: 'hermes', label: 'Hermes 进化', icon: Sparkles, badge: '47', highlight: 'hermes' },
      { key: 'audit', label: '审计链', icon: Activity, badge: '∞' },
    ],
  },
];

export default function LeftNav() {
  const { leftNav, setLeftNav, setShowMarketplace, setShowGovernance, setShowHermes } = useAppStore();

  return (
    <aside className="absolute left-0 top-14 bottom-0 w-64 z-20 glass-strong border-r border-neon-cyan/15 flex flex-col">
      <div className="p-4 border-b border-neon-cyan/10">
        <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/60">租户</div>
        <div className="flex items-center justify-between mt-1">
          <div className="font-display text-sm">蓝血军团 · 总部</div>
          <span className="chip-green">PRO</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className="px-2 text-[10px] font-mono uppercase tracking-widest text-neon-cyan/40 mb-1">
              {sec.title}
            </div>
            <div className="space-y-0.5">
              {sec.items.map((it) => {
                const Active = leftNav === it.key;
                const Icon = it.icon;
                return (
                  <button
                    key={it.key}
                    onClick={() => {
                      setLeftNav(it.key);
                      if (it.highlight === 'market') setShowMarketplace(true);
                      if (it.highlight === 'governance') setShowGovernance(true);
                      if (it.highlight === 'hermes') setShowHermes(true);
                    }}
                    className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm transition relative
                      ${Active
                        ? 'bg-neon-cyan/10 text-neon-cyan shadow-neon-cyan'
                        : 'text-slate-300 hover:bg-white/5 hover:text-neon-cyan'}`}
                  >
                    {Active && (
                      <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-neon-cyan shadow-neon-cyan" />
                    )}
                    <Icon size={14} />
                    <span className="flex-1 text-left text-[13px]">{it.label}</span>
                    {it.badge && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm
                        ${it.highlight === 'governance'
                          ? 'bg-neon-magenta/15 text-neon-magenta'
                          : 'bg-white/5 text-slate-400 group-hover:text-neon-cyan'}`}>
                        {it.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="pt-2">
          <div className="px-2 text-[10px] font-mono uppercase tracking-widest text-neon-cyan/40 mb-1">
            活跃项目群
          </div>
          <div className="space-y-0.5">
            {channels.map((c) => (
              <div key={c.id} className="px-2 py-1 rounded-sm hover:bg-white/5 cursor-pointer flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full
                  ${c.type === 'incident' ? 'bg-neon-red animate-pulse'
                    : c.type === 'system' ? 'bg-neon-magenta'
                    : 'bg-neon-green'}`} />
                <span className="text-[12px] flex-1 truncate text-slate-300">{c.name}</span>
                {c.unread > 0 && (
                  <span className="text-[10px] font-mono bg-neon-magenta/20 text-neon-magenta px-1 rounded-sm">
                    {c.unread}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-neon-cyan/10">
        <div className="glass rounded-sm p-2.5 relative hud-corner">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-neon-green shadow-neon-green animate-pulse" />
            <div className="text-[10px] font-mono text-neon-green/80">SAFE MODE · 沙箱已隔离</div>
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-400 leading-tight">
            Firecracker · 网络/文件/存储已隔离<br />
            所有 Skill 已签名验证
          </div>
        </div>
      </div>
    </aside>
  );
}
