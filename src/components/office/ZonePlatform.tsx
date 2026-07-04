import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges, Text, useCursor } from '@react-three/drei';
import * as THREE from 'three';
import type { ZoneId } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';

export interface ZoneSpec {
  id: ZoneId;
  label: string;
  sub: string;
  center: [number, number]; // x,z
  size: [number, number]; // width,depth
  color: string;
  elevation: number;
  hasGlassWall?: boolean;
  hasStairs?: boolean;
}

/** 6 个分区配置 · 克制色 */
export const ZONE_SPECS: ZoneSpec[] = [
  { id: 'boss',     label: '决策中心',   sub: 'EXECUTIVE SUITE', center: [9.5, -7.5], size: [7, 5.5], color: '#A855F7', elevation: 1.5, hasGlassWall: true, hasStairs: true },
  { id: 'business', label: '业务办公区', sub: 'BUSINESS ZONE',   center: [0, -1],    size: [10.5, 6], color: '#3B82F6', elevation: 0.3 },
  { id: 'support',  label: '行政支持',   sub: 'SUPPORT CENTER',  center: [-9, -3],   size: [5.5, 5],  color: '#14B8A6', elevation: 0.4 },
  { id: 'meeting',  label: '会议室',     sub: 'MEETING HUB',     center: [6.5, 4],   size: [5.5, 4.5], color: '#7E22CE', elevation: 0.5, hasGlassWall: true },
  { id: 'rest',     label: '休息区',     sub: 'LOUNGE',          center: [9, 7.5],   size: [5, 4],   color: '#F59E0B', elevation: 0.35 },
  { id: 'learn',    label: '充电进化区', sub: 'EVOLUTION CHARGER', center: [-6, 5.5], size: [7, 4.5], color: '#10B981', elevation: 0.4 },
];

/** 假玻璃：transmission 材质每帧触发背景拷贝渲染通道，换成透明 standard 材质（此相机距离下视觉等效） */
function GlassWall({ size, height, color }: { size: [number, number]; height: number; color: string }) {
  const [w, d] = size;
  const mat = (
    <meshStandardMaterial
      color={color}
      transparent
      opacity={0.16}
      roughness={0.1}
      metalness={0.2}
      emissive={color}
      emissiveIntensity={0.08}
      side={THREE.DoubleSide}
      depthWrite={false}
    />
  );
  return (
    <group>
      {/* 3 面玻璃围墙（前面留口） */}
      <mesh position={[0, height / 2, -d / 2]}>
        <boxGeometry args={[w, height, 0.05]} />
        {mat}
      </mesh>
      <mesh position={[-w / 2, height / 2, 0]}>
        <boxGeometry args={[0.05, height, d]} />
        {mat}
      </mesh>
      <mesh position={[w / 2, height / 2, 0]}>
        <boxGeometry args={[0.05, height, d]} />
        {mat}
      </mesh>
    </group>
  );
}

function Stairs({ from, to, width = 1.4 }: { from: [number, number, number]; to: [number, number, number]; width?: number }) {
  const steps = 6;
  const items = [];
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;
    const z = from[2] + (to[2] - from[2]) * t;
    items.push(
      <mesh key={i} position={[x, y + 0.06, z]}>
        <boxGeometry args={[width, 0.12, 0.32]} />
        <meshStandardMaterial color="#1a2238" metalness={0.5} roughness={0.4} emissive="#3B82F6" emissiveIntensity={0.15} />
      </mesh>,
    );
  }
  return <>{items}</>;
}

export default function ZonePlatform({ spec }: { spec: ZoneSpec }) {
  const isActive = useAppStore((s) => s.activeZone === spec.id);
  const setActiveZone = useAppStore((s) => s.setActiveZone);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const [cx, cz] = spec.center;
  const [w, d] = spec.size;
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const platformMat = useRef<THREE.MeshStandardMaterial>(null);
  const zoneIndex = ZONE_SPECS.findIndex((s) => s.id === spec.id);

  // 分区光效呼吸（refs 直改，零重渲染）
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const base = isActive ? 0.5 : 0.18;
    if (ringMat.current) ringMat.current.opacity = base + 0.07 * Math.sin(t * 0.8 + zoneIndex * 1.1);
    if (platformMat.current) {
      const emBase = isActive ? 0.35 : hovered ? 0.22 : 0.1;
      platformMat.current.emissiveIntensity = emBase + 0.03 * Math.sin(t * 0.8 + zoneIndex * 1.1);
    }
  });

  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const r = 0.4; // 圆角
    shape.moveTo(-w / 2 + r, -d / 2);
    shape.lineTo(w / 2 - r, -d / 2);
    shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    shape.lineTo(w / 2, d / 2 - r);
    shape.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
    shape.lineTo(-w / 2 + r, d / 2);
    shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
    shape.lineTo(-w / 2, -d / 2 + r);
    shape.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: spec.elevation,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 1,
    });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [w, d, spec.elevation]);

  return (
    <group position={[cx, 0, cz]}>
      <mesh
        geometry={geometry}
        position={[0, spec.elevation, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          setActiveZone(isActive ? null : spec.id);
        }}
      >
        <meshStandardMaterial
          ref={platformMat}
          color={isActive ? spec.color : '#101830'}
          roughness={0.5}
          metalness={0.45}
          emissive={spec.color}
          emissiveIntensity={isActive ? 0.35 : hovered ? 0.22 : 0.1}
        />
        <Edges color={spec.color} threshold={15} />
      </mesh>

      {/* 玻璃围墙 */}
      {spec.hasGlassWall && (
        <group position={[0, spec.elevation, 0]}>
          <GlassWall size={[w - 0.3, d - 0.3]} height={1.8} color={spec.color} />
        </group>
      )}

      {/* 楼梯 · executive */}
      {spec.hasStairs && (
        <Stairs from={[-w / 2 - 0.7, 0, 0]} to={[-w / 2 + 0.2, spec.elevation, 0]} />
      )}

      {/* 中文 label · 浮在上方 */}
      <Text
        position={[0, spec.elevation + 1.4, 0]}
        fontSize={0.42}
        color={spec.color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.012}
        outlineColor="#0a0f1e"
      >
        {spec.label}
      </Text>
      <Text
        position={[0, spec.elevation + 0.95, 0]}
        fontSize={0.18}
        color="#94a3b8"
        anchorX="center"
        anchorY="middle"
      >
        {spec.sub}
      </Text>

      {/* 地面光圈（呼吸） */}
      <mesh position={[0, spec.elevation + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.max(w, d) / 2 - 0.3, Math.max(w, d) / 2 - 0.1, 32]} />
        <meshBasicMaterial ref={ringMat} color={spec.color} transparent opacity={isActive ? 0.5 : 0.18} toneMapped={false} />
      </mesh>
    </group>
  );
}
