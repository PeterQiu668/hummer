import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  Database, Cpu, Users2, Shuffle, Network as NetIcon, Wrench, Shield, Activity,
  GitBranch, Key, BookOpen, AlertCircle, Route, X, Layers, Target, Sparkles,
  Server, ListChecks,
} from 'lucide-react';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { AnimatePresence } from 'framer-motion';
import SpaceBackdrop from './SpaceBackdrop';
import ArchBase from './ArchBase';
import BossCockpit from './BossCockpit';
import { useAppStore } from '../../store/useAppStore';
import OfficeShell from './OfficeShell';
import ZonePlatform, { ZONE_SPECS } from './ZonePlatform';
import Workstations from './Workstations';
import CameraRig3D from './CameraRig3D';
import Lighting from './Lighting';
import FloatingParticles from './FloatingParticles';
import TaskPaths, { PATH_STATUS_COLOR, type HoverInfo } from './TaskPaths';
import { collabTasks } from '../../data/tasks';
import { ARCH_LAYERS, DB_NODE_PROFILE, TASK_TOWER_PROFILE, type ArchLayerId } from '../../data/archLayers';
import type { TaskStatus } from '../../lib/types';

const PATH_STATUS_META: { status: TaskStatus; label: string }[] = [
  { status: 'in_progress', label: '进行中' },
  { status: 'blocked', label: '已阻断' },
  { status: 'waiting_approval', label: '待审批' },
  { status: 'pending', label: '待启动' },
  { status: 'completed', label: '已完成' },
];

const DEFAULT_VISIBLE: TaskStatus[] = ['in_progress', 'blocked', 'waiting_approval'];

/** archLayers 模块图标名 → lucide 组件 */
const MODULE_ICONS: Record<string, any> = {
  Database, Cpu, Users2, Shuffle, Network: NetIcon, Wrench, Shield, Activity,
  GitBranch, Key, BookOpen, AlertCircle, Route, Target, Sparkles,
};

/**
 * v11 · Agent Workforce 立体总部（Agentrix 架构深度复刻）
 *  顶层 · Agent Workforce 办公室（参考图布局：Section A/B + Executive Suite/B3 + Conference Hub + Lounge + Evolution + 健身角）
 *  基座 · Data OS → Agent OS 双层平台堆叠（存储节点阵列 / 任务塔 / 层间数据流 / 层聚焦 / 元素档案）
 */
