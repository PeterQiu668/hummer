/**
 * BossCockpit · 老板驾驶舱 HUD（点击 EXECUTIVE SUITE 聚焦后弹出）
 * 经营 KPI / 待审批 / 风险阻断 / 高管分身状态，一键进入完整驾驶舱页（execws）
 */
import { motion } from 'framer-motion';
import {
  Crown, X, TrendingUp, CircleDollarSign, Gauge, ShieldAlert,
  Stamp, ArrowRight, Users2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { collabTasks } from '../../data/tasks';
import { employees } from '../../data/employees';

const ACCENT = '#A855F7';

export default function BossCockpit() {
  const setActiveZone = useAppStore((s) => s.setActiveZone);
  const setActivePage = useAppStore((s) => s.setActivePage);

  const approvals = collabTasks.filter((t) => t.status === 'waiting_approval');
  const blocked = collabTasks.filter((t) => t.status === 'blocked');
  const inProgress = collabTasks.filter((t) => t.status === 'in_progress');
  const working = employees.filter((e) => e.status === 'working').length;
  const avgProgress = inProgress.length
    ? Math.round(inProgress.reduce((n, t) => n + t.progress, 0) / inProgress.length)
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="absolute left-3 top-14 z-20 w-[308px] rounded-lg backdrop-blur-md overflow-hidden"
      style={{ background: 'rgba(12,10,26,0.92)', border: `1px solid ${ACCENT}55`, boxShadow: `0 0 24px ${ACCENT}22` }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${ACCENT}33` }}>
        <div className="flex items-center gap-2">
          <Crown size={13} style={{ color: '#D4AF37' }} />
          <span className="text-[12.5px] font-semibold" style={{ color: ACCENT }}>老板驾驶舱</span>
          <span className="text-[10px] text-white/55 font-mono">EXECUTIVE COCKPIT · B3</span>
        </div>
        <button onClick={() => setActiveZone(null)} className="text-white/50 hover:text-white transition-colors">
          <X size={13} />
        </button>
      </div>

      {/* 经营 KPI */}
      <div className="grid grid-cols-3 gap-1.5 px-3 pt-2.5">
        <Kpi icon={CircleDollarSign} label="本月回款" value="¥286w" trend="+12%" />
        <Kpi icon={TrendingUp} label="任务推进" value={`${avgProgress}%`} trend={`${inProgress.length} 在途`} />
        <Kpi icon={Gauge} label="在岗员工" value={`${working}/${employees.length}`} trend="LIVE" />
      </div>

      {/* 待审批 */}
      <Section
        icon={Stamp} tint="#F59E0B"
        title={`待我审批 · ${approvals.length}`}
        items={approvals.slice(0, 3).map((t) => ({ key: t.id, main: t.title, sub: `${t.progress}% · ${t.priority === 'urgent' ? '紧急' : t.priority === 'high' ? '高优' : '常规'}` }))}
        empty="没有等待审批的事项"
      />

      {/* 风险阻断 */}
      <Section
        icon={ShieldAlert} tint="#C13D3D"
        title={`风险阻断 · ${blocked.length}`}
        items={blocked.slice(0, 3).map((t) => ({ key: t.id, main: t.title, sub: `卡在 ${t.progress}%` }))}
        empty="当前无高危阻断"
      />

      {/* 高管分身 */}
      <div className="px-3 pt-2">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-white/80">
          <Users2 size={11} style={{ color: ACCENT }} /> 高管分身在线
        </div>
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          {['CEO', '销售VP', '运营VP', '产品', 'CFO', '法务'].map((r) => (
            <span key={r} className="px-1.5 py-0.5 rounded text-[9.5px] font-medium"
              style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}35`, color: '#D8B4FE' }}>
              {r}
            </span>
          ))}
        </div>
      </div>

      {/* 进入完整驾驶舱 */}
      <button
        onClick={() => setActivePage('execws')}
        className="m-3 mt-2.5 flex items-center justify-center gap-1.5 w-[calc(100%-24px)] py-1.5 rounded-md text-[11px] font-semibold transition-opacity hover:opacity-85"
        style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}66`, color: '#E9D5FF' }}
      >
        进入完整驾驶舱 <ArrowRight size={12} />
      </button>
    </motion.div>
  );
}

function Kpi({ icon: Icon, label, value, trend }: { icon: any; label: string; value: string; trend: string }) {
  return (
    <div className="rounded-md px-2 py-1.5" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.22)' }}>
      <div className="flex items-center gap-1 text-[9px] text-white/50">
        <Icon size={10} style={{ color: '#C084FC' }} /> {label}
      </div>
      <div className="text-[13px] font-bold text-white/95 leading-tight mt-0.5">{value}</div>
      <div className="text-[9px] font-mono" style={{ color: '#C084FC' }}>{trend}</div>
    </div>
  );
}

function Section({ icon: Icon, tint, title, items, empty }: {
  icon: any; tint: string; title: string;
  items: { key: string; main: string; sub: string }[];
  empty: string;
}) {
  return (
    <div className="px-3 pt-2.5">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-white/80">
        <Icon size={11} style={{ color: tint }} /> {title}
      </div>
      <div className="mt-1 space-y-1">
        {items.length === 0 && <div className="text-[10px] text-white/40">{empty}</div>}
        {items.map((it) => (
          <div key={it.key} className="flex items-center justify-between gap-2 px-2 py-1 rounded"
            style={{ background: `${tint}0d`, border: `1px solid ${tint}26` }}>
            <span className="text-[10px] text-white/85 truncate">{it.main}</span>
            <span className="text-[9px] font-mono whitespace-nowrap" style={{ color: tint }}>{it.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
