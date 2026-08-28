import { useEffect, useState, type ReactNode } from 'react';
import { Bell, CheckCircle2, ChevronDown, CircleUserRound, Clock3, Search, Settings, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

const pageMeta: Record<string, { title: string; sub: string }> = {
  office: { title: '工作台', sub: '目标、交办与人机协作集中在这里' },
  employees: { title: '团队协作', sub: '真人、个人分身和数字同事共同承担工作' },
  connect: { title: '能力与连接', sub: '专家、技能、知识、模型和工作应用' },
  evidence: { title: '成长与复盘', sub: '从交付结果中沉淀知识和更好的工作方法' },
};

export default function TopBar() {
  const activePage = useAppStore((state) => state.activePage);
  const setCmdkOpen = useAppStore((state) => state.setCmdkOpen);
  const meta = pageMeta[activePage] ?? pageMeta.office;
  const [isMac, setIsMac] = useState(false);

  useEffect(() => { setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)); }, []);

  return (
    <header className="absolute left-0 right-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-neutral-200 bg-white px-2 sm:gap-4 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-neutral-900 text-[13px] font-bold text-white">H</div>
        <div className="hidden leading-tight sm:block"><div className="text-[13px] font-semibold text-neutral-900">Hummer</div><div className="text-[10px] text-neutral-500">人机协同工作台</div></div>
      </div>
      <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex"><span className="text-[12px] text-neutral-300">/</span><div className="min-w-0"><div className="truncate text-[13px] font-medium text-neutral-900">{meta.title}</div><div className="truncate text-[10.5px] text-neutral-500">{meta.sub}</div></div></div>
      <div className="hidden items-center gap-1.5 lg:flex"><LiveChip icon={<Clock3 size={11} />} label="进行中" value="9" tone="info" /><LiveChip icon={<ShieldCheck size={11} />} label="待我确认" value="3" tone="warning" /><LiveChip icon={<CheckCircle2 size={11} />} label="本周完成" value="26" tone="success" /></div>
      <button type="button" onClick={() => setCmdkOpen(true)} className="hum-btn is-sm hidden min-w-[210px] items-center justify-between gap-1.5 text-neutral-500 sm:flex"><span className="flex items-center gap-1.5"><Search size={12} /> 搜索工作、同事和知识</span><span className="hum-kbd">{isMac ? 'Cmd' : 'Ctrl'} K</span></button>
      <button type="button" aria-label="查看通知" className="grid h-8 w-8 place-items-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><Bell size={14} /></button>
      <ProfileMenu />
    </header>
  );
}

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  return <div className="relative border-l border-neutral-200 pl-2"><button type="button" aria-label="打开个人菜单" onClick={() => setOpen((value) => !value)} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-neutral-100"><div className="grid h-7 w-7 place-items-center rounded-full bg-neutral-900 text-[12px] font-semibold text-white">昆</div><div className="hidden text-left leading-tight xl:block"><div className="text-[12px] font-medium text-neutral-900">昆仑</div><div className="text-[10px] text-neutral-500">企业管理员</div></div><ChevronDown size={12} className={`text-neutral-400 transition ${open ? 'rotate-180' : ''}`} /></button>{open && <><div className="fixed inset-0 z-40" onClick={() => setOpen(false)} /><div className="absolute right-0 top-11 z-50 w-56 rounded-md border border-neutral-200 bg-white p-1 shadow-lg"><div className="border-b border-neutral-100 px-2 py-2"><div className="text-[11.5px] font-medium text-neutral-900">昆仑</div><div className="mt-0.5 text-[10px] text-neutral-500">蓝熙集团 · 总部</div></div><button type="button" aria-label="我的设置" onClick={() => { setSettingsOpen(true); setOpen(false); }} className="mt-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[11.5px] text-neutral-700 hover:bg-neutral-50"><Settings size={13} /> 我的设置</button><button type="button" className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[11.5px] text-neutral-700 hover:bg-neutral-50"><CircleUserRound size={13} /> 账号与安全</button></div></>}</div>;
}

function LiveChip({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: 'info' | 'warning' | 'success' }) {
  const className = tone === 'info' ? 'hum-chip is-brand' : tone === 'warning' ? 'hum-chip is-warning' : 'hum-chip is-success';
  return <span className={`${className} hum-tabular`}>{icon}<span>{label}</span><b>{value}</b></span>;
}
