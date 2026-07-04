/**
 * TopBar (v6) — Notion 风克制顶栏
 * 左：品牌 + 当前位置 · 中：实时组织状态 · 右：搜索 + 命令面板 + 昆仑分身入口
 */
import { useEffect, useState } from 'react';
import { Search, AlertCircle, CheckCircle2, Activity, Cpu, ChevronDown } from 'lucide-react';
import { useAppStore, type PageKey } from '../../store/useAppStore';
import type { RoleKey } from '../../lib/types';
import { employees } from '../../data/employees';

const PAGE_LABEL: Record<string, { title: string; sub: string }> = {
  office:    { title: '指挥中心',           sub: 'Agent Workforce 正在基于 Data OS 与 Agent OS 执行业务' },
  chat:      { title: '团队对话流',         sub: '老板 / 老板分身 / 高管分身 / Agent 一体协作' },
  tasks:     { title: '工作任务',           sub: '目标 → 分派 → 执行 → 验收 → 交付出口' },
  employees: { title: '我的员工',           sub: '数字员工组织架构' },
  market:    { title: '员工市场',           sub: '按经营环节挑选 · 专家保障' },
  skills:    { title: '技能与工具',         sub: '可调用 Skill / SOP / 工具' },
  connect:   { title: 'MCP 连接',           sub: '企业系统连接' },
  audit:     { title: '审计与治理',         sub: '全链路合规可追溯' },
  kg:        { title: '知识中枢',           sub: '资料接入 → 整理 → 沉淀 → Agent 调用' },
  evidence:  { title: '交付物 / 证据库',    sub: '可追溯 · 可审计 · 有出口' },
  governance:{ title: '审计与治理',         sub: '凭证 · 风控 · 配额 · A2A · 审批策略' },
  hermes:    { title: '质量与复盘',         sub: '执行轨迹 → bad case → SOP 沉淀 → 经验回写' },
  inbox:     { title: '收件箱',             sub: '审批 · 阻断 · 卡住 · 待验收 · 异常 — 统一待办' },
  roi:       { title: 'ROI 经营',           sub: '月度经营报告 · 成本归因 · 预算硬顶' },
  execws:    { title: '高管工作台',         sub: '分身拆解确认 · 部门验收 · 团队绩效' },
  myagents:  { title: '我的 AI 同事',       sub: '派活 · 催办 · 验收' },
  expertportal: { title: '专家门户',        sub: '介入工单 · SOP 共创 · 收入分成' },
  evolution: { title: '进化中心',           sub: '组织总览 · 个体进化档案 · 飞轮机制' },
};

const ROLES: { key: RoleKey; name: string; title: string; avatar: string; home: PageKey }[] = [
  { key: 'boss',    name: '昆仑',   title: '老板 · 总控',     avatar: '昆', home: 'office' },
  { key: 'exec',    name: '吴帆',   title: '销售 VP · 真人高管', avatar: '吴', home: 'execws' },
  { key: 'staff',   name: '小周',   title: '一线员工',        avatar: '周', home: 'myagents' },
  { key: 'expert',  name: '林知远', title: '入驻专家',        avatar: '林', home: 'expertportal' },
  { key: 'auditor', name: '审计员', title: '合规审计',        avatar: '审', home: 'audit' },
];

