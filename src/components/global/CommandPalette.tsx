/**
 * Cmd+K · 全局命令面板
 * 搜索：员工 / 任务 / 技能 / MCP 应用 / 知识 / 页面跳转 / 操作
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, ArrowRight, Users, ListChecks, Wrench, Cable, BookOpen, Building2,
  MessagesSquare, Sparkles, ShieldCheck, Activity, Store, FlaskConical,
} from 'lucide-react';
import { useAppStore, type PageKey } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import { collabTasks } from '../../data/tasks';
import { skillItems } from '../../data/skills';

type CmdResult =
  | { kind: 'page'; id: string; label: string; sub: string; icon: any; page?: PageKey; modal?: 'market' | 'governance' | 'hermes' | 'lobster' | 'kg' }
  | { kind: 'employee'; id: string; label: string; sub: string; icon: any }
  | { kind: 'task';     id: string; label: string; sub: string; icon: any }
  | { kind: 'skill';    id: string; label: string; sub: string; icon: any }
  | { kind: 'mcp';      id: string; label: string; sub: string; icon: any };

const PAGES: CmdResult[] = [
  { kind: 'page', id: 'p-office',    label: '公司总部',         sub: '3D 办公室全景', icon: Building2,      page: 'office' },
  { kind: 'page', id: 'p-chat',      label: '对话流',           sub: '团队 Agent 协作上下文', icon: MessagesSquare, page: 'chat' },
  { kind: 'page', id: 'p-tasks',     label: '工作任务',         sub: '目标 → 分派 → 执行 → 审批 → 交付', icon: ListChecks,     page: 'tasks' },
  { kind: 'page', id: 'p-employees', label: '我的员工',         sub: '15 位数字员工组织架构', icon: Users,          page: 'employees' },
  { kind: 'page', id: 'p-skills',    label: '技能库',           sub: '可调用 Skill / SOP',    icon: Wrench,         page: 'skills' },
  { kind: 'page', id: 'p-connect',   label: 'MCP 应用',         sub: '企业系统连接',         icon: Cable,          page: 'connect' },
  { kind: 'page', id: 'p-kg',        label: '企业知识中枢',     sub: '接入 → 整理 → 沉淀 → 调用', icon: BookOpen,       page: 'kg' },
  { kind: 'page', id: 'p-audit',     label: '审计链',           sub: '全链路合规可追溯',      icon: Activity,       page: 'audit' },
  { kind: 'page', id: 'p-market',    label: '员工市场',         sub: '专家共创数字员工',      icon: Store,          modal: 'market' },
  { kind: 'page', id: 'p-hermes',    label: 'Hermes 进化',      sub: '闭环自进化飞轮',        icon: Sparkles,       modal: 'hermes' },
  { kind: 'page', id: 'p-gov',       label: 'HiClaw 治理舱',    sub: '凭证 / 风控 / 配额',    icon: ShieldCheck,    modal: 'governance' },
  { kind: 'page', id: 'p-lobster',   label: '练虾系统',         sub: '抖音机制落地',          icon: FlaskConical,   modal: 'lobster' },
];

export default function CommandPalette() {
  const open = useAppStore((s) => s.cmdkOpen);
  const setOpen = useAppStore((s) => s.setCmdkOpen);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const setSelectedEmployee = useAppStore((s) => s.setSelectedEmployee);
  const setShowMarketplace = useAppStore((s) => s.setShowMarketplace);
  const setShowGovernance = useAppStore((s) => s.setShowGovernance);
  const setShowHermes = useAppStore((s) => s.setShowHermes);
  const setShowLobsterLab = useAppStore((s) => s.setShowLobsterLab);
  const setShowKG = useAppStore((s) => s.setShowKG);

  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Cmd+K listener
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isCmdK) {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const matches = (s: string) => !ql || s.toLowerCase().includes(ql);

    const empResults: CmdResult[] = employees
      .filter((e) => matches(e.name) || matches(e.role) || matches(e.currentTask ?? ''))
      .slice(0, 6)
      .map((e) => ({
        kind: 'employee', id: e.id,
        label: e.name, sub: `${e.role} · ${e.currentTask ?? ''}`.slice(0, 60),
        icon: Users,
      }));

    const taskResults: CmdResult[] = collabTasks
      .filter((t) => matches(t.title) || matches(t.goal))
      .slice(0, 4)
      .map((t) => ({
        kind: 'task', id: t.id, label: t.title, sub: t.goal.slice(0, 60), icon: ListChecks,
      }));

    const skillResults: CmdResult[] = skillItems
      .filter((s) => matches(s.name) || matches(s.category))
      .slice(0, 4)
      .map((s) => ({
        kind: 'skill', id: s.id, label: s.name, sub: `${s.category} · ${s.desc.slice(0, 50)}`, icon: Wrench,
      }));

    const pageResults: CmdResult[] = PAGES.filter((p) => matches(p.label) || matches(p.sub));

    return { pages: pageResults, employees: empResults, tasks: taskResults, skills: skillResults };
  }, [q]);

  const flat = useMemo(
    () => [...results.pages, ...results.employees, ...results.tasks, ...results.skills],
    [results],
  );

  useEffect(() => { if (idx >= flat.length) setIdx(0); }, [flat.length, idx]);

  const onPick = (r: CmdResult) => {
    if (r.kind === 'page') {
      if (r.modal === 'market') setShowMarketplace(true);
      else if (r.modal === 'governance') setShowGovernance(true);
      else if (r.modal === 'hermes') setShowHermes(true);
      else if (r.modal === 'lobster') setShowLobsterLab(true);
      else if (r.modal === 'kg') setShowKG(true);
      else if (r.page) setActivePage(r.page);
    } else if (r.kind === 'employee') {
      const emp = employees.find((e) => e.id === r.id);
      if (emp) setSelectedEmployee(emp);
    } else if (r.kind === 'task') {
      setActivePage('tasks');
    } else if (r.kind === 'skill') {
      setActivePage('skills');
    }
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh]"
          style={{ background: 'rgba(15, 15, 14, 0.32)', backdropFilter: 'blur(4px)' }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[640px] max-w-[94vw] hum-card overflow-hidden"
            style={{ boxShadow: 'var(--shadow-modal)' }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(flat.length - 1, i + 1)); }
              if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              if (e.key === 'Enter') {
                e.preventDefault();
                const r = flat[idx]; if (r) onPick(r);
              }
            }}
          >
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <Search size={14} className="text-neutral-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索员工、任务、技能、应用，或跳转页面…"
                className="flex-1 bg-transparent text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none"
              />
              <span className="hum-kbd">ESC</span>
            </div>

            <div className="max-h-[60vh] overflow-y-auto py-1">
              {flat.length === 0 && (
                <div className="px-4 py-10 text-center text-[12.5px] hum-faint">
                  没有匹配项。试试关键词：「BD 邮件」「Q3」「合同」「招聘」
                </div>
              )}
              {results.pages.length > 0 && <Group label="跳转页面" />}
              {results.pages.map((r, i) => <Row key={r.id} r={r} active={i === idx} onPick={onPick} />)}
              {results.employees.length > 0 && <Group label="数字员工" />}
              {results.employees.map((r, i) => <Row key={r.id} r={r} active={results.pages.length + i === idx} onPick={onPick} />)}
              {results.tasks.length > 0 && <Group label="工作任务" />}
              {results.tasks.map((r, i) => <Row key={r.id} r={r} active={results.pages.length + results.employees.length + i === idx} onPick={onPick} />)}
              {results.skills.length > 0 && <Group label="技能" />}
              {results.skills.map((r, i) => <Row key={r.id} r={r} active={results.pages.length + results.employees.length + results.tasks.length + i === idx} onPick={onPick} />)}
            </div>

            <div className="px-4 py-2 flex items-center gap-3 text-[10.5px] hum-faint bg-neutral-25" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <span><span className="hum-kbd">↑</span> <span className="hum-kbd">↓</span> 导航</span>
              <span><span className="hum-kbd">↵</span> 选择</span>
              <span><span className="hum-kbd">ESC</span> 关闭</span>
              <span className="ml-auto">{flat.length} 条结果</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Group({ label }: { label: string }) {
  return (
    <div className="px-4 py-1.5 hum-eyebrow" style={{ background: 'var(--bg-canvas)' }}>{label}</div>
  );
}

function Row({ r, active, onPick }: { r: CmdResult; active: boolean; onPick: (r: CmdResult) => void }) {
  const Icon = r.icon;
  return (
    <button
      onClick={() => onPick(r)}
      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition ${
        active ? 'bg-primary-50' : 'hover:bg-neutral-50'
      }`}
    >
      <Icon size={14} className={active ? 'text-primary-700' : 'text-neutral-500'} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-neutral-900 truncate">{r.label}</div>
        <div className="text-[11px] hum-faint truncate">{r.sub}</div>
      </div>
      <ArrowRight size={12} className={active ? 'text-primary-700' : 'text-neutral-300'} />
    </button>
  );
}
