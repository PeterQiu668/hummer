/**
 * ZoneArea v13 · SYBERNETIC HQ 1:1 分区
 * boss=高管夹层 / business=Section A / support=Section B 平台 /
 * meeting=会议舱 / rest=休闲露台 / learn=健身角
 * 每区：结构件（sceneStructures）+ 地面霓虹框线 + 地面蚀刻文字 + 可点击拾取面
 */
import { useState } from 'react';
import { useCursor } from '@react-three/drei';
import type { ZoneId } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { NEON, NeonRectOutline, FloorText } from './neon';
import { SectionBPlatform, ExecMezzanine, ConferenceShell, LoungeTerrace, GymCorner } from './sceneStructures';
import { useAutoShadows } from './useAutoShadows';

export interface ZoneSpec {
  id: ZoneId;
  label: string;
  sub: string;
  center: [number, number]; // x,z
  size: [number, number]; // width,depth
  color: string;
  elevation: number;
}

/** 6 个分区 · 参考图坐标 */
export const ZONE_SPECS: ZoneSpec[] = [
  { id: 'boss',     label: '决策中心',   sub: 'EXECUTIVE SUITE / B3',      center: [11.5, -9],   size: [10, 7],    color: NEON,      elevation: 2.7 },
  { id: 'business', label: '业务办公区', sub: 'PUBLIC OFFICE SECTION A',   center: [-9.5, -2],   size: [14, 9],    color: NEON,      elevation: 0 },
  { id: 'support',  label: '行政支持',   sub: 'PUBLIC OFFICE SECTION B',   center: [-1, -8.5],   size: [13, 7],    color: NEON,      elevation: 0.3 },
  { id: 'meeting',  label: '会议舱',     sub: 'CONFERENCE HUB',            center: [3.5, 3.5],   size: [8.6, 8.6], color: NEON,      elevation: 0.45 },
  { id: 'rest',     label: '休息区',     sub: 'RELAXATION LOUNGE',         center: [12.5, 2.5],  size: [8.5, 7.5], color: '#58E6D9', elevation: 0.35 },
  { id: 'learn',    label: '充电进化区', sub: 'EVOLUTION GYM',             center: [-13.5, 8.5], size: [6.5, 4.5], color: '#46C68A', elevation: -1.35 },
];

export default function ZonePlatform({ spec }: { spec: ZoneSpec }) {
  const setActiveZone = useAppStore((s) => s.setActiveZone);
  const isActive = useAppStore((s) => s.activeZone === spec.id);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const rootRef = useAutoShadows();
  const [cx, cz] = spec.center;
  const [w, d] = spec.size;

  return (
    <group ref={rootRef}>
      {/* 结构件 */}
      {spec.id === 'business' && (
        <group position={[cx, 0.002, cz]}>
          <NeonRectOutline w={14} d={9} r={1.2} opacity={isActive ? 1 : 0.55} />
          <FloorText text="PUBLIC OFFICE SECTION A" size={0.42} position={[-1.5, 0.004, 4.2]} rotation={[0, -0.18, 0]} opacity={0.75} />
          <FloorText text="A-1" size={0.7} position={[-4.2, 0.004, 2.2]} />
          <FloorText text="A-2" size={0.7} position={[1.8, 0.004, -0.6]} />
        </group>
      )}
      {spec.id === 'support' && (
        <>
          <SectionBPlatform />
          <group position={[cx, 0.312, cz]}>
            <NeonRectOutline w={11.6} d={5.8} r={0.9} opacity={isActive ? 1 : 0.5} />
            <FloorText text="PUBLIC OFFICE SECTION B" size={0.36} position={[-0.5, 0.004, 2.9]} opacity={0.75} />
            <FloorText text="B-1" size={0.62} position={[-4.5, 0.004, 1.9]} />
            <FloorText text="B-2" size={0.62} position={[1.5, 0.004, 2.2]} />
          </group>
        </>
      )}
      {spec.id === 'boss' && <ExecMezzanine />}
      {spec.id === 'meeting' && <ConferenceShell />}
      {spec.id === 'rest' && <LoungeTerrace />}
      {spec.id === 'learn' && <GymCorner />}

      {/* 分区拾取面（不可见） */}
      <mesh
        position={[cx, spec.elevation + 0.05, cz]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => { e.stopPropagation(); setActiveZone(isActive ? null : spec.id); }}
      >
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
