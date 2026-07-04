/**
 * RightConsole (v6) — 昆仑·数字分身 / 组织实时状态
 * 浅色克制风。父级在「选中 Agent」或「非首页」时会卸载本组件。
 */
import { motion } from 'framer-motion';
import { Bot, Workflow, Shield, Gauge, Sparkles, ChevronRight, Activity, Network } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import { executiveTwins, BOSS_TWIN, HUMAN_BOSS } from '../../data/executives';
import AgentAvatar from '../ui/AgentAvatar';

export default function RightConsole() {
  const setSelectedEmployee = useAppStore((s) => s.setSelectedEmployee);
  const setShowHermes = useAppStore((s) => s.setShowHermes);
  const setShowGovernance = useAppStore((s) => s.setShowGovernance);
  const tick = useAppStore((s) => s.tick);

  const working  = employees.filter((e) => e.status === 'working').length;
  const blocked  = employees.filter((e) => e.status === 'blocked').length;
  const meeting  = employees.filter((e) => e.status === 'meeting').length;
  const training = employees.filter((e) => e.status === 'training').length;

  // 实时小波动
  const livePct = 92 + ((tick * 7) % 8);

  return (
    <aside
      className="absolute right-0 top-12 bottom-[276px] w-[320px] z-20 flex flex-col bg-neutral-25"
      style={{ borderLeft: '1px solid var(--border-subtle)' }}
    >
      {/* Boss + Boss twin head */}
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="hum-eyebrow mb-2">老板 / 数字分身</div>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-neutral-900 text-white grid place-items-center text-[13px] font-display font-semibold">
            {HUMAN_BOSS.avatar}
          </div>
          <ChevronRight size={12} className="text-neutral-300" />
          <motion.div
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="relative w-9 h-9 rounded-lg bg-gradient-to-br from-primary-500 to-secondary-500 grid place-items-center text-white text-[13px] font-display font-bold"
          >
            {BOSS_TWIN.avatar}
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-success" />
          </motion.div>
          <div className="flex-1 min-w-0 leading-tight ml-1">
            <div className="text-[13px] text-neutral-900 font-semibold truncate">{BOSS_TWIN.name}</div>
            <div className="text-[10.5px] text-neutral-500 truncate">{BOSS_TWIN.title}</div>
          </div>
        </div>

        {/* Org pulse */}
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <PulseStat label="正在工作" value={working} dot="success" />
          <PulseStat label="会议中" value={meeting} dot="secondary" />
          <PulseStat label="训练中" value={training} dot="info" />
          <PulseStat label="风险阻断" value={blocked} dot={blocked > 0 ? 'error' : 'muted'} />
        </div>
      </div>

      {/* Executive twins chain */}
      <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-1.5 mb-2">
          <Network size={11} className="text-neutral-400" />
          <span className="hum-eyebrow">高管分身链路</span>
          <span className="hum-chip is-muted ml-auto" style={{ padding: '1px 6px', fontSize: 10 }}>
            {executiveTwins.reduce((s, t) => s + t.pendingHandoffs, 0)} 待回传
          </span>
        </div>
        <div className="space-y-1">
          {executiveTwins.map((ex) => (
            <button
              key={ex.id}
              onClick={() => useAppStore.getState().setActiveExecId(ex.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-neutral-100 transition cursor-pointer group text-left"
              title={`${ex.responsibility} · 真实高管：${ex.humanName} ${ex.humanTitle}`}
            >
              <div
                className="w-6 h-6 rounded-md grid place-items-center text-white text-[11px] font-semibold"
                style={{ background: ex.color }}
              >
                {ex.avatar}
              </div>
              <div className="flex-1 min-w-0 leading-tight">
                <div className="text-[12px] text-neutral-900 truncate">{ex.name}</div>
                <div className="text-[10px] hum-faint truncate">→ {ex.humanName} {ex.humanTitle.replace(ex.humanName, '').trim()}</div>
              </div>
              {ex.pendingHandoffs > 0 && (
                <span className="hum-chip is-warning" style={{ padding: '1px 5px', fontSize: 9 }}>
                  {ex.pendingHandoffs}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Live agents */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <Section title="实时员工状态" right={<span className="hum-chip is-success"><span className="hum-dot hum-pulse" style={{ background: 'var(--success)' }} />LIVE {livePct}%</span>}>
          <div className="space-y-0.5">
            {employees.slice(0, 8).map((e) => (
              <button
                key={e.id}
                onClick={() => setSelectedEmployee(e)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-neutral-100 transition group text-left"
              >
                <AgentAvatar id={e.id} size={28} status={e.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-neutral-900 truncate">
                    {e.name} <span className="text-neutral-400">· {e.role}</span>
                  </div>
                  <div className="text-[10.5px] text-neutral-500 truncate">{e.currentTask}</div>
                </div>
                <ChevronRight size={12} className="text-neutral-400 group-hover:text-neutral-700" />
              </button>
            ))}
          </div>
        </Section>

        <Section title="责任边界" right={<span className="hum-chip is-muted">OpenHuman 模型</span>}>
          <ResponsibilityRow icon={<Bot size={12} />} label="分身决策（您）" value="自主授权" />
          <ResponsibilityRow icon={<Workflow size={12} />} label="Agent 执行" value="授权范围内" />
          <ResponsibilityRow icon={<Shield size={12} />} label="高风险动作" value="人审准许" warn />
          <ResponsibilityRow icon={<Gauge size={12} />} label="对外发送" value="四眼原则" warn />
        </Section>

        <Section title="进化与治理">
          <button
            onClick={() => setShowHermes(true)}
            className="w-full hum-btn justify-between"
          >
            <span className="flex items-center gap-1.5"><Sparkles size={12} className="text-secondary-500" /> Hermes 进化飞轮</span>
            <span className="hum-faint text-[11px]">{training + 5} 任务</span>
          </button>
          <button
            onClick={() => setShowGovernance(true)}
            className="w-full hum-btn justify-between mt-1.5"
          >
            <span className="flex items-center gap-1.5"><Shield size={12} className="text-primary-600" /> HiClaw 治理舱</span>
            <span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}>ALL GREEN</span>
          </button>
        </Section>
      </div>

      {/* Footer mini activity */}
      <div className="px-3 py-2.5 flex items-center gap-2 text-[11px] text-neutral-500" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <Activity size={11} />
        <span className="flex-1">最近 5 分钟 · {18 + (tick % 7)} 次 Agent 调用</span>
        <span className="hum-tabular">¥{(1.28 + tick * 0.01).toFixed(2)}</span>
      </div>
    </aside>
  );
}

function Section({
  title, right, children,
}: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="hum-card-soft p-2">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <div className="hum-eyebrow">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function PulseStat({
  label, value, dot,
}: { label: string; value: number; dot: 'success' | 'secondary' | 'info' | 'error' | 'muted' }) {
  const color =
    dot === 'success' ? 'var(--success)' :
    dot === 'secondary' ? '#7E22CE' :
    dot === 'info' ? 'var(--brand)' :
    dot === 'error' ? 'var(--error)' :
    'var(--text-faint)';
  return (
    <div className="hum-card-soft px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-neutral-500">
        <span className="hum-dot" style={{ background: color }} />
        {label}
      </div>
      <div className="text-[16px] font-semibold text-neutral-900 hum-tabular mt-0.5">{value}</div>
    </div>
  );
}

function ResponsibilityRow({
  icon, label, value, warn,
}: { icon: React.ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <span className={warn ? 'text-warning' : 'text-neutral-500'}>{icon}</span>
      <span className="flex-1 text-[12px] text-neutral-700">{label}</span>
      <span className={`text-[11px] font-mono ${warn ? 'text-warning' : 'text-neutral-500'}`}>{value}</span>
    </div>
  );
}
