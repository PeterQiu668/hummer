import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  Database, Cpu, Users2, Shuffle, Network as NetIcon, Wrench, Shield, Activity,
  GitBranch, Key, BookOpen, AlertCircle, Route, X, Layers,
} from 'lucide-react';
import CityBackground from './CityBackground';
import HexPlatform from './HexPlatform';
import BasePedestal, { HQSign, type BaseLayerId } from './BasePedestal';
import ZonePlatform, { ZONE_SPECS } from './ZonePlatform';
import Workstations from './Workstations';
import CameraRig3D from './CameraRig3D';
import Lighting from './Lighting';
import FloatingParticles from './FloatingParticles';
import TaskPaths, { PATH_STATUS_COLOR, type HoverInfo } from './TaskPaths';
import { collabTasks } from '../../data/tasks';
import type { TaskStatus } from '../../lib/types';

const PATH_STATUS_META: { status: TaskStatus; label: string }[] = [
  { status: 'in_progress', label: '进行中' },
  { status: 'blocked', label: '已阻断' },
  { status: 'waiting_approval', label: '待审批' },
  { status: 'pending', label: '待启动' },
  { status: 'completed', label: '已完成' },
];

const DEFAULT_VISIBLE: TaskStatus[] = ['in_progress', 'blocked', 'waiting_approval'];

interface LayerModule { icon: any; label: string; sub: string; }

const BASE_LAYER_INFO: Record<BaseLayerId, { title: string; zh: string; accent: string; tagline: string; modules: LayerModule[] }> = {
  agentos: {
    title: 'Agent OS',
    zh: '智能体操作系统',
    accent: '#A855F7',
    tagline: '任务调度 · 模型路由 · 权限策略 · A2A 委派 · 工具网关 · 风险审批',
    modules: [
      { icon: Shuffle,     label: '任务调度',  sub: '186 / 5min' },
      { icon: Cpu,         label: '模型路由',  sub: '5 模型分层' },
      { icon: NetIcon,     label: 'A2A 委派',  sub: '6 高管分身' },
      { icon: Wrench,      label: 'MCP 工具',  sub: '12 已连接' },
      { icon: Shield,      label: '审批策略',  sub: '四眼原则' },
      { icon: AlertCircle, label: '风险阻断',  sub: '2 高危挂起' },
    ],
  },
  dataos: {
    title: 'Data OS',
    zh: '数据操作系统',
    accent: '#14B8A6',
    tagline: '企业知识图谱 · 业务数据 · 流程定义 · 权限身份 · 审计账本 · 凭证保险柜',
    modules: [
      { icon: BookOpen,  label: '知识图谱',   sub: '9.6k 边' },
      { icon: Database,  label: '业务数据',   sub: 'CRM · ERP · BI' },
      { icon: GitBranch, label: '流程',       sub: '24 SOP' },
      { icon: Users2,    label: '权限身份',   sub: 'RBAC + ABAC' },
      { icon: Activity,  label: '审计账本',   sub: 'Append-only' },
      { icon: Key,       label: '凭证保险柜', sub: '工牌令牌托管' },
    ],
  },
};

/**
 * v10 · Agent Workforce 立体总部
 *  顶层场景 · Agent Workforce（六大分区 + 数字员工 + 工作路径）
 *  基座双层 · Agent OS / Data OS（3D 基座，可点击展开引擎模块）
 */
export default function OfficeStage3D() {
  const [visibleStatuses, setVisibleStatuses] = useState<TaskStatus[]>(DEFAULT_VISIBLE);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [baseLayer, setBaseLayer] = useState<BaseLayerId | null>(null);

  const edgeCount = collabTasks
    .filter((t) => visibleStatuses.includes(t.status))
    .reduce((n, t) => n + t.collaboratorIds.length, 0);

  const toggleStatus = (s: TaskStatus) =>
    setVisibleStatuses((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));

  const layerInfo = baseLayer ? BASE_LAYER_INFO[baseLayer] : null;

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#1A1B1E' }}>
      {/* Top label */}
      <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none flex items-start justify-between gap-3">
        <StageLabel />
        <div className="hidden md:block text-right text-[10.5px] text-white/70 font-mono">
          拖拽旋转 · 滚轮缩放 · 点击基座看架构 · 双击工位
        </div>
      </div>

      <Canvas
        dpr={[1, 1.6]}
        shadows={false}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
        style={{ background: '#1A1B1E' }}
      >
        <PerspectiveCamera makeDefault position={[0, 28, 50]} fov={48} near={0.5} far={260} />
        <OrbitControls
          makeDefault enablePan={false}
          minDistance={12} maxDistance={75}
          minPolarAngle={Math.PI * 0.12}
          maxPolarAngle={Math.PI * 0.46}
          enableDamping dampingFactor={0.08}
          target={[0, -1.2, 0]}
        />
        <CameraRig3D />
        <Suspense fallback={null}>
          <CityBackground />
          <Lighting />
          <HexPlatform />
          <BasePedestal activeLayer={baseLayer} onSelect={(id) => setBaseLayer((cur) => (cur === id ? null : id))} />
          <HQSign />
          {ZONE_SPECS.map((spec) => <ZonePlatform key={spec.id} spec={spec} />)}
          <Workstations />
          <TaskPaths visibleStatuses={visibleStatuses} onHover={setHoverInfo} />
          <FloatingParticles count={130} color="#3B82F6" />
        </Suspense>
      </Canvas>

      {/* 基座层详情面板（点击 Agent OS / Data OS 基座展开） */}
      {layerInfo && (
        <div
          className="absolute right-3 bottom-3 z-20 w-[300px] rounded-lg backdrop-blur-md overflow-hidden"
          style={{ background: 'rgba(10,15,30,0.88)', border: `1px solid ${layerInfo.accent}55` }}
        >
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${layerInfo.accent}33` }}>
            <div className="flex items-center gap-2">
              <Layers size={13} style={{ color: layerInfo.accent }} />
              <span className="text-[12.5px] font-semibold" style={{ color: layerInfo.accent }}>{layerInfo.title}</span>
              <span className="text-[10.5px] text-white/60">{layerInfo.zh}</span>
            </div>
            <button onClick={() => setBaseLayer(null)} className="text-white/50 hover:text-white transition-colors">
              <X size={13} />
            </button>
          </div>
          <div className="px-3 pt-2 text-[10px] text-white/55 leading-relaxed">{layerInfo.tagline}</div>
          <div className="grid grid-cols-2 gap-1.5 p-3">
            {layerInfo.modules.map((m) => {
              const Icon = m.icon;
              return (
                <div
                  key={m.label}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-md"
                  style={{ background: `${layerInfo.accent}14`, border: `1px solid ${layerInfo.accent}30` }}
                >
                  <Icon size={12} style={{ color: layerInfo.accent }} />
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
        <div className="text-[10px] text-white/70">15 位数字员工 · 6 个分区 · 基座 Agent OS / Data OS</div>
      </div>
    </div>
  );
}
