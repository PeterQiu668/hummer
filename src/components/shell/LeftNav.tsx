import { useState } from 'react';
import { Blocks, ChartNoAxesCombined, ChevronDown, LayoutPanelTop, MonitorCog, Settings2, UsersRound } from 'lucide-react';
import { useAppStore, type PageKey } from '../../store/useAppStore';

const primaryNav: { key: Extract<PageKey, 'office' | 'employees' | 'connect' | 'nodes' | 'evidence'>; label: string; icon: typeof LayoutPanelTop; badge?: string }[] = [
  { key: 'office', label: '工作台', icon: LayoutPanelTop },
  { key: 'employees', label: '团队协作', icon: UsersRound, badge: '15' },
  { key: 'connect', label: '能力与连接', icon: Blocks, badge: '7' },
  { key: 'nodes', label: '执行节点', icon: MonitorCog },
  { key: 'evidence', label: '成长与复盘', icon: ChartNoAxesCombined, badge: '3' },
];

const tenants = ['蓝熙集团 · 总部', '蓝熙集团 · 华东事业部', 'Hummer 产品体验空间'];

export default function LeftNav() {
  const activePage = useAppStore((state) => state.activePage);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const setLeftNav = useAppStore((state) => state.setLeftNav);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const [tenant, setTenant] = useState(tenants[0]);
  const [tenantOpen, setTenantOpen] = useState(false);

  const go = (key: Extract<PageKey, 'office' | 'employees' | 'connect' | 'nodes' | 'evidence'>) => { setActivePage(key); setLeftNav(key); };

  return (
    <>
      <aside className="absolute bottom-0 left-0 top-12 z-20 hidden w-60 flex-col border-r border-neutral-200 bg-neutral-25 md:flex">
        <div className="relative border-b border-neutral-200 p-3">
          <button type="button" onClick={() => setTenantOpen((value) => !value)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-neutral-100"><div className="grid h-7 w-7 place-items-center rounded-md bg-neutral-900 text-[11px] font-semibold text-white">蓝</div><div className="min-w-0 flex-1 leading-tight"><div className="truncate text-[12.5px] font-semibold text-neutral-900">{tenant}</div><div className="mt-0.5 text-[10px] text-neutral-500">企业工作区</div></div><ChevronDown size={13} className={`text-neutral-400 transition ${tenantOpen ? 'rotate-180' : ''}`} /></button>
          {tenantOpen && <div className="absolute left-3 right-3 top-[54px] z-40 rounded-md border border-neutral-200 bg-white p-1 shadow-lg">{tenants.map((item) => <button type="button" key={item} onClick={() => { setTenant(item); setTenantOpen(false); }} className={`w-full rounded px-2 py-2 text-left text-[11.5px] ${tenant === item ? 'bg-primary-50 text-primary-800' : 'text-neutral-600 hover:bg-neutral-50'}`}>{item}</button>)}</div>}
        </div>

        <nav className="flex-1 p-2" aria-label="主导航"><div className="px-2 pb-2 pt-1 text-[10px] font-semibold text-neutral-400">我的组织</div><div className="space-y-1">{primaryNav.map((item) => { const Icon = item.icon; const active = activePage === item.key; return <button type="button" key={item.key} onClick={() => go(item.key)} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] transition ${active ? 'bg-neutral-900 font-medium text-white' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'}`}><Icon size={15} className={active ? 'text-white' : 'text-neutral-500'} /><span className="flex-1 text-left">{item.label}</span>{item.badge && <span className={`rounded px-1.5 text-[10px] ${active ? 'bg-white/15 text-white' : 'bg-neutral-100 text-neutral-500'}`}>{item.badge}</span>}</button>; })}</div></nav>

        <div className="border-t border-neutral-200 p-3"><button type="button" onClick={() => go('connect')} className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-[11px] text-neutral-600 hover:bg-neutral-100"><span className="h-1.5 w-1.5 rounded-full bg-neutral-300" /><span className="flex-1">查看工具目录</span><Blocks size={13} className="text-neutral-400" /></button><button type="button" onClick={() => setSettingsOpen(true)} className="mt-1 flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-[11px] text-neutral-600 hover:bg-neutral-100"><Settings2 size={13} className="text-neutral-400" /><span>个人偏好</span></button></div>
      </aside>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-12 grid-cols-5 border-t border-neutral-200 bg-white md:hidden" aria-label="移动端主导航">{primaryNav.map((item) => { const Icon = item.icon; const active = activePage === item.key; return <button type="button" key={item.key} onClick={() => go(item.key)} className={`flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[9.5px] ${active ? 'text-primary-700' : 'text-neutral-500'}`}><Icon size={15} /><span className="max-w-full truncate">{item.label}</span></button>; })}</nav>
    </>
  );
}
