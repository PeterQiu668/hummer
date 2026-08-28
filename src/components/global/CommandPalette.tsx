import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Blocks, BookOpen, ChartNoAxesCombined, LayoutPanelTop, ListChecks, MonitorCog, Search, Users, Wrench } from 'lucide-react';
import { useAppStore, type PageKey } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import { collabTasks } from '../../data/tasks';

type CmdResult = {
  kind: 'page' | 'employee' | 'task' | 'skill';
  id: string;
  label: string;
  sub: string;
  icon: typeof Search;
  page?: Extract<PageKey, 'office' | 'employees' | 'connect' | 'nodes' | 'evidence'>;
};

const pages: CmdResult[] = [
  { kind: 'page', id: 'p-office', label: '工作台', sub: '目标、交办、任务和人机协作', icon: LayoutPanelTop, page: 'office' },
  { kind: 'page', id: 'p-employees', label: '团队协作', sub: '真人、分身、数字同事和组织关系', icon: Users, page: 'employees' },
  { kind: 'page', id: 'p-connect', label: '能力与连接', sub: '专家、技能、企业知识、模型和工作应用', icon: Blocks, page: 'connect' },
  { kind: 'page', id: 'p-nodes', label: '执行节点', sub: '本地执行环境、会话与权限边界', icon: MonitorCog, page: 'nodes' },
  { kind: 'page', id: 'p-evidence', label: '成长与复盘', sub: '成果、质量、知识沉淀和持续改进', icon: ChartNoAxesCombined, page: 'evidence' },
];

const capabilities: CmdResult[] = [
  { kind: 'skill', id: 'cap-leads', label: '线索整理与跟进', sub: '销售效率 · 已在 4 位数字同事中启用', icon: Wrench, page: 'connect' },
  { kind: 'skill', id: 'cap-meeting', label: '会议纪要与行动项', sub: '知识协作 · 会议内容整理', icon: BookOpen, page: 'connect' },
  { kind: 'skill', id: 'cap-contract', label: '合同条款检查', sub: '风险控制 · 需要法务确认后使用', icon: Wrench, page: 'connect' },
];

export default function CommandPalette() {
  const open = useAppStore((state) => state.cmdkOpen);
  const setOpen = useAppStore((state) => state.setCmdkOpen);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(!open); }
      if (event.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useEffect(() => { if (open) { setQuery(''); setActiveIndex(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = (value: string) => !normalized || value.toLowerCase().includes(normalized);
    const employeeResults: CmdResult[] = employees.filter((employee) => matches(`${employee.name} ${employee.role} ${employee.currentTask ?? ''}`)).slice(0, 5).map((employee) => ({ kind: 'employee', id: employee.id, label: employee.name, sub: `${employee.role} · ${employee.currentTask ?? '待命'}`.slice(0, 70), icon: Users }));
    const taskResults: CmdResult[] = collabTasks.filter((task) => matches(`${task.title} ${task.goal}`)).slice(0, 4).map((task) => ({ kind: 'task', id: task.id, label: task.title, sub: task.goal.slice(0, 70), icon: ListChecks, page: 'office' }));
    return {
      pages: pages.filter((item) => matches(`${item.label} ${item.sub}`)),
      employees: employeeResults,
      tasks: taskResults,
      skills: capabilities.filter((item) => matches(`${item.label} ${item.sub}`)),
    };
  }, [query]);

  const flat = useMemo(() => [...results.pages, ...results.employees, ...results.tasks, ...results.skills], [results]);
  useEffect(() => { if (activeIndex >= flat.length) setActiveIndex(0); }, [activeIndex, flat.length]);

  const pick = (result: CmdResult) => {
    if (result.kind === 'employee') {
      setActivePage('employees');
    } else {
      setActivePage(result.page ?? 'office');
    }
    setOpen(false);
  };

  return <AnimatePresence>{open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="fixed inset-0 z-[200] flex items-start justify-center bg-neutral-900/30 pt-[10vh]" onClick={() => setOpen(false)}><motion.div initial={{ opacity: 0, y: -8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.985 }} transition={{ duration: 0.15 }} onClick={(event) => event.stopPropagation()} className="hum-card w-[640px] max-w-[94vw] overflow-hidden shadow-modal" onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(flat.length - 1, index + 1)); } if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); } if (event.key === 'Enter') { event.preventDefault(); const result = flat[activeIndex]; if (result) pick(result); } }}><div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3"><Search size={14} className="text-neutral-400" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工作、同事、技能、知识或页面" className="flex-1 bg-transparent text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400" /><span className="hum-kbd">ESC</span></div><div className="max-h-[60vh] overflow-y-auto py-1">{flat.length === 0 && <div className="px-4 py-10 text-center text-[12.5px] text-neutral-400">没有匹配项，试试“合同”“销售”或“飞书”</div>}<ResultGroup label="页面" results={results.pages} offset={0} activeIndex={activeIndex} onPick={pick} /><ResultGroup label="团队成员" results={results.employees} offset={results.pages.length} activeIndex={activeIndex} onPick={pick} /><ResultGroup label="工作" results={results.tasks} offset={results.pages.length + results.employees.length} activeIndex={activeIndex} onPick={pick} /><ResultGroup label="能力" results={results.skills} offset={results.pages.length + results.employees.length + results.tasks.length} activeIndex={activeIndex} onPick={pick} /></div><div className="flex items-center gap-3 border-t border-neutral-200 bg-neutral-25 px-4 py-2 text-[10.5px] text-neutral-400"><span>↑ ↓ 导航</span><span>回车选择</span><span className="ml-auto">{flat.length} 条结果</span></div></motion.div></motion.div>}</AnimatePresence>;
}

function ResultGroup({ label, results, offset, activeIndex, onPick }: { label: string; results: CmdResult[]; offset: number; activeIndex: number; onPick: (result: CmdResult) => void }) {
  if (!results.length) return null;
  return <><div className="bg-neutral-25 px-4 py-1.5 text-[10px] font-semibold text-neutral-400">{label}</div>{results.map((result, index) => { const Icon = result.icon; const active = offset + index === activeIndex; return <button type="button" key={result.id} onClick={() => onPick(result)} className={`flex w-full items-center gap-3 px-4 py-2 text-left ${active ? 'bg-primary-50' : 'hover:bg-neutral-50'}`}><Icon size={14} className={active ? 'text-primary-700' : 'text-neutral-500'} /><div className="min-w-0 flex-1"><div className="truncate text-[13px] text-neutral-900">{result.label}</div><div className="truncate text-[11px] text-neutral-400">{result.sub}</div></div><ArrowRight size={12} className={active ? 'text-primary-700' : 'text-neutral-300'} /></button>; })}</>;
}