export default function TopBar() {
  const activePage = useAppStore((s) => s.activePage);
  const pendingApprovals = useAppStore((s) => s.pendingApprovals);
  const setCmdkOpen = useAppStore((s) => s.setCmdkOpen);
  const tick = useAppStore((s) => s.tick);

  const meta = PAGE_LABEL[activePage] ?? PAGE_LABEL.office;
  const working = employees.filter((e) => e.status === 'working').length;
  const completion = 56 + ((tick * 3) % 12); // 滚动模拟

  // OS detect for Cmd / Ctrl
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  return (
    <header
      className="absolute top-0 left-0 right-0 h-12 z-30 flex items-center gap-4 px-4 bg-white"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 min-w-[228px]">
        <div className="w-7 h-7 rounded-md bg-neutral-900 text-white grid place-items-center text-[13px] font-display font-bold">
          H
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold text-neutral-900 tracking-tight">Hummer</div>
          <div className="text-[10px] text-neutral-500 font-mono tracking-wide">Enterprise Agent OS</div>
        </div>
      </div>

      {/* Breadcrumb / page title */}
      <div className="hidden md:flex items-center gap-2 min-w-0 flex-1">
        <span className="hum-faint text-[12px]">/</span>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-neutral-900 truncate">{meta.title}</div>
          <div className="text-[10.5px] hum-faint truncate">{meta.sub}</div>
        </div>
      </div>

      {/* Live status chips */}
      <div className="hidden lg:flex items-center gap-1.5">
        <LiveChip icon={<Activity size={11} />} label="在岗" value={`${working}/${employees.length}`} tone="info" />
        <LiveChip icon={<CheckCircle2 size={11} />} label="今日完成率" value={`${completion}%`} tone="success" />
        <LiveChip icon={<Cpu size={11} />} label="模型成本" value="¥1,283" tone="muted" />
        {pendingApprovals > 0 && (
          <LiveChip icon={<AlertCircle size={11} />} label="待审批" value={String(pendingApprovals)} tone="error" pulse />
        )}
      </div>

      {/* Command palette trigger */}
      <button
        onClick={() => setCmdkOpen(true)}
        className="hum-btn is-sm flex items-center gap-1.5 min-w-[200px] justify-between text-neutral-500"
      >
        <span className="flex items-center gap-1.5">
          <Search size={12} /> 搜索员工、任务、技能、知识…
        </span>
        <span className="hum-kbd">{isMac ? '⌘' : 'Ctrl'} K</span>
      </button>

      {/* Role switcher（Phase 0：多角色演示身份） */}
      <RoleSwitcher />
    </header>
  );
}

function RoleSwitcher() {
  const currentRole = useAppStore((s) => s.currentRole);
  const setCurrentRole = useAppStore((s) => s.setCurrentRole);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const setLeftNav = useAppStore((s) => s.setLeftNav);
  const [open, setOpen] = useState(false);
  const me = ROLES.find((r) => r.key === currentRole) ?? ROLES[0];

  const switchTo = (key: RoleKey) => {
    const target = ROLES.find((r) => r.key === key)!;
    setCurrentRole(key);
    setActivePage(target.home);
    setLeftNav(target.home);
    setOpen(false);
  };

  return (
    <div className="relative pl-2" style={{ borderLeft: '1px solid var(--border-subtle)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-neutral-100 transition"
      >
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 grid place-items-center text-white font-semibold text-[12px]">
          {me.avatar}
        </div>
        <div className="leading-tight hidden xl:block text-left">
          <div className="text-[12px] text-neutral-900 font-medium">{me.name}</div>
          <div className="text-[10px] hum-faint">{me.title}</div>
        </div>
        <ChevronDown size={12} className={`text-neutral-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-11 z-50 w-52 rounded-lg bg-white shadow-lg py-1"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
              切换演示视角
            </div>
            {ROLES.map((r) => (
              <button
                key={r.key}
                onClick={() => switchTo(r.key)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition hover:bg-neutral-100 ${
                  r.key === currentRole ? 'bg-neutral-50' : ''
                }`}
              >
                <div className="w-6 h-6 rounded-full bg-neutral-900 text-white grid place-items-center text-[10.5px]">
                  {r.avatar}
                </div>
                <div className="flex-1 leading-tight">
                  <div className="text-[12px] text-neutral-900">{r.name}</div>
                  <div className="text-[10px] text-neutral-500">{r.title}</div>
                </div>
                {r.key === currentRole && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LiveChip({
  icon, label, value, tone, pulse,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'info' | 'success' | 'error' | 'muted';
  pulse?: boolean;
}) {
  const cls =
    tone === 'info' ? 'hum-chip is-brand' :
    tone === 'success' ? 'hum-chip is-success' :
    tone === 'error' ? 'hum-chip is-error' :
    'hum-chip';
  return (
    <span className={`${cls} ${pulse ? 'hum-pulse' : ''} hum-tabular`}>
      {icon}
      <span>{label}</span>
      <b style={{ fontWeight: 600 }}>{value}</b>
    </span>
  );
}
