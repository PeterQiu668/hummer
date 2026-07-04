import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  Database, Cpu, Users2, Shuffle, Network as NetIcon, Wrench, Shield, Activity,
  GitBranch, Key, BookOpen, FileText, AlertCircle,
} from 'lucide-react';
import CityBackground from './CityBackground';
import HexPlatform from './HexPlatform';
import ZonePlatform, { ZONE_SPECS } from './ZonePlatform';
import Workstations from './Workstations';
import CameraRig3D from './CameraRig3D';
import Lighting from './Lighting';

/**
 * v8 · 三层立体办公室
 *  L3 顶层 · Agent Workforce (3D 场景，视觉重点)
 *  L2 中层 · Agent OS  (调度 / 路由 / A2A / MCP / 审批 / 风险) — 透视斜面
 *  L1 底层 · Data OS   (知识图谱 / 业务数据 / 流程 / 权限 / 审计 / 凭证) — 更深透视
 */
export default function OfficeStage3D() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-50 flex flex-col">
      {/* ─── L3 顶层 · 3D 场景区 ─── */}
      <div className="relative flex-1 min-h-0">
        {/* Top label */}
        <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none flex items-start justify-between gap-3">
          <Layer3Label />
          <div className="hidden md:block text-right text-[10.5px] text-white/70 font-mono">
            拖拽旋转 · 滚轮缩放 · 双击工位
          </div>
        </div>

        <Canvas
          dpr={[1, 1.6]}
          shadows={false}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
          style={{ background: '#1A1B1E' }}
        >
          <PerspectiveCamera makeDefault position={[0, 22, 28]} fov={38} near={0.5} far={200} />
          <OrbitControls
            makeDefault enablePan={false}
            minDistance={12} maxDistance={45}
            minPolarAngle={Math.PI * 0.15}
            maxPolarAngle={Math.PI * 0.45}
            enableDamping dampingFactor={0.08}
            target={[0, 0, 0]}
          />
          <CameraRig3D />
          <Suspense fallback={null}>
            <CityBackground />
            <Lighting />
            <HexPlatform />
            {ZONE_SPECS.map((spec) => <ZonePlatform key={spec.id} spec={spec} />)}
            <Workstations />
          </Suspense>
        </Canvas>
      </div>

      {/* ─── 衔接：底层基座的视觉过渡 ─── */}
      <div
        className="shrink-0"
        style={{
          height: 6,
          background: 'linear-gradient(180deg, rgba(15,15,14,0.18), rgba(15,15,14,0))',
        }}
      />

      {/* ─── L2 中层 · Agent OS ─── */}
      <PlatformStrip
        layerName="L2"
        title="Agent OS"
        tagline="任务调度 · 模型路由 · 权限策略 · A2A 委派 · 工具网关 · 风险审批"
        accent="#7E22CE"
        tiltDeg={14}
        items={[
          { icon: Shuffle,    label: '任务调度',  sub: '186 / 5min' },
          { icon: Cpu,        label: '模型路由',  sub: '5 模型' },
          { icon: NetIcon,    label: 'A2A 委派',  sub: '6 高管分身' },
          { icon: Wrench,     label: 'MCP 工具',  sub: '12 已连接' },
          { icon: Shield,     label: '审批策略',  sub: '四眼原则' },
          { icon: AlertCircle,label: '风险阻断',  sub: '2 高危' },
        ]}
      />

      {/* ─── L1 底层 · Data OS ─── */}
      <PlatformStrip
        layerName="L1"
        title="Data OS"
        tagline="企业知识图谱 · 业务数据 · 流程定义 · 权限身份 · 审计账本 · 凭证保险柜"
        accent="#0F766E"
        tiltDeg={22}
        items={[
          { icon: BookOpen,   label: '知识图谱',  sub: '9.6k 边' },
          { icon: Database,   label: '业务数据',  sub: 'CRM · ERP · BI' },
          { icon: GitBranch,  label: '流程',      sub: '24 SOP' },
          { icon: Users2,     label: '权限身份',  sub: 'RBAC + ABAC' },
          { icon: Activity,   label: '审计账本',  sub: 'Append-only' },
          { icon: Key,        label: '凭证保险柜',sub: '统一托管' },
        ]}
      />

      {/* 底部柔光 */}
      <div
        className="shrink-0 pointer-events-none"
        style={{
          height: 18,
          background: 'linear-gradient(180deg, rgba(15,15,14,0.05), rgba(15,15,14,0))',
        }}
      />
    </div>
  );
}

/* ─────────── Layer 3 label ─────────── */
function Layer3Label() {
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
        <div className="text-[11.5px] font-semibold tracking-wide text-primary-200">L3 · Agent Workforce</div>
        <div className="text-[10px] text-white/70">15 位数字员工 · 6 个分区 · 责任链可见</div>
      </div>
    </div>
  );
}

/* ─────────── Platform strip (Agent OS / Data OS) ─────────── */

interface StripItem { icon: any; label: string; sub: string; }

function PlatformStrip({
  layerName, title, tagline, accent, items, tiltDeg,
}: { layerName: string; title: string; tagline: string; accent: string; items: StripItem[]; tiltDeg: number }) {
  return (
    <div
      className="shrink-0 relative"
      style={{
        perspective: '1200px',
        height: tiltDeg > 18 ? 102 : 92,
      }}
    >
      <div
        className="absolute inset-0 px-3"
        style={{
          transform: `rotateX(${tiltDeg}deg) translateZ(-12px)`,
          transformOrigin: 'top center',
        }}
      >
        <div
          className="h-full rounded-lg flex items-center px-4 gap-3 relative overflow-hidden"
          style={{
            background: `linear-gradient(180deg, #FFFFFF, ${accent}08)`,
            border: `1px solid ${accent}33`,
            boxShadow: `0 4px 12px ${accent}1A, inset 0 1px 0 rgba(255,255,255,0.6)`,
          }}
        >
          {/* Subtle data lines (decorative) */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, ${accent}11, ${accent}11 1px, transparent 1px, transparent 40px)`,
              opacity: 0.6,
            }}
          />

          {/* Layer label */}
          <div className="shrink-0 relative z-10">
            <div className="flex items-center gap-1.5">
              <span
                className="text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded"
                style={{ background: accent, color: 'white' }}
              >
                {layerName}
              </span>
              <span className="text-[13px] font-semibold" style={{ color: accent }}>{title}</span>
            </div>
            <div className="text-[10.5px] hum-muted mt-0.5 hidden xl:block">{tagline}</div>
          </div>

          {/* Pills */}
          <div className="flex-1 flex items-center justify-end gap-2 relative z-10 overflow-x-auto">
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <div
                  key={it.label}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white shrink-0"
                  style={{ border: `1px solid ${accent}33` }}
                >
                  <Icon size={12} style={{ color: accent }} />
                  <div className="leading-tight">
                    <div className="text-[11px] font-medium text-neutral-900 whitespace-nowrap">{it.label}</div>
                    <div className="text-[9.5px] hum-faint font-mono whitespace-nowrap">{it.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
