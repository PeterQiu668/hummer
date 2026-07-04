/**
 * 高管分身详情 modal — 责任边界 / 管辖员工 / 真实高管 / A2A 历史
 */
import { motion } from 'framer-motion';
import { X, ChevronRight, Users, MessagesSquare, Activity, Shield } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { executiveTwins, HUMAN_BOSS, BOSS_TWIN, a2aHandoffPool } from '../../data/executives';
import { employees } from '../../data/employees';

export default function ExecutiveDetail() {
  const id = useAppStore((s) => s.activeExecId);
  const setActiveExecId = useAppStore((s) => s.setActiveExecId);
  const setSelectedEmployee = useAppStore((s) => s.setSelectedEmployee);
  const setActivePage = useAppStore((s) => s.setActivePage);

  if (!id) return null;
  const ex = executiveTwins.find((x) => x.id === id);
  if (!ex) return null;

  const managed = employees.filter((e) => ex.managesEmployeeIds.includes(e.id));
  const handoffs = a2aHandoffPool.filter((h) => h.toId === ex.id || h.fromId === ex.id);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(15,15,14,0.32)', backdropFilter: 'blur(4px)' }}
      onClick={() => setActiveExecId(null)}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
        className="bg-white rounded-xl w-[680px] max-w-[94vw] max-h-[88vh] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-start gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="w-12 h-12 rounded-xl grid place-items-center text-white text-[16px] font-display font-bold"
            style={{ background: ex.color }}>
            {ex.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-neutral-900">{ex.name}</span>
              <span className="hum-chip is-brand">{ex.role}</span>
              {ex.pendingHandoffs > 0 && <span className="hum-chip is-warning">{ex.pendingHandoffs} 待回传</span>}
            </div>
            <div className="text-[11.5px] hum-muted mt-1">
              真实高管：<b className="text-neutral-900">{ex.humanName}</b> · {ex.humanTitle}
            </div>
          </div>
          <button onClick={() => setActiveExecId(null)} className="text-neutral-400 hover:text-neutral-900">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Responsibility chain visual */}
          <div className="hum-card-soft p-3">
            <div className="hum-eyebrow mb-2">责任链路</div>
            <div className="flex items-center gap-1 text-[11px] flex-wrap">
              <Node label={HUMAN_BOSS.name} sub="人 · 老板" color="#171717" />
              <ChevronRight size={11} className="text-neutral-300" />
              <Node label={BOSS_TWIN.name.split('·')[0]} sub="老板分身" color="#7E22CE" />
              <ChevronRight size={11} className="text-neutral-300" />
              <Node label={ex.name} sub={ex.role} color={ex.color} active />
              <ChevronRight size={11} className="text-neutral-300" />
              <Node label={ex.humanName} sub={`人 · ${ex.humanTitle.replace(ex.humanName, '').trim()}`} color="#171717" />
              <ChevronRight size={11} className="text-neutral-300" />
              <Node label="数字员工" sub={`${managed.length} 位执行 Agent`} color="#0F70B7" />
            </div>
          </div>

          {/* Responsibility scope */}
          <div>
            <div className="hum-eyebrow mb-1.5">责任边界</div>
            <div className="hum-card-soft p-3 text-[12.5px] text-neutral-700 leading-relaxed">
              {ex.responsibility}
            </div>
          </div>

          {/* Managed employees */}
          <div>
            <div className="hum-eyebrow mb-1.5 flex items-center gap-1.5">
              <Users size={11} /> 直接管辖的数字员工（{managed.length}）
            </div>
            <div className="grid grid-cols-2 gap-2">
              {managed.map((e) => (
                <button
                  key={e.id}
                  onClick={() => { setActiveExecId(null); setSelectedEmployee(e); }}
                  className="hum-card p-2.5 flex items-center gap-2.5 hover:hum-elev-2 transition text-left"
                >
                  <div className="w-9 h-9 rounded-lg grid place-items-center text-white font-bold text-[12px]"
                    style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}>
                    {e.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-neutral-900 truncate">{e.name}</div>
                    <div className="text-[11px] hum-muted truncate">{e.role}</div>
                  </div>
                  <ChevronRight size={12} className="text-neutral-400" />
                </button>
              ))}
            </div>
          </div>

          {/* A2A history */}
          <div>
            <div className="hum-eyebrow mb-1.5 flex items-center gap-1.5">
              <Activity size={11} /> A2A 委派历史（{handoffs.length}）
            </div>
            <div className="space-y-1">
              {handoffs.map((h, i) => (
                <div key={i} className="hum-card-soft p-2 text-[11.5px]">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-neutral-700">{h.fromLabel}</span>
                    <ChevronRight size={10} className="text-neutral-300" />
                    <span className="text-neutral-700">{h.toLabel}</span>
                    <span className="hum-faint text-[10px] font-mono ml-auto">{h.channel}</span>
                  </div>
                  <div className="text-neutral-600 pl-1">{h.intent}</div>
                </div>
              ))}
              {handoffs.length === 0 && <div className="text-[11.5px] hum-faint italic text-center py-3">暂无 A2A 委派</div>}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={() => { setActivePage('chat'); setActiveExecId(null); }}
            className="hum-btn is-sm"
          >
            <MessagesSquare size={11} /> 打开高管分身会议室
          </button>
          <span className="flex-1" />
          <button className="hum-btn is-sm"><Shield size={11} /> 调整责任边界</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Node({ label, sub, color, active }: { label: string; sub: string; color: string; active?: boolean }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] leading-tight whitespace-nowrap"
      style={{
        background: active ? `${color}1A` : 'var(--bg-subtle)',
        color: active ? color : 'var(--text-muted)',
        border: `1px solid ${active ? color + '40' : 'var(--border-subtle)'}`,
      }}
      title={sub}
    >
      {label}
    </span>
  );
}
