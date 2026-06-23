import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, Activity, Brain, Shield, FileText, Sparkles, Cpu, Coins,
  Lock, Unlock, AlertTriangle, CheckCircle2, Workflow, Play, Pause, RotateCcw,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

const tabs = [
  { id: 'overview', label: '身份', icon: Activity },
  { id: 'task', label: '实时任务', icon: Workflow },
  { id: 'skills', label: '技能树', icon: Brain },
  { id: 'permissions', label: '权限矩阵', icon: Shield },
  { id: 'audit', label: '审计链', icon: FileText },
  { id: 'evolution', label: '进化记录', icon: Sparkles },
];

export default function EmployeeDrawer() {
  const { selectedEmployee: e, setSelectedEmployee } = useAppStore();
  const [tab, setTab] = useState('overview');
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!e?.taskLines) return;
    setLines([]);
    let i = 0;
    const id = setInterval(() => {
      setLines((prev) => [...prev, e.taskLines![i % e.taskLines!.length]]);
      i++;
      if (i > 10) clearInterval(id);
    }, 700);
    return () => clearInterval(id);
  }, [e]);

  if (!e) return null;

  const statusMap: Record<string, { tone: string; text: string }> = {
    working: { tone: 'text-neon-cyan border-neon-cyan/50', text: '● 工作中' },
    blocked: { tone: 'text-neon-red border-neon-red/50', text: '● 守护者阻断' },
    meeting: { tone: 'text-neon-magenta border-neon-magenta/50', text: '● 会议中' },
    training: { tone: 'text-neon-purple border-neon-purple/50', text: '● 进化训练' },
    idle: { tone: 'text-slate-400 border-slate-500/50', text: '● 待命' },
  };
  const st = statusMap[e.status];

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 220, damping: 28 }}
      className="absolute top-14 bottom-72 right-80 w-[500px] z-40 glass-strong border-l border-neon-cyan/30 shadow-neon-cyan flex flex-col"
    >
      <div className="relative px-4 py-3 border-b border-neon-cyan/15 flex items-start gap-3">
        <div className="relative">
          <div className="w-14 h-14 rounded-sm bg-gradient-to-br from-neon-cyan/20 to-neon-magenta/20 border border-neon-cyan/40 flex items-center justify-center font-display font-black text-xl neon-text">
            {e.avatar}
          </div>
          <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-mono px-1.5 py-0.5 rounded-sm border bg-ink-900 whitespace-nowrap ${st.tone}`}>
            {st.text}
          </span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="font-display text-lg neon-text">{e.name}</div>
            <span className="chip-cyan">{e.role}</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-1">{e.department} · 归属 {e.twin}</div>
          {e.expert && (
            <div className="mt-1 text-[11px] text-neon-magenta/90">
              <Sparkles size={10} className="inline" /> 专家共创：{e.expert}
            </div>
          )}
        </div>
        <button onClick={() => setSelectedEmployee(null)} className="text-slate-400 hover:text-neon-cyan">
          <X size={18} />
        </button>
      </div>

      <div className="px-4 py-2 grid grid-cols-3 gap-2 border-b border-neon-cyan/10 bg-ink-900/40">
        <Stat icon={<Cpu size={11} />} label="模型" value={e.model} />
        <Stat icon={<Activity size={11} />} label="Token (今日)" value={e.tokensToday.toLocaleString()} />
        <Stat icon={<Coins size={11} />} label="成本 (今日)" value={`$${e.costToday.toFixed(2)}`} />
      </div>

      <div className="border-b border-neon-cyan/10 flex">
        {tabs.map((t) => {
          const A = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 px-2 py-2 flex items-center justify-center gap-1 text-[11px] font-mono uppercase tracking-wider transition relative
                ${A ? 'text-neon-cyan' : 'text-slate-400 hover:text-neon-cyan'}`}
            >
              <Icon size={12} />
              {t.label}
              {A && <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-neon-cyan shadow-neon-cyan" />}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'overview' && (
          <div className="space-y-3">
            <Panel title="当前任务">
              <div className="text-sm text-slate-200">{e.currentTask}</div>
              {typeof e.progress === 'number' && (
                <div className="mt-2">
                  <div className="h-1.5 bg-ink-900 rounded-sm overflow-hidden border border-neon-cyan/20">
                    <div className="h-full bg-gradient-to-r from-neon-cyan to-neon-magenta" style={{ width: `${e.progress}%` }} />
                  </div>
                  <div className="text-[10px] font-mono text-neon-cyan/70 mt-1">{e.progress}% 完成</div>
                </div>
              )}
            </Panel>
            <Panel title="责任归属链">
              <RibbonChain
                items={[
                  { label: '昆仑（人）', kind: 'human' },
                  { label: e.twin, kind: 'twin' },
                  { label: e.name, kind: 'agent' },
                  { label: e.currentTask || '空闲', kind: 'task' },
                ]}
              />
            </Panel>
            <Panel title="快捷动作">
              <div className="flex flex-wrap gap-2">
                <button className="btn-neon"><Play size={11} /> 派发新任务</button>
                <button className="btn-neon"><Pause size={11} /> 暂停</button>
                <button className="btn-neon-magenta"><RotateCcw size={11} /> 回滚最近变更</button>
              </div>
            </Panel>
          </div>
        )}

        {tab === 'task' && (
          <Panel title="员工屏幕实时数据流" right={<span className="text-[10px] font-mono text-neon-green animate-pulse">● LIVE</span>}>
            <div className="relative digital-screen rounded-sm border border-neon-green/30 bg-ink-900 p-3 h-72 overflow-hidden">
              <div className="data-stream absolute inset-0 pointer-events-none opacity-60" />
              <div className="relative font-mono text-[11px] text-neon-green space-y-1">
                {lines.map((l, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={l.startsWith('⚠') ? 'text-neon-red' : ''}
                  >
                    {l}
                  </motion.div>
                ))}
                <span className="inline-block w-2 h-3 bg-neon-green animate-pulse ml-1" />
              </div>
            </div>
          </Panel>
        )}

        {tab === 'skills' && (
          <Panel title="技能树">
            <div className="grid grid-cols-2 gap-2">
              {e.skills.map((s) => (
                <div key={s.id} className={`glass rounded-sm p-2.5 border
                  ${s.equipped ? 'border-neon-cyan/40' : 'border-white/10'}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-display text-slate-200">{s.name}</div>
                    <span className={`chip ${
                      s.source === 'expert' ? 'text-neon-magenta border-neon-magenta/40 bg-neon-magenta/5'
                      : s.source === 'marketplace' ? 'text-neon-amber border-neon-amber/40 bg-neon-amber/5'
                      : 'text-neon-cyan border-neon-cyan/40 bg-neon-cyan/5'}`}>
                      {s.source === 'expert' ? '专家' : s.source === 'marketplace' ? '市场' : '内置'}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className={`flex-1 h-1.5 rounded-sm ${i < s.level ? 'bg-neon-cyan' : 'bg-white/10'}`} />
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] font-mono text-slate-400 flex items-center justify-between">
                    <span>Lv.{s.level}</span>
                    {s.equipped ? <span className="text-neon-green">● 已装备</span> : <span className="text-slate-500">未装备</span>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {tab === 'permissions' && (
          <Panel title="权限矩阵 · 凭证统一托管">
            <div className="space-y-1.5">
              {e.permissions.map((p) => {
                const tone =
                  p.level === 'admin' ? 'text-neon-magenta border-neon-magenta/40'
                  : p.level === 'external' ? 'text-neon-amber border-neon-amber/40'
                  : p.level === 'write' ? 'text-neon-cyan border-neon-cyan/40'
                  : 'text-neon-green border-neon-green/40';
                return (
                  <div key={p.id} className="glass rounded-sm px-3 py-2 flex items-center gap-3">
                    {p.approvalRequired ? <Lock size={14} className="text-neon-amber" /> : <Unlock size={14} className="text-neon-green" />}
                    <div className="flex-1">
                      <div className="text-xs text-slate-200">{p.scope}</div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {p.approvalRequired ? '需人审批准（四眼原则）' : '在授权边界内自动执行'}
                      </div>
                    </div>
                    <span className={`chip ${tone} bg-transparent`}>{p.level.toUpperCase()}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 glass rounded-sm p-3 border border-neon-cyan/20">
              <div className="text-[11px] font-display text-neon-cyan tracking-wider mb-1">凭证存储</div>
              <div className="text-[11px] text-slate-300">所有 API Key、数据库凭证、第三方 Token 均由 <span className="text-neon-magenta">HiClaw AI Gateway</span> 统一托管，Agent 不持有任何凭证，只能通过策略代理调用。</div>
            </div>
          </Panel>
        )}

        {tab === 'audit' && (
          <Panel title="审计链 · Append-only" right={<span className="text-[10px] font-mono text-neon-cyan/70">{e.auditEntries.length} 条记录</span>}>
            <div className="space-y-1.5">
              {e.auditEntries.length === 0 && (
                <div className="text-xs text-slate-500 italic px-2 py-4">今日暂无审计事件</div>
              )}
              {e.auditEntries.map((a, i) => (
                <div key={a.id} className="glass rounded-sm px-3 py-2 flex items-start gap-2 border border-white/5">
                  <span className="text-[10px] font-mono text-slate-500 mt-0.5">#{String(i + 1).padStart(3, '0')}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-neon-cyan">{a.ts}</span>
                      <span className="text-xs text-slate-200">{a.action}</span>
                      {a.risk === 'high' && <AlertTriangle size={11} className="text-neon-red" />}
                      {a.risk === 'low' && <CheckCircle2 size={11} className="text-neon-green" />}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      目标 → <span className="text-slate-200">{a.target}</span>
                      {a.approver && <span className="text-neon-magenta"> · 审批人 {a.approver}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {tab === 'evolution' && (
          <div className="space-y-3">
            <Panel title="Hermes 进化指标">
              <div className="grid grid-cols-4 gap-2">
                <Stat icon={<Sparkles size={11} />} label="等级" value={`Lv.${e.evolution.level}`} />
                <Stat icon={<AlertTriangle size={11} />} label="Bad case" value={String(e.evolution.badCases)} />
                <Stat icon={<CheckCircle2 size={11} />} label="已优化" value={String(e.evolution.improved)} />
                <Stat icon={<Activity size={11} />} label="待审" value={String(e.evolution.pending)} />
              </div>
            </Panel>
            <Panel title="近期进化记录">
              <div className="space-y-1.5">
                {[
                  { t: '今日 13:40', e: 'SOP「资金调拨」v3 → v4 沙箱评测' },
                  { t: '昨日 17:22', e: 'Skill 描述「邮件草稿」精简 12 行' },
                  { t: '06.19 11:30', e: '工具路由策略：preferring claude-opus-4-7' },
                ].map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="font-mono text-[10px] text-neon-cyan w-20 shrink-0">{r.t}</span>
                    <span className="text-slate-200">{r.e}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="glass rounded-sm relative hud-corner">
      <div className="px-3 py-1.5 border-b border-neon-cyan/10 flex items-center justify-between">
        <div className="text-[10px] font-display tracking-widest text-neon-cyan">{title}</div>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="glass rounded-sm px-2 py-1.5 border border-white/5">
      <div className="text-[9px] font-mono text-neon-cyan/70 flex items-center gap-1">{icon} {label}</div>
      <div className="text-[12px] font-display text-slate-100 mt-0.5">{value}</div>
    </div>
  );
}

function RibbonChain({ items }: { items: { label: string; kind: 'human' | 'twin' | 'agent' | 'task' }[] }) {
  const colorMap: Record<string, string> = {
    human: 'from-neon-purple to-neon-magenta',
    twin: 'from-neon-magenta to-neon-cyan',
    agent: 'from-neon-cyan to-neon-green',
    task: 'from-neon-green to-neon-amber',
  };
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`px-2 py-1 rounded-sm text-[11px] font-mono bg-gradient-to-br ${colorMap[it.kind]} text-ink-900 font-bold`}>
            {it.label}
          </div>
          {i < items.length - 1 && <span className="text-neon-cyan/60">▸</span>}
        </div>
      ))}
    </div>
  );
}