export default function OfficeStage3D() {
  const [visibleStatuses, setVisibleStatuses] = useState<TaskStatus[]>(DEFAULT_VISIBLE);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [focusLayer, setFocusLayer] = useState<ArchLayerId | null>(null);
  const [showDbNode, setShowDbNode] = useState(false);
  const [showTaskTower, setShowTaskTower] = useState(false);
  const activeZone = useAppStore((s) => s.activeZone);

  const edgeCount = collabTasks
    .filter((t) => visibleStatuses.includes(t.status))
    .reduce((n, t) => n + t.collaboratorIds.length, 0);

  const toggleStatus = (s: TaskStatus) =>
    setVisibleStatuses((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));

  const selectLayer = (id: ArchLayerId) => setFocusLayer((cur) => (cur === id ? null : id));
  const layer = focusLayer ? ARCH_LAYERS[focusLayer] : null;

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#1A1B1E' }}>
      {/* Top label */}
      <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none flex items-start justify-between gap-3">
        <StageLabel />
        <div className="hidden md:block text-right text-[10.5px] text-white/70 font-mono">
          拖拽旋转 · 滚轮缩放 · 点击楼层看架构 · 点击 NODE-37 / 任务塔看档案 · 双击工位
        </div>
      </div>

      <Canvas
        dpr={[1, 1.6]}
        shadows={false}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.12, preserveDrawingBuffer: true }}
        style={{ background: '#1A1B1E' }}
      >
        <PerspectiveCamera makeDefault position={[0, 26, 58]} fov={48} near={0.5} far={280} />
        <OrbitControls
          makeDefault enablePan={false}
          minDistance={12} maxDistance={95}
          minPolarAngle={Math.PI * 0.12}
          maxPolarAngle={Math.PI * 0.47}
          enableDamping dampingFactor={0.08}
          target={[0, -2.5, 0]}
        />
        <CameraRig3D />
        <Suspense fallback={null}>
          <SpaceBackdrop />
          <Lighting />
          {/* 三层架构：Data OS → Agent OS（基座）→ Agent Workforce（办公室） */}
          <ArchBase
            focusLayer={focusLayer}
            onSelectLayer={selectLayer}
            onSelectDbNode={() => setShowDbNode((v) => !v)}
            onSelectTaskTower={() => setShowTaskTower((v) => !v)}
          />
          <OfficeShell focusLayer={focusLayer} onSelectLayer={selectLayer} />
          {ZONE_SPECS.map((spec) => <ZonePlatform key={spec.id} spec={spec} />)}
          <Workstations />
          <TaskPaths visibleStatuses={visibleStatuses} onHover={setHoverInfo} />
          <FloatingParticles count={130} color="#3B82F6" />
          {/* Bloom 辉光：霓虹/自发光表面泛光，整体科技高级感 */}
          <EffectComposer multisampling={0}>
            <Bloom intensity={0.75} luminanceThreshold={0.32} luminanceSmoothing={0.28} mipmapBlur radius={0.72} />
          </EffectComposer>
        </Suspense>
      </Canvas>

      {/* 老板驾驶舱（点击 EXECUTIVE SUITE 聚焦时弹出） */}
      <AnimatePresence>{activeZone === 'boss' && <BossCockpit />}</AnimatePresence>

      {/* 右下 · 架构层档案 + 元素档案（Agentrix 式弹窗） */}
      <div className="absolute right-3 bottom-3 z-20 flex flex-col gap-2 items-end">
        {showDbNode && (
          <DetailCard
            icon={Server} accent="#22D3EE" chip={DB_NODE_PROFILE.chip} title={DB_NODE_PROFILE.title}
            summary={DB_NODE_PROFILE.summary} details={DB_NODE_PROFILE.details}
            onClose={() => setShowDbNode(false)}
          />
        )}
        {showTaskTower && (
          <DetailCard
            icon={ListChecks} accent="#C084FC" chip={TASK_TOWER_PROFILE.chip} title={TASK_TOWER_PROFILE.title}
            summary={TASK_TOWER_PROFILE.summary} details={TASK_TOWER_PROFILE.details}
            onClose={() => setShowTaskTower(false)}
          />
        )}
        {layer && (
          <div
            className="w-[320px] rounded-lg backdrop-blur-md overflow-hidden"
            style={{ background: 'rgba(10,15,30,0.9)', border: `1px solid ${layer.accent}55` }}
          >
            <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${layer.accent}33` }}>
              <div className="flex items-center gap-2">
                <Layers size={13} style={{ color: layer.accent }} />
                <span className="text-[12.5px] font-semibold" style={{ color: layer.accent }}>{layer.badge}</span>
                <span className="text-[10.5px] text-white/60">{layer.title}</span>
              </div>
              <button onClick={() => setFocusLayer(null)} className="text-white/50 hover:text-white transition-colors">
                <X size={13} />
              </button>
            </div>
            <div className="px-3 pt-2 text-[10.5px] text-white/60 leading-relaxed">{layer.summary}</div>
            {/* 关键指标（复刻 Agentrix stats 行） */}
            <div className="flex items-center gap-1.5 px-3 pt-2">
              {layer.stats.map((s) => (
                <div key={s.label} className="flex-1 rounded-md px-2 py-1 text-center" style={{ background: `${layer.accent}12`, border: `1px solid ${layer.accent}2a` }}>
                  <div className="text-[11px] font-semibold" style={{ color: layer.accent }}>{s.value}</div>
                  <div className="text-[9px] text-white/50">{s.label}</div>
                </div>
              ))}
            </div>
            {/* 能力特性 */}
            <ul className="px-4 pt-2 space-y-0.5">
              {layer.features.map((f) => (
                <li key={f} className="text-[10px] text-white/70 leading-relaxed list-disc list-inside marker:text-white/30">{f}</li>
              ))}
            </ul>
            {/* 引擎模块 */}
            <div className="grid grid-cols-2 gap-1.5 p-3">
              {layer.modules.map((m) => {
                const Icon = MODULE_ICONS[m.icon] ?? Layers;
                return (
                  <div
                    key={m.label}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md"
                    style={{ background: `${layer.accent}14`, border: `1px solid ${layer.accent}30` }}
                  >
                    <Icon size={12} style={{ color: layer.accent }} />
                    <div className="leading-tight">
                      <div className="text-[10.5px] font-medium text-white/90 whitespace-nowrap">{m.label}</div>
                      <div className="text-[9px] text-white/50 font-mono whitespace-nowrap">{m.sub}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 工作路径图例 · 状态筛选（点击 chip 开关对应状态的路径） */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1.5">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-md backdrop-blur-md"
          style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(59,130,246,0.35)' }}
        >
          <Route size={12} className="text-primary-300 shrink-0" />
          <span className="text-[10.5px] font-semibold text-primary-200 whitespace-nowrap">
            工作路径 · {edgeCount} 条协作边 / {collabTasks.length} 任务
          </span>
          <div className="flex items-center gap-1">
            {PATH_STATUS_META.map(({ status, label }) => {
              const on = visibleStatuses.includes(status);
              const c = PATH_STATUS_COLOR[status];
              return (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-opacity"
                  style={{
                    background: on ? `${c}33` : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${on ? c : 'rgba(255,255,255,0.15)'}`,
                    color: on ? c : 'rgba(255,255,255,0.45)',
                    opacity: on ? 1 : 0.7,
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: on ? c : 'transparent', border: `1px solid ${c}` }} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 悬停路径 → 任务卡片 */}
        {hoverInfo && (
          <div
            className="px-3 py-2 rounded-md backdrop-blur-md max-w-[360px]"
            style={{ background: 'rgba(10,15,30,0.85)', border: `1px solid ${PATH_STATUS_COLOR[hoverInfo.status]}66` }}
          >
            <div className="text-[11.5px] font-semibold text-white leading-snug">{hoverInfo.title}</div>
            <div className="flex items-center gap-2 mt-1 text-[10px] font-mono">
              <span style={{ color: PATH_STATUS_COLOR[hoverInfo.status] }}>
                {PATH_STATUS_META.find((m) => m.status === hoverInfo.status)?.label ?? hoverInfo.status} · {hoverInfo.progress}%
              </span>
              <span className="text-white/60">{hoverInfo.ownerName} → {hoverInfo.collabName}</span>
              {(hoverInfo.priority === 'urgent' || hoverInfo.priority === 'high') && (
                <span className="text-warning">{hoverInfo.priority === 'urgent' ? '紧急' : '高优'}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────── 元素档案卡（NODE-37 数据库 / TASK-42 任务，复刻 Agentrix 弹窗） ─────────── */
function DetailCard({ icon: Icon, accent, chip, title, summary, details, onClose }: {
  icon: any; accent: string; chip: string; title: string; summary: string;
  details: { label: string; value: string }[];
  onClose: () => void;
}) {
  return (
    <div
      className="w-[300px] rounded-lg backdrop-blur-md overflow-hidden"
      style={{ background: 'rgba(10,15,30,0.9)', border: `1px solid ${accent}55` }}
    >
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${accent}33` }}>
        <div className="flex items-center gap-2">
          <Icon size={13} style={{ color: accent }} />
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}>
            {chip}
          </span>
          <span className="text-[12px] font-semibold text-white/90">{title}</span>
        </div>
        <button onClick={onClose} className="text-white/50 hover:text-white transition-colors">
          <X size={13} />
        </button>
      </div>
      <div className="px-3 pt-2 text-[10px] text-white/60 leading-relaxed">{summary}</div>
      <div className="p-3 space-y-1">
        {details.map((d) => (
          <div key={d.label} className="flex items-center justify-between text-[10px]">
            <span className="text-white/45">{d.label}</span>
            <span className="text-white/85 font-mono text-right">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────── Stage label ─────────── */
function StageLabel() {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-md backdrop-blur-md"
      style={{
        background: 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(15, 112, 183, 0.45)',
      }}
    >
      <Users2 size={12} className="text-primary-300" />
      <div className="leading-tight">
        <div className="text-[11.5px] font-semibold tracking-wide text-primary-200">Agent Workforce · HUMMER HQ</div>
        <div className="text-[10px] text-white/70">三层架构 · Data OS → Agent OS → Agent Workforce（15 位数字员工 / 6 分区）</div>
      </div>
    </div>
  );
}
