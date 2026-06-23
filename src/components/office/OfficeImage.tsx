/**
 * OfficeImage v4 · 企业正规交付版
 * 风格基线：参考 codex 浅色 enterprise hero-band
 *   - 浅色调（白卡片 + 浅蓝灰底）
 *   - 克制青色 accent (#16abc8)，无 neon glow
 *   - 工位 pin 用 codex 同款（tan 头 + navy 半圆身）
 *   - 旧霓虹版保留在 OfficeImageNeon.tsx
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import { workstations, type Workstation } from '../../data/workstations';
import type { Employee, ZoneId } from '../../lib/types';
import {
  Activity, ShieldAlert, Network, Layers,
  Play, ChevronRight, AlertTriangle, Coffee, ClipboardCheck, UserPlus, Search,
} from 'lucide-react';

// ───────────────────────── Tokens（企业克制版） ─────────────────────────
const INK = '#16293a';
const MUTED = '#678092';
const LINE = '#d9e5ea';
const SOFT_LINE = '#e3edf2';
const SURFACE = 'rgba(255,255,255,0.94)';
const CANVAS = 'linear-gradient(145deg, #e3f0f5 0%, #eef4fb 45%, #edf4f1 100%)';
const ACCENT = '#16abc8';
const RED = '#bd4854';

// Zone 配色（克制 · 不饱和）
const ZONE_LABEL: Record<ZoneId, { name: string; color: string; x: number; y: number; note: string }> = {
  boss:     { name: '老板办公室',     color: '#e7bd4e', x: 81, y: 13, note: '审批、经营驾驶舱与战略决策' },
  business: { name: '业务办公区',     color: '#2cb9d3', x: 47, y: 34, note: '销售、运营、设计、研发、安全' },
  support:  { name: '支持中心',       color: '#eca73b', x: 17, y: 31, note: '财务、法务、人力、客服' },
  meeting:  { name: '项目会议室',     color: '#796ff0', x: 69, y: 54, note: '项目复盘、行动项与共识' },
  rest:     { name: '休息待命区',     color: '#df63ac', x: 89, y: 46, note: '低优先级与员工待命管理' },
  learn:    { name: '进化训练区',     color: '#28c69f', x: 17, y: 15, note: '评测、复盘与 SOP 进化' },
};

// 状态（企业色板 · 不带 neon）
const STATUS: Record<string, { color: string; head: string; body: string; label: string; tag: string }> = {
  working:  { color: '#14809a', head: '#ffc57f', body: '#174b57', label: '工作中', tag: 'working' },
  meeting:  { color: '#5b54c2', head: '#f5d3b0', body: '#3f3681', label: '会议中', tag: 'meeting' },
  blocked:  { color: '#b34c59', head: '#ffc57f', body: '#7a2731', label: '阻断中', tag: 'blocked' },
  training: { color: '#3f5cbe', head: '#f0d9bd', body: '#26397a', label: '训练中', tag: 'training' },
  idle:     { color: '#56707e', head: '#ffc57f', body: '#3c4d57', label: '待命',   tag: 'idle' },
};

export default function OfficeImage() {
  const { setSelectedEmployee, activeZone, setActiveZone } = useAppStore();
  const [hovered, setHovered] = useState<string | null>(null);
  const [showNames, setShowNames] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [follow, setFollow] = useState(false);

  const employeeMap = new Map(employees.map((e) => [e.id, e]));
  const filledCount = workstations.filter((w) => w.employeeId).length;
  const totalCount = workstations.length;
  const visibleStations = workstations.filter((w) => w.employeeId || showEmpty);
  const teamProgress = Math.round(
    employees.reduce((acc, e) => acc + (e.progress || 0), 0) / employees.length,
  );

  const activeZoneMeta = activeZone ? ZONE_LABEL[activeZone] : null;

  return (
    <div
      className="relative h-full w-full overflow-y-auto"
      style={{ background: CANVAS, color: INK, fontFamily: 'HarmonyOS Sans, Inter, "Microsoft YaHei", system-ui, sans-serif' }}
    >
      {/* ─────────── Topbar（sticky） ─────────── */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between gap-5 px-5 py-3 border-b backdrop-blur"
        style={{ background: 'rgba(235, 244, 248, 0.88)', borderColor: 'rgba(174,198,208,.62)' }}
      >
        <div className="min-w-0">
          <div className="text-[11px]" style={{ color: '#657e90', letterSpacing: '0.04em' }}>
            OpenClaw · Hermes · OpenHuman · HiClaw · A2A / MCP
          </div>
          <h1 className="text-[20px] font-semibold mt-0.5" style={{ color: INK }}>
            3D 数字员工总部
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Chip icon="⌁" label="员工在线" value={String(filledCount)} />
          <Chip icon="▦" label="团队进度" value={`${teamProgress}%`} />
          <Chip icon="▤" label="图谱" value="9.6k 边" />
          <Chip icon="♢" label="高危冻结" value="2" danger />
        </div>
      </header>

      {/* ─────────── Content scroll ─────────── */}
      <div className="px-6 pb-6 pt-3 space-y-3">

        {/* ─────────── Hero band ─────────── */}
        <section
          className="rounded-2xl px-6 py-5"
          style={{ background: SURFACE, border: `1px solid ${LINE}`, boxShadow: '0 14px 35px rgba(61,106,123,.08)' }}
        >
          <div
            className="text-[11px] font-black tracking-[0.22em]"
            style={{ color: '#10a0c0' }}
          >
            SPATIAL AGENT OPERATING SYSTEM
          </div>
          <h2 className="text-[26px] leading-tight mt-2 font-bold" style={{ color: INK }}>
            把企业数字员工·放回他们真正工作的办公室。
          </h2>
          <p className="text-[13px] mt-2 leading-relaxed" style={{ color: MUTED }}>
            工作中回工区·会议中进会议室·进化中进训练区·休息时进入待命区。
            老板办公室是公司运营驾驶舱，而不是聊天窗口。
          </p>
          <div className="grid grid-cols-4 gap-2.5 mt-4">
            <Metric value={String(filledCount)} sub="默认员工" />
            <Metric value="3" sub="待老板审批" />
            <Metric value="¥1,283" sub="模型成本 (今日)" />
            <Metric value="99.2%" sub="知识命中" />
          </div>
        </section>

        {/* ─────────── Scene section ─────────── */}
        <section
          className="rounded-2xl px-3.5 pt-3 pb-3.5"
          style={{ background: SURFACE, border: `1px solid ${LINE}`, boxShadow: '0 12px 30px rgba(62,98,113,.08)' }}
        >
          {/* Section toolbar */}
          <div className="flex items-center justify-between gap-3 pb-2.5 px-1">
            <div>
              <div className="text-[14px] font-semibold" style={{ color: INK }}>
                ▥ 硅谷科技总部 · 可交互 3D
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: MUTED }}>
                {activeZoneMeta
                  ? <><span style={{ color: activeZoneMeta.color }}>● </span>{activeZoneMeta.name} · {activeZoneMeta.note}</>
                  : '点击区域拉近 · 点击员工查看任务/权限/记忆'}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <ToolBtn active={showNames} onClick={() => setShowNames((v) => !v)}>名牌</ToolBtn>
              <ToolBtn active={showEmpty} onClick={() => setShowEmpty((v) => !v)}>空位</ToolBtn>
              <ToolBtn active={follow} onClick={() => setFollow((v) => !v)}>
                <Play size={11} strokeWidth={2.5} className="inline -mt-0.5 mr-0.5" />
                {follow ? '跟随中' : '跟随模式'}
              </ToolBtn>
              <ToolBtn>下一幕 <ChevronRight size={11} className="inline -mt-0.5" /></ToolBtn>
            </div>
          </div>

          {/* Office scene */}
          <div
            className="relative w-full overflow-hidden rounded-xl"
            style={{ aspectRatio: '1024 / 558', background: '#cbdce4', border: `1px solid ${LINE}` }}
          >
            <img
              src="/office-bg.png"
              alt="Sybernetic Lobster Factory Office"
              className="absolute inset-0 w-full h-full select-none pointer-events-none"
              style={{ objectFit: 'cover' }}
              draggable={false}
            />
            {/* gentle bottom darken for legibility */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(180deg, rgba(10,40,54,.02), rgba(8,29,39,.1))' }}
            />

            {/* Zone hotspots */}
            {Object.entries(ZONE_LABEL).map(([key, z]) => {
              const isActive = activeZone === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveZone(isActive ? null : (key as ZoneId))}
                  className="absolute -translate-x-1/2 -translate-y-1/2 transition"
                  style={{
                    left: `${z.x}%`, top: `${z.y}%`, zIndex: 5,
                    opacity: hovered ? 0.85 : 1,
                  }}
                  aria-label={`查看${z.name}`}
                >
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md whitespace-nowrap text-[10px] font-medium tracking-wider transition"
                    style={{
                      background: 'rgba(8, 25, 35, .82)',
                      border: `1px solid color-mix(in srgb, ${z.color} 80%, white)`,
                      color: 'white',
                      boxShadow: isActive
                        ? `0 4px 14px rgba(0,0,0,.28), 0 0 0 2px ${z.color}55`
                        : '0 4px 12px rgba(0,0,0,.22)',
                      transform: isActive ? 'scale(1.06)' : 'scale(1)',
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: z.color, boxShadow: `0 0 0 4px ${z.color}33` }}
                    />
                    {z.name}
                  </div>
                </button>
              );
            })}

            {/* Workstation pins */}
            {visibleStations.map((ws) => {
              const employee = ws.employeeId ? employeeMap.get(ws.employeeId) : undefined;
              const isInActiveZone = activeZone == null || activeZone === ws.zone || ws.zone === 'transit';
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

          {/* Footer caption + legend */}
          <div className="flex items-center justify-between mt-2.5 px-1">
            <div className="flex items-center gap-3 text-[11px]" style={{ color: MUTED }}>
              <span>共 <b style={{ color: INK }}>{filledCount}</b> / {totalCount} 工位</span>
              <span style={{ color: SOFT_LINE }}>·</span>
              <LegendDot color="#14809a" label="工作中" />
              <LegendDot color="#5b54c2" label="会议中" />
              <LegendDot color="#b34c59" label="阻断" />
              <LegendDot color="#3f5cbe" label="训练" />
              <LegendDot color="#56707e" label="待命" />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono tracking-wider" style={{ color: MUTED }}>
              <Search size={10} />
              <span>点击 pin · 进入员工详情</span>
            </div>
          </div>
        </section>

        {/* ─────────── Operations strip (codex 同款) ─────────── */}
        <section className="grid grid-cols-3 gap-3">
          <OpsCard
            eyebrow="HUMAN-IN-THE-LOOP"
            title="待老板审批"
            count="3"
            items={[
              { who: 'CEO助理', task: '本周经营简报', risk: '高' },
              { who: '法务审查员', task: '客户合同条款', risk: '高' },
              { who: '砚·财务官', task: '单笔 138w 资金调拨', risk: '中' },
            ]}
            accent="#bd4854"
          />
          <OpsCard
            eyebrow="LIVE EXECUTION"
            title="任务流（最近）"
            count="14"
            items={[
              { who: '林·决策官', task: 'Q3 OKR 拆解 · A2A 下发', risk: '低' },
              { who: '雪·销售官', task: 'BD 邮件草稿 · 等待外发', risk: '低' },
              { who: '岚·运营官', task: '618 复盘报告 · BI 取数', risk: '低' },
            ]}
            accent="#14809a"
          />
          <OpsCard
            eyebrow="EVOLUTION & GOVERNANCE"
            title="本周进化"
            count="24"
            items={[
              { who: 'Hermes', task: 'SOP「资金调拨」v3 → v4', risk: '中' },
              { who: 'Hermes', task: 'Skill「BD 邮件」+18% 回收', risk: '低' },
              { who: '安全治理官', task: 'mail.exchange · 冻结', risk: '高' },
            ]}
            accent="#5b54c2"
          />
        </section>
      </div>
    </div>
  );
}

// ─────────────────────── Pin（codex 同款 head+body） ───────────────────────

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
  // 空位
  if (!employee) {
    return (
      <div
        className="absolute group cursor-pointer"
        style={{
          left: `${ws.x}%`, top: `${ws.y}%`,
          transform: 'translate(-50%, -100%)',
          opacity: dimmed ? 0.25 : 0.55, zIndex: hovered ? 20 : 6,
        }}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
      >
        <div
          className="w-4 h-4 rounded-full flex items-center justify-center border-2 border-dashed transition"
          style={{ borderColor: 'rgba(255,255,255,.7)', background: 'rgba(8,25,35,.45)' }}
        >
          <UserPlus size={8} style={{ color: 'white' }} />
        </div>
        {hovered && (
          <div
            className="absolute left-1/2 -translate-x-1/2 -top-7 whitespace-nowrap text-[9px] font-medium px-1.5 py-0.5 rounded border"
            style={{ background: 'rgba(8,25,35,.85)', color: 'white', borderColor: 'rgba(255,255,255,.3)' }}
          >
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
      className="absolute group"
      style={{
        left: `${ws.x}%`, top: `${ws.y}%`,
        transform: `translate(-50%, -100%) scale(${hovered ? 1.5 : 1})`,
        transformOrigin: 'bottom center',
        transition: 'transform .15s ease-out',
        opacity: dimmed ? 0.4 : 1,
        zIndex: hovered ? 20 : 7,
      }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      {/* Pin: head + body */}
      <div className="relative" style={{ width: 16, height: 22 }}>
        {/* Risk halo */}
        {isRisk && (
          <span
            className="absolute left-1/2 -translate-x-1/2 top-0 w-3.5 h-3.5 rounded-full"
            style={{ boxShadow: `0 0 0 2px ${st.color}66`, animation: 'pulse 2s ease-in-out infinite' }}
          />
        )}
        {/* Head */}
        <span
          className="absolute left-1/2 -translate-x-1/2 top-0 w-2.5 h-2.5 rounded-full"
          style={{
            background: st.head,
            border: '2px solid white',
            boxShadow: `0 0 0 2px rgba(12, 41, 52, .55)`,
          }}
        />
        {/* Body (dome) */}
        <span
          className="absolute left-1/2 -translate-x-1/2 top-3 block"
          style={{
            width: 13, height: 7,
            background: st.body,
            borderRadius: '8px 8px 3px 3px',
            boxShadow: '0 2px 5px rgba(0, 0, 0, .28)',
          }}
        />
        {/* Tiny status dot (top-right) */}
        <span
          className="absolute"
          style={{
            right: -1, top: -1, width: 5, height: 5,
            borderRadius: '50%',
            background: st.color,
            border: '1px solid white',
          }}
        />
      </div>

      {/* Optional name label */}
      {showName && (
        <div
          className="absolute left-1/2 -translate-x-1/2 -bottom-5 whitespace-nowrap text-[9px] font-medium px-1.5 py-0.5 rounded border leading-none"
          style={{
            background: 'rgba(8,25,35,.85)',
            color: 'white',
            borderColor: `${st.color}aa`,
          }}
        >
          {employee.name.split('·')[0]}
        </div>
      )}

      {/* Hover detail card (counter-scaled to stay readable) */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-1/2 top-8 rounded-xl p-3 text-left z-30 origin-top"
            style={{
              width: 240,
              transform: 'translateX(-50%) scale(0.67)', // counter the 1.5 scale on parent
              background: 'rgba(255,255,255,.98)',
              border: `1px solid ${LINE}`,
              boxShadow: '0 18px 40px rgba(0,0,0,.22)',
              color: INK,
            }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="w-10 h-10 rounded-lg flex items-center justify-center font-semibold text-base shrink-0"
                style={{ background: `${st.color}1a`, color: st.color, border: `1px solid ${st.color}55` }}
              >
                {employee.avatar}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold truncate" style={{ color: INK }}>{employee.name}</div>
                <div className="text-[10px] mt-0.5 truncate" style={{ color: MUTED }}>{employee.role}</div>
              </div>
              <span
                className="text-[9px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap"
                style={{ color: st.color, borderColor: `${st.color}66`, background: `${st.color}10` }}
              >
                {st.label}
              </span>
            </div>
            <div className="mt-2 text-[11px] leading-snug line-clamp-2" style={{ color: INK }}>
              {employee.currentTask}
            </div>
            {typeof employee.progress === 'number' && (
              <div className="mt-2">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#e6eef1' }}>
                  <div className="h-full transition-all" style={{ width: `${employee.progress}%`, background: st.color }} />
                </div>
                <div className="text-[9px] mt-1 font-mono" style={{ color: MUTED }}>
                  {employee.progress}% · {employee.model.replace('Claude ', '')} · {(employee.tokensToday / 1000).toFixed(1)}K Token · ¥{employee.costToday.toFixed(1)}
                </div>
              </div>
            )}
            {isRisk && (
              <div
                className="mt-2 flex items-center gap-1 text-[10px] px-1.5 py-1 rounded"
                style={{ background: '#fff2f3', color: RED, border: '1px solid #efb3ba' }}
              >
                <AlertTriangle size={11} /> 守护者已阻断 · 待昆仑审批
              </div>
            )}
            {employee.status === 'idle' && (
              <div
                className="mt-2 flex items-center gap-1 text-[10px] px-1.5 py-1 rounded"
                style={{ background: '#eef4f8', color: '#56707e', border: '1px solid #cad9de' }}
              >
                <Coffee size={11} /> 任务已完成 · 节能模式
              </div>
            )}
            {employee.status === 'training' && (
              <div
                className="mt-2 flex items-center gap-1 text-[10px] px-1.5 py-1 rounded"
                style={{ background: '#eff2fb', color: '#3f5cbe', border: '1px solid #cfd6ee' }}
              >
                <ClipboardCheck size={11} /> Hermes 自进化训练中
              </div>
            )}
            <div className="mt-2 pt-2 flex items-center justify-between" style={{ borderTop: `1px solid ${SOFT_LINE}` }}>
              <span className="text-[10px]" style={{ color: MUTED }}>点击 · 进入员工详情</span>
              <ChevronRight size={12} style={{ color: st.color }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

// ─────────────────────── Sub‑components ───────────────────────

function Chip({
  icon, label, value, danger,
}: { icon: string; label: string; value: string; danger?: boolean }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] whitespace-nowrap"
      style={{
        background: 'rgba(255,255,255,.78)',
        border: `1px solid ${LINE}`,
        color: '#567082',
      }}
    >
      <span style={{ color: danger ? RED : ACCENT }}>{icon}</span>
      <span>{label}</span>
      <b style={{ color: danger ? RED : INK, fontWeight: 700 }}>{value}</b>
    </div>
  );
}

function Metric({ value, sub }: { value: string; sub: string }) {
  return (
    <div
      className="text-center rounded-2xl py-3"
      style={{ background: 'rgba(255,255,255,.78)', border: `1px solid ${LINE}` }}
    >
      <div className="text-[22px] font-bold leading-none" style={{ color: INK }}>{value}</div>
      <div className="text-[11px] mt-1.5" style={{ color: MUTED }}>{sub}</div>
    </div>
  );
}

function ToolBtn({
  children, active, onClick,
}: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 h-[30px] rounded-lg text-[11px] transition"
      style={{
        border: `1px solid ${active ? '#8cd5e1' : LINE}`,
        background: active ? '#e9f9fb' : 'white',
        color: active ? '#087f9c' : INK,
      }}
    >
      {active ? '✓ ' : '○ '}{children}
    </button>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      <span style={{ color: MUTED }}>{label}</span>
    </span>
  );
}

function OpsCard({
  eyebrow, title, count, items, accent,
}: {
  eyebrow: string;
  title: string;
  count: string;
  items: { who: string; task: string; risk: string }[];
  accent: string;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'rgba(255,255,255,.86)', border: `1px solid ${LINE}`, boxShadow: '0 6px 18px rgba(62,98,113,.06)' }}
    >
      <div className="flex items-start justify-between mb-2.5">
        <div>
          <div className="text-[9px] font-black tracking-[0.2em]" style={{ color: accent }}>{eyebrow}</div>
          <div className="text-[14px] font-semibold mt-1" style={{ color: INK }}>{title}</div>
        </div>
        <div className="text-[18px] font-bold" style={{ color: INK }}>{count}</div>
      </div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div
            key={i}
            className="flex items-center justify-between text-[11px] py-1.5 px-2 rounded-md"
            style={{ background: 'rgba(255,255,255,.6)', border: `1px solid ${SOFT_LINE}` }}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate" style={{ color: INK }}>{it.who}</div>
              <div className="text-[10px] truncate" style={{ color: MUTED }}>{it.task}</div>
            </div>
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-medium ml-2 shrink-0"
              style={{
                color: it.risk === '高' ? RED : it.risk === '中' ? '#a36e13' : '#14809a',
                background: it.risk === '高' ? '#fff2f3' : it.risk === '中' ? '#fff8e8' : '#e1f6fa',
                border: `1px solid ${it.risk === '高' ? '#efb3ba' : it.risk === '中' ? '#ecd49c' : '#9bdbe6'}`,
              }}
            >
              {it.risk}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
