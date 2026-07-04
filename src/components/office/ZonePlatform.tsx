/**
 * ZoneArea v10 · 真实现代办公室分区
 * 悬浮荧光平台 → 落地办公区域：地毯区块 + 金属包边 + 玻璃隔断房（老板间/会议室）
 * + 矮门牌。区域色只出现在包边缝光与门牌上（低饱和），不再整块发光。
 */
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, useCursor } from '@react-three/drei';
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

/** 6 个分区 · 低饱和现代配色 */
export const ZONE_SPECS: ZoneSpec[] = [
  { id: 'boss',     label: '决策中心',   sub: 'EXECUTIVE SUITE',   center: [9.5, -7.5], size: [7, 5.5],   color: '#C9A464', elevation: 0.22, hasGlassWall: true, hasStairs: true },
  { id: 'business', label: '业务办公区', sub: 'BUSINESS ZONE',     center: [0, -1],     size: [10.5, 6],  color: '#5B94E8', elevation: 0.04 },
  { id: 'support',  label: '行政支持',   sub: 'SUPPORT CENTER',    center: [-9, -3],    size: [5.5, 5],   color: '#3FB8AB', elevation: 0.04 },
  { id: 'meeting',  label: '会议室',     sub: 'MEETING HUB',       center: [6.5, 4],    size: [5.5, 4.5], color: '#B07CF0', elevation: 0.04, hasGlassWall: true },
  { id: 'rest',     label: '休息区',     sub: 'LOUNGE',            center: [9, 7.5],    size: [5, 4],     color: '#E8A33D', elevation: 0.04 },
  { id: 'learn',    label: '充电进化区', sub: 'EVOLUTION CHARGER', center: [-6, 5.5],   size: [7, 4.5],   color: '#46C68A', elevation: 0.04 },
];

const GLASS_H = 2.5;
const FRAME_COLOR = '#3A4252';

/** 玻璃隔断房：金属立柱 + 竖梃 + 淡色玻璃，正面（+z）留门口 */
function GlassRoom({ size }: { size: [number, number] }) {
  const [w, d] = size;
  const posts = useMemo(() => {
    const arr: [number, number][] = [];
    // 背墙竖梃
    const nBack = Math.max(2, Math.round(w / 2.2));
    for (let i = 0; i <= nBack; i++) arr.push([-w / 2 + (w / nBack) * i, -d / 2]);
    // 侧墙竖梃
    const nSide = Math.max(2, Math.round(d / 2.2));
    for (let i = 1; i < nSide; i++) {
      arr.push([-w / 2, -d / 2 + (d / nSide) * i]);
      arr.push([w / 2, -d / 2 + (d / nSide) * i]);
    }
    arr.push([-w / 2, d / 2], [w / 2, d / 2]);
    return arr;
  }, [w, d]);

  const glassMat = (
    <meshStandardMaterial
      color="#A8C4E0"
      transparent
      opacity={0.08}
      roughness={0.08}
      metalness={0.1}
      side={THREE.DoubleSide}
      depthWrite={false}
    />
  );

  return (
    <group>
      {/* 玻璃面 · 背 + 两侧 */}
      <mesh position={[0, GLASS_H / 2, -d / 2]}>
        <boxGeometry args={[w, GLASS_H, 0.03]} />
        {glassMat}
      </mesh>
      <mesh position={[-w / 2, GLASS_H / 2, 0]}>
        <boxGeometry args={[0.03, GLASS_H, d]} />
        {glassMat}
      </mesh>
      <mesh position={[w / 2, GLASS_H / 2, 0]}>
        <boxGeometry args={[0.03, GLASS_H, d]} />
        {glassMat}
      </mesh>
      {/* 竖梃 */}
      {posts.map(([px, pz], i) => (
        <mesh key={i} position={[px, GLASS_H / 2, pz]}>
          <boxGeometry args={[0.06, GLASS_H, 0.06]} />
          <meshStandardMaterial color={FRAME_COLOR} metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      {/* 顶梁（三面） */}
      <mesh position={[0, GLASS_H, -d / 2]}>
        <boxGeometry args={[w + 0.08, 0.08, 0.1]} />
        <meshStandardMaterial color={FRAME_COLOR} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[-w / 2, GLASS_H, 0]}>
        <boxGeometry args={[0.1, 0.08, d]} />
        <meshStandardMaterial color={FRAME_COLOR} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[w / 2, GLASS_H, 0]}>
        <boxGeometry args={[0.1, 0.08, d]} />
        <meshStandardMaterial color={FRAME_COLOR} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* 门口缝光（正面两根短柱） */}
      <mesh position={[-w / 2 + 0.02, GLASS_H / 2, d / 2]}>
        <boxGeometry args={[0.06, GLASS_H, 0.06]} />
        <meshStandardMaterial color={FRAME_COLOR} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[w / 2 - 0.02, GLASS_H / 2, d / 2]}>
        <boxGeometry args={[0.06, GLASS_H, 0.06]} />
        <meshStandardMaterial color={FRAME_COLOR} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* 侧墙玻璃接到门口 */}
      <mesh position={[-w / 2, GLASS_H / 2, d / 2 - 0.01]}>
        <boxGeometry args={[0.03, GLASS_H, 0.02]} />
        {glassMat}
      </mesh>
      <mesh position={[w / 2, GLASS_H / 2, d / 2 - 0.01]}>
        <boxGeometry args={[0.03, GLASS_H, 0.02]} />
        {glassMat}
      </mesh>
    </group>
  );
}

