/**
 * OfficeImage v3 · 按 codex 版风格调整
 * - 工位坐标重定位 · 按背景图实际桌位
 * - Pin 改为 14x18 小尺寸 head+body silhouette（codex 同款）
 * - 默认隐藏：空位 + 名牌（hover/click 才看）
 * - 顶部数据条按 codex 的 hero-band 风格
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import { workstations, type Workstation } from '../../data/workstations';
import type { Employee, ZoneId } from '../../lib/types';
import {
  AlertTriangle, Coffee, ClipboardCheck, UserPlus, MapPin, Camera, Play, ChevronRight, Activity, ShieldAlert, Network,
} from 'lucide-react';

const STATUS: Record<string, { color: string; body: string; label: string }> = {
  working:  { color: '#22c0d8', body: '#0d4859', label: '工作中' },
  meeting:  { color: '#b66cf2', body: '#4c2466', label: '会议中' },
  blocked:  { color: '#ef4f5f', body: '#5a1a22', label: '阻断中' },
  training: { color: '#7c83f5', body: '#252a6b', label: '训练中' },
  idle:     { color: '#8aa0ad', body: '#28333a', label: '待命' },
};

const ZONE_LABEL: Record<ZoneId, { name: string; color: string; x: number; y: number; note: string }> = {
  boss:     { name: '老板办公室',     color: '#e7bd4e', x: 81, y: 13, note: '审批 · 经营驾驶舱 · 战略决策' },
  business: { name: '业务办公区',     color: '#2cb9d3', x: 47, y: 34, note: '销售 / 运营 / 设计 / 研发 / 安全' },
  support:  { name: '支持中心',       color: '#eca73b', x: 17, y: 31, note: '财务 / 法务 / 人力 / 客服' },
  meeting:  { name: '项目会议室',     color: '#b66cf2', x: 69, y: 54, note: '项目复盘 · 行动项 · 共识' },
  rest:     { name: '休息待命区',     color: '#df63ac', x: 89, y: 46, note: '低优先级 · 节能 · 待命' },
  learn:    { name: '进化训练区',     color: '#28c69f', x: 17, y: 15, note: '评测 · 复盘 · SOP 进化' },
};

export default function OfficeImage() {
  const { setSelectedEmployee, activeZone, setActiveZone } = useAppStore();
  const [hovered, setHovered] = useState<string | null>(null);
  const [showNames, setShowNames] = useState(false);  // 默认隐藏名牌
  const [showEmpty, setShowEmpty] = useState(false);  // 默认隐藏空位

  const employeeMap = new Map(employees.map((e) => [e.id, e]));
  const filledCount = workstations.filter((w) => w.employeeId).length;
  const totalCount = workstations.length;
  const visibleStations = workstations.filter((w) => w.employeeId || showEmpty);

  const teamProgress = Math.round(
    employees.reduce((acc, e) => acc + (e.progress || 0), 0) / employees.length,
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-900 flex flex-col">

      {/* ============== HERO BAND（按 codex 版 hero-band 样式） ============== */}
      <div className="px-5 pt-3 pb-3 border-b border-neon-cyan/10">
        {/* eyebrow + 顶部 4 个状态 chips */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-mono tracking-[0.3em] text-neon-cyan/70">
              OPENCLAW · HERMES · OPENHUMAN · HICLAW · A2A / MCP
            </div>
            <h1 className="font-display text-[22px] mt-0.5 tracking-wider text-slate-100">
              3D 数字员工总部
            </h1>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
            <StatusChip icon={<Activity size={11} />} label="员工在线" value={`${filledCount}`} color="cyan" />
            <StatusChip icon={<Network size={11} />} label="团队进度" value={`${teamProgress}%`} color="cyan" />
            <StatusChip icon={<MapPin size={11} />} label="图谱" value="9.6k 边" color="cyan" />
            <StatusChip icon={<ShieldAlert size={11} />} label="高危冻结" value="2" color="red" />
          </div>
        </div>

        {/* SPATIAL AGENT OPERATING SYSTEM banner */}
        <div className="mt-2.5 glass rounded-sm border border-neon-cyan/15 px-4 py-3">
          <div className="text-[10px] font-mono font-bold tracking-[0.25em] text-neon-cyan">
            SPATIAL AGENT OPERATING SYSTEM
          </div>
          <div className="font-display text-[18px] text-slate-100 mt-1 leading-tight">
            把企业数字员工·放回他们真正工作的办公室。
          </div>
          <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            工作中回工区 · 会议中进会议室 · 进化中进训练区 · 休息时进入待命区。
            <span className="text-slate-500">老板办公室是公司运营驾驶舱，而不是聊天窗口。</span>
          </div>

          {/* 4 metric cards · 干净无 neon glow */}
          <div className="grid grid-cols-4 gap-2 mt-3">
            <Metric value={String(filledCount)} sub="数字员工 (在岗)" />
            <Metric value="3" sub="待老板审批" />
            <Metric value="¥1,283" sub="模型成本 (今日)" />
            <Metric value="99.2%" sub="知识命中" />
          </div>
        </div>
      </div>

      {/* ============== SCENE SECTION + BG IMAGE + 25 工位 ============== */}
      <div className="flex-1 relative min-h-0 px-3 pb-3 pt-2.5 flex flex-col">
        {/* section toolbar */}
        <div className="flex items-center justify-between gap-3 pb-2">
          <div>
            <div className="font-display text-sm text-slate-100">▥ 硅谷科技总部 · 可交互 3D</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              点击区域拉近 · 点击员工查看任务/权限/记忆 · 共 {filledCount} / {totalCount} 工位
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowNames((v) => !v)}
              className={`px-2.5 py-1 rounded-sm text-[11px] font-mono border transition
                ${showNames ? 'text-neon-cyan border-neon-cyan/60 bg-neon-cyan/10' : 'text-slate-400 border-slate-500/40 hover:text-neon-cyan'}`}
            >
              {showNames ? '✓' : '○'} 名牌
            </button>
            <button
              onClick={() => setShowEmpty((v) => !v)}
              className={`px-2.5 py-1 rounded-sm text-[11px] font-mono border transition
                ${showEmpty ? 'text-neon-cyan border-neon-cyan/60 bg-neon-cyan/10' : 'text-slate-400 border-slate-500/40 hover:text-neon-cyan'}`}
            >
              {showEmpty ? '✓' : '○'} 空位
            </button>
            <button className="px-2.5 py-1 rounded-sm text-[11px] font-mono border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10">
              <Play size={10} className="inline mr-0.5" /> 跟随模式
            </button>
            <button className="px-2.5 py-1 rounded-sm text-[11px] font-mono border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10">
              下一幕 <ChevronRight size={10} className="inline" />
            </button>
            <div className="flex items-center gap-1 px-2 py-1 glass rounded-sm text-[10px] font-mono text-neon-cyan/60">
              <Camera size={11} /> SPATIAL · v3
            </div>
          </div>
        </div>

        {/* image stage */}
        <div className="flex-1 relative flex items-center justify-center min-h-0">
          <div className="relative w-full h-full max-h-full max-w-full" style={{ aspectRatio: '1024 / 558' }}>
            <img
              src="/office-bg.png"
              alt="Sybernetic Lobster Factory Office"
              className="absolute inset-0 w-full h-full object-contain rounded-md select-none pointer-events-none"
              draggable={false}
            />
            <div className="absolute inset-0 rounded-md pointer-events-none border border-neon-cyan/15" />

            {/* Zone labels */}
            {Object.entries(ZONE_LABEL).map(([key, z]) => {
              const isActive = activeZone === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveZone(isActive ? null : (key as ZoneId))}
                  className="absolute -translate-x-1/2 -translate-y-1/2 group transition"
                  style={{ left: `${z.x}%`, top: `${z.y}%`, zIndex: 5 }}
                  title={z.note}
                >
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md backdrop-blur-sm font-display text-[10px] tracking-wider whitespace-nowrap"
                    style={{
                      background: isActive ? `${z.color}cc` : 'rgba(8, 25, 35, .78)',
                      color: isActive ? '#04060f' : '#fff',
                      border: `1px solid ${z.color}aa`,
                      opacity: hovered ? 0.65 : 0.86,
                      boxShadow: isActive ? `0 0 12px ${z.color}` : '0 4px 12px rgba(0,0,0,.22)',
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: z.color, boxShadow: `0 0 0 3px ${z.color}33` }} />
                    {z.name}
                  </div>
                </button>
              );
            })}

            {/* Workstation pins */}
            {visibleStations.map((ws) => {
              const employee = ws.employeeId ? employeeMap.get(ws.employeeId) : undefined;
              const isInActiveZone = activeZone == null || activeZone === ws.zone || (ws.zone === 'transit' && activeZone == null);
              return (
                <Pin
                  key={ws.id}
                  ws={ws}
                  employee={employee}
                  hovered={hovered === ws.id}
                  dimmed={!isInActiveZone}
                  showName={showNames}
                  onHover={() => setHovered(ws.id)}
                  onLeave={() => setHovered(null)}
                  onClick={() => employee && setSelectedEmployee(employee)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================== Pin ==============================
//
// 小型 map-pin：头(7px 圆) + 身体(11x7 半圆)，整体 ~14x18
// 状态通过 body 颜色 + 头部光环 + 顶角状态点表达
//
function Pin({
  ws, employee, hovered, dimmed, showName, onHover, onLeave, onClick,
}: {
  ws: Workstation;
  employee?: Employee;
  hovered: boolean;
  dimmed: boolean;
  showName: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  // 空工位
  if (!employee) {
    return (
      <div
        className="absolute group cursor-pointer"
        style={{
          left: `${ws.x}%`, top: `${ws.y}%`,
          transform: 'translate(-50%, -100%)',
          opacity: dimmed ? 0.25 : 0.6, zIndex: hovered ? 20 : 6,
        }}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
      >
        <div className="w-5 h-5 rounded-full border border-dashed border-slate-300/50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm group-hover:border-neon-cyan/80 transition">
          <UserPlus size={9} className="text-slate-300/70" />
        </div>
        {hovered && (
          <div className="absolute left-1/2 -translate-x-1/2 -top-7 chip-cyan whitespace-nowrap text-[9px]">
            空工位 · 招聘中
          </div>
        )}
      </div>
    );
  }

  const st = STATUS[employee.status];
  const isRisk = employee.status === 'blocked';

  return (
    <button
      className="absolute group transition-transform"
      style={{
        left: `${ws.x}%`, top: `${ws.y}%`,
        transform: `translate(-50%, -100%) scale(${hovered ? 1.45 : 1})`,
        opacity: dimmed ? 0.4 : 1,
        zIndex: hovered ? 20 : 7,
      }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      {/* The pin: head + body */}
      <div className="relative" style={{ width: 16, height: 22 }}>
        {/* Status halo behind head */}
        <span
          className={`absolute left-1/2 -translate-x-1/2 top-0 w-3.5 h-3.5 rounded-full ${isRisk ? 'animate-breathe' : ''}`}
          style={{
            boxShadow: `0 0 ${hovered ? 12 : 6}px ${st.color}cc`,
          }}
        />
        {/* Head (skin tone circle) */}
        <span
          className="absolute left-1/2 -translate-x-1/2 top-0 w-2.5 h-2.5 rounded-full border-2 border-white"
          style={{
            background: '#f7d4a9',
            boxShadow: `0 0 0 1.5px ${st.color}`,
          }}
        />
        {/* Body (dome) */}
        <span
          className="absolute left-1/2 -translate-x-1/2 top-2.5 w-3 h-2 rounded-t-md rounded-b-sm"
          style={{
            background: st.body,
            boxShadow: '0 2px 4px rgba(0,0,0,.4)',
          }}
        />
        {/* Status dot upper-right */}
        <span
          className="absolute -right-0.5 top-0 w-1.5 h-1.5 rounded-full border border-ink-900"
          style={{ background: st.color, boxShadow: `0 0 4px ${st.color}` }}
        />
        {/* Foot stem */}
        <span
          className="absolute left-1/2 -translate-x-1/2 bottom-0 w-0.5 h-1 rounded-full"
          style={{ background: st.body, opacity: 0.6 }}
        />
      </div>

      {/* Name (only when showName=true) */}
      {showName && (
        <div
          className="absolute left-1/2 -translate-x-1/2 -bottom-5 px-1 py-0 rounded-sm whitespace-nowrap text-[8.5px] font-mono leading-tight border backdrop-blur-sm"
          style={{
            color: st.color,
            borderColor: `${st.color}66`,
            background: 'rgba(4,6,15,.7)',
          }}
        >
          {employee.name.split('·')[0]}
        </div>
      )}

      {/* Hover card */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-1/2 -translate-x-1/2 top-8 w-60 glass-strong rounded-sm border p-2.5 shadow-neon-cyan z-30 text-left"
            style={{
              borderColor: `${st.color}88`,
              transform: `translate(-50%, 0) scale(${1 / 1.45})`,
              transformOrigin: 'top center',
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-9 h-9 rounded-sm flex items-center justify-center font-display font-black text-base border"
                style={{ background: `${st.color}22`, color: st.color, borderColor: `${st.color}66` }}
              >
                {employee.avatar}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm text-slate-100 truncate">{employee.name}</div>
                <div className="text-[10px] font-mono text-slate-400 truncate">{employee.role}</div>
              </div>
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm border"
                style={{ color: st.color, borderColor: `${st.color}66`, background: `${st.color}11` }}
              >
                {st.label}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-slate-300 line-clamp-2">{employee.currentTask}</div>
            {typeof employee.progress === 'number' && (
              <div className="mt-2 h-1 rounded-sm bg-ink-900 overflow-hidden">
                <div className="h-full transition-all" style={{ width: `${employee.progress}%`, background: st.color }} />
              </div>
            )}
            <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span>{employee.model.replace('Claude ', '')}</span>
              <span>{(employee.tokensToday / 1000).toFixed(1)}K · ¥{employee.costToday.toFixed(1)}</span>
            </div>
            {isRisk && (
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-neon-red">
                <AlertTriangle size={11} /> 守护者已阻断 · 待昆仑审批
              </div>
            )}
            {employee.status === 'idle' && (
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-neon-blue">
                <Coffee size={11} /> 任务已完成 · 节能模式
              </div>
            )}
            {employee.status === 'training' && (
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-neon-purple">
                <ClipboardCheck size={11} /> Hermes 自进化训练中
              </div>
            )}
            <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">点击 · 进入详情</span>
              <span className="text-[10px] font-mono" style={{ color: st.color }}>›</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

// ============================== Subcomponents ==============================

function StatusChip({
  icon, label, value, color,
}: { icon: React.ReactNode; label: string; value: string; color: 'cyan' | 'red' }) {
  const map = {
    cyan: 'text-neon-cyan border-neon-cyan/30',
    red:  'text-neon-red border-neon-red/40',
  };
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-sm border ${map[color]} bg-white/[0.03] backdrop-blur-sm`}>
      <span>{icon}</span>
      <span className="text-[10px] font-mono text-slate-400">{label}</span>
      <b className={`font-display text-[11px] ${map[color].split(' ')[0]}`}>{value}</b>
    </div>
  );
}

function Metric({ value, sub }: { value: string; sub: string }) {
  return (
    <div className="glass rounded-sm border border-white/10 px-3 py-2 text-center">
      <div className="font-display text-[20px] text-slate-100 leading-none">{value}</div>
      <div className="text-[10px] font-mono text-slate-400 mt-1 tracking-wide">{sub}</div>
    </div>
  );
}
