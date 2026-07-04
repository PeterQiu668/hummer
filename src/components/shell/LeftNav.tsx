/**
 * LeftNav (v8) — 真正产品化命名（移除对标产品名）
 *  指挥中心 / 对话流 / 工作任务 / 我的员工 / 员工市场 / 技能与工具 /
 *  知识中枢 / 审计与治理 / 质量与复盘 / 交付物
 */
import {
  Building2, MessagesSquare, ListChecks, Users, Store, Wrench,
  Cable, ShieldCheck, Sparkles, Network, Settings2, BookOpen, FileBox,
} from 'lucide-react';
import { useAppStore, type PageKey } from '../../store/useAppStore';
import { channels } from '../../data/feishu';

type NavItem = {
  key: PageKey | string;
  label: string;
  icon: any;
  badge?: string;
  badgeTone?: 'default' | 'brand' | 'warning' | 'error';
  highlight?: 'market' | 'governance' | 'hermes';
};

type NavSection = { title: string; items: NavItem[] };

const sections: NavSection[] = [
  {
    title: '工作',
    items: [
      { key: 'office', label: '指挥中心',     icon: Building2 },
      { key: 'chat',   label: '对话流',       icon: MessagesSquare, badge: '12' },
      { key: 'tasks',  label: '工作任务',     icon: ListChecks, badge: '8' },
      { key: 'evidence', label: '交付物',     icon: FileBox, badge: '8' },
    ],
  },
  {
    title: '员工',
    items: [
      { key: 'employees', label: '我的员工',    icon: Users, badge: '15' },
      { key: 'market',    label: '员工市场',    icon: Store, badge: '36', highlight: 'market' },
      { key: 'skills',    label: '技能与工具',  icon: Wrench, badge: '128' },
      { key: 'connect',   label: 'MCP 连接',    icon: Cable, badge: '12' },
    ],
  },
  {
    title: '知识与治理',
    items: [
      { key: 'kg',         label: '知识中枢',    icon: BookOpen, badge: '9.6k' },
      { key: 'governance', label: '审计与治理',  icon: ShieldCheck, highlight: 'governance' },
      { key: 'hermes',     label: '质量与复盘',  icon: Sparkles, badge: '47', highlight: 'hermes' },
    ],
  },
];

export default function LeftNav() {
  const activePage = useAppStore((s) => s.activePage);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const setLeftNav = useAppStore((s) => s.setLeftNav);
  const setShowMarketplace = useAppStore((s) => s.setShowMarketplace);
  const setShowGovernance = useAppStore((s) => s.setShowGovernance);
  const setShowHermes = useAppStore((s) => s.setShowHermes);
  const setActiveChannel = useAppStore((s) => s.setActiveChannel);

  const onClick = (it: NavItem) => {
    setLeftNav(it.key);
    if (it.highlight === 'market') return setShowMarketplace(true);
    if (it.highlight === 'governance') return setShowGovernance(true);
    if (it.highlight === 'hermes') return setShowHermes(true);
    setActivePage(it.key as PageKey);
  };

  return (
    <aside
      className="absolute left-0 top-12 bottom-0 w-60 z-20 flex flex-col bg-neutral-25"
      style={{ borderRight: '1px solid var(--border-subtle)' }}
    >
      {/* Tenant */}
      <div className="px-3 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-neutral-100 transition group">
          <div className="w-6 h-6 rounded-md bg-neutral-900 text-white grid place-items-center text-[11px] font-semibold">
            蓝
          </div>
          <div className="flex-1 text-left leading-tight">
            <div className="text-[12.5px] text-neutral-900 font-semibold">蓝血军团 · 总部</div>
            <div className="text-[10px] text-neutral-500 font-mono">workspace · pro</div>
          </div>
          <Settings2 size={13} className="text-neutral-400 group-hover:text-neutral-700" />
        </button>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-4">
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
              {sec.title}
            </div>
            <div className="space-y-0.5">
              {sec.items.map((it) => {
                const Active = activePage === it.key;
                const Icon = it.icon;
                return (
                  <button
                    key={it.key}
                    onClick={() => onClick(it)}
                    className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition ${
                      Active
                        ? 'bg-neutral-100 text-neutral-900 font-medium'
                        : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                    }`}
                  >
                    <Icon size={14} className={Active ? 'text-primary-600' : 'text-neutral-500 group-hover:text-neutral-700'} />
                    <span className="flex-1 text-left">{it.label}</span>
                    {it.badge && (
                      <span className={`text-[10.5px] font-mono px-1.5 rounded ${
                        it.badgeTone === 'brand' ? 'bg-primary-100 text-primary-700' :
                        it.badgeTone === 'warning' ? 'bg-warning-soft text-warning' :
                        it.badgeTone === 'error' ? 'bg-error-soft text-error' :
                        'text-neutral-400 group-hover:text-neutral-600'
                      }`}>
                        {it.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Active project channels */}
        <div>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
            活跃频道
          </div>
          <div className="space-y-0.5">
            {channels.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setActiveChannel(c.id);
                  setActivePage('chat');
                  setLeftNav('chat');
                }}
                className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-neutral-100 transition"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background:
                      c.type === 'incident' ? 'var(--error)' :
                      c.type === 'system' ? '#7E22CE' :
                      'var(--success)',
                  }}
                />
                <span className="flex-1 text-left text-[12px] text-neutral-700 truncate">{c.name}</span>
                {c.unread > 0 && (
                  <span className="text-[10px] font-mono bg-neutral-200 text-neutral-700 px-1 rounded">
                    {c.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Footer status */}
      <div className="px-3 py-2.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 text-[11px] text-neutral-600">
          <span className="w-1.5 h-1.5 rounded-full hum-pulse" style={{ background: 'var(--success)' }} />
          <span className="flex-1">Sandbox 已隔离 · 所有 Skill 已签名</span>
        </div>
      </div>
    </aside>
  );
}