/** 台阶（决策中心抬高甲板） */
function Steps({ width, elevation, z }: { width: number; elevation: number; z: number }) {
  const steps = 2;
  return (
    <>
      {Array.from({ length: steps }, (_, i) => {
        const h = (elevation * (i + 1)) / (steps + 1);
        return (
          <mesh key={i} position={[0, h / 2, z + (steps - i) * 0.34]}>
            <boxGeometry args={[width, h, 0.32]} />
            <meshStandardMaterial color="#262C38" metalness={0.3} roughness={0.6} />
          </mesh>
        );
      })}
    </>
  );
}

/** 矮门牌：立柱 + 铭牌（替代悬浮大字） */
function ZoneSign({ spec }: { spec: ZoneSpec }) {
  const [w, d] = spec.size;
  return (
    <group position={[-w / 2 + 1.15, spec.elevation, -d / 2 + 0.35]}>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[0.05, 1.1, 0.05]} />
        <meshStandardMaterial color={FRAME_COLOR} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.22, 0]}>
        <boxGeometry args={[1.9, 0.56, 0.05]} />
        <meshStandardMaterial color="#161C28" metalness={0.4} roughness={0.4} />
      </mesh>
      {/* 铭牌accent缝光 */}
      <mesh position={[0, 0.97, 0.005]}>
        <boxGeometry args={[1.9, 0.03, 0.05]} />
        <meshBasicMaterial color={spec.color} toneMapped={false} />
      </mesh>
      <Text position={[0, 1.3, 0.04]} fontSize={0.26} color="#E7ECF5" anchorX="center" anchorY="middle">
        {spec.label}
      </Text>
      <Text position={[0, 1.06, 0.04]} fontSize={0.1} color="#7C8AA0" anchorX="center" anchorY="middle" letterSpacing={0.12}>
        {spec.sub}
      </Text>
    </group>
  );
}

export default function ZonePlatform({ spec }: { spec: ZoneSpec }) {
  const isActive = useAppStore((s) => s.activeZone === spec.id);
  const setActiveZone = useAppStore((s) => s.setActiveZone);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const [cx, cz] = spec.center;
  const [w, d] = spec.size;
  const trimMat = useRef<THREE.MeshBasicMaterial>(null);
  const zoneIndex = ZONE_SPECS.findIndex((s) => s.id === spec.id);

  // 地毯区块（圆角）
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const r = 0.35;
    shape.moveTo(-w / 2 + r, -d / 2);
    shape.lineTo(w / 2 - r, -d / 2);
    shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    shape.lineTo(w / 2, d / 2 - r);
    shape.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
    shape.lineTo(-w / 2 + r, d / 2);
    shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
    shape.lineTo(-w / 2, -d / 2 + r);
    shape.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
    const g = new THREE.ExtrudeGeometry(shape, { depth: spec.elevation, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [w, d, spec.elevation]);

  // 包边缝光呼吸（refs 直改）
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (trimMat.current) {
      const base = isActive ? 0.55 : hovered ? 0.35 : 0.16;
      trimMat.current.opacity = base + 0.05 * Math.sin(t * 0.8 + zoneIndex * 1.1);
    }
  });

  return (
    <group position={[cx, 0, cz]}>
      {/* 包边缝光（区域色的唯一大面积表达） */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w + 0.16, d + 0.16]} />
        <meshBasicMaterial ref={trimMat} color={spec.color} transparent opacity={0.16} toneMapped={false} />
      </mesh>

      {/* 地毯区块 */}
      <mesh
        geometry={geometry}
        position={[0, spec.elevation, 0]}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => { e.stopPropagation(); setActiveZone(isActive ? null : spec.id); }}
      >
        <meshStandardMaterial
          color={isActive ? '#3A4459' : '#323B4E'}
          roughness={0.85}
          metalness={0.05}
          emissive={spec.color}
          emissiveIntensity={isActive ? 0.07 : 0.02}
        />
      </mesh>

      {/* 玻璃隔断房（老板间 / 会议室） */}
      {spec.hasGlassWall && (
        <group position={[0, spec.elevation, 0]}>
          <GlassRoom size={[w - 0.25, d - 0.25]} />
        </group>
      )}

      {/* 决策中心台阶 */}
      {spec.hasStairs && <Steps width={2.2} elevation={spec.elevation} z={d / 2} />}

      {/* 门牌 */}
      <ZoneSign spec={spec} />
    </group>
  );
}
