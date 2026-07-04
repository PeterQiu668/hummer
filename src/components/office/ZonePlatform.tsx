import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Edges, Text, useCursor } from '@react-three/drei';
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
  round?: boolean; // 圆形玻璃舱（会议室）
}

/** 6 个分区配置 */
export const ZONE_SPECS: ZoneSpec[] = [
  { id: 'boss',     label: '决策中心',   sub: 'EXECUTIVE SUITE',   center: [9.5, -7.5], size: [7, 5.5], color: '#A855F7', elevation: 1.5, hasGlassWall: true, hasStairs: true },
  { id: 'business', label: '业务办公区', sub: 'OPEN OFFICE',       center: [0, -1],    size: [10.5, 6], color: '#3B82F6', elevation: 0.3 },
  { id: 'support',  label: '行政支持',   sub: 'SUPPORT CENTER',    center: [-9, -3],   size: [5.5, 5],  color: '#14B8A6', elevation: 0.4 },
  { id: 'meeting',  label: '会议舱',     sub: 'CONFERENCE HUB',    center: [6.5, 4],   size: [5, 5],   color: '#7E22CE', elevation: 0.5, round: true },
  { id: 'rest',     label: '休息区',     sub: 'RELAXATION LOUNGE', center: [9, 7.5],   size: [5, 4],   color: '#F59E0B', elevation: 0.35 },
  { id: 'learn',    label: '充电进化区', sub: 'EVOLUTION CENTER',  center: [-6, 5.5],  size: [7, 4.5], color: '#10B981', elevation: 0.4 },
];

/** 假玻璃：transmission 材质每帧触发背景拷贝渲染通道，换成透明 standard 材质（此相机距离下视觉等效） */
function glassMat(color: string) {
  return (
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
}

function GlassWall({ size, height, color }: { size: [number, number]; height: number; color: string }) {
  const [w, d] = size;
  return (
    <group>
      {/* 3 面玻璃围墙（前面留口） */}
      <mesh position={[0, height / 2, -d / 2]}>
        <boxGeometry args={[w, height, 0.05]} />
        {glassMat(color)}
      </mesh>
      <mesh position={[-w / 2, height / 2, 0]}>
        <boxGeometry args={[0.05, height, d]} />
        {glassMat(color)}
      </mesh>
      <mesh position={[w / 2, height / 2, 0]}>
        <boxGeometry args={[0.05, height, d]} />
        {glassMat(color)}
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

/* ─────────── 悬浮发光铭牌（始终面向相机） ─────────── */
function SignBoard({ zh, en, color, y }: { zh: string; en: string; color: string; y: number }) {
  const w = Math.max(en.length * 0.155, zh.length * 0.42) + 0.7;
  return (
    <Billboard position={[0, y, 0]}>
      <mesh>
        <boxGeometry args={[w, 0.86, 0.06]} />
        <meshStandardMaterial color="#0b1220" metalness={0.5} roughness={0.35} emissive={color} emissiveIntensity={0.12} />
        <Edges color={color} threshold={15} />
      </mesh>
      <Text position={[0, 0.18, 0.05]} fontSize={0.32} color="#E2E8F0" anchorX="center" anchorY="middle" outlineWidth={0.01} outlineColor="#0a0f1e">
        {zh}
      </Text>
      <Text position={[0, -0.24, 0.05]} fontSize={0.17} color={color} anchorX="center" anchorY="middle" letterSpacing={0.22}>
        {en}
      </Text>
    </Billboard>
  );
}

/* ─────────── 圆形玻璃会议舱（圆桌 + 全息中心 + 座椅环） ─────────── */
function ConferencePod({ spec, hovered }: { spec: ZoneSpec; hovered: boolean }) {
  const r = spec.size[0] / 2;
  const holo = useRef<THREE.Group>(null);
  const holoMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (holo.current) holo.current.rotation.y = t * 0.5;
    if (holoMat.current) holoMat.current.opacity = 0.4 + 0.15 * Math.sin(t * 1.6);
  });
  const glassR = r - 0.35;
  const seats = 8;

  return (
    <group position={[0, spec.elevation, 0]}>
      {/* 玻璃圆筒 */}
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[glassR, glassR, 2.2, 40, 1, true]} />
        {glassMat(spec.color)}
      </mesh>
      {/* 上下霓虹环 */}
      {[0.06, 2.2].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[glassR, 0.035, 8, 48]} />
          <meshBasicMaterial color={spec.color} transparent opacity={hovered ? 0.85 : 0.55} toneMapped={false} />
        </mesh>
      ))}
      {/* 圆桌 */}
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[1.05, 1.05, 0.07, 32]} />
        <meshStandardMaterial color="#1a2238" metalness={0.6} roughness={0.3} emissive={spec.color} emissiveIntensity={0.1} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.16, 0.28, 0.68, 12]} />
        <meshStandardMaterial color="#101830" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* 桌面全息投影 */}
      <group ref={holo} position={[0, 0.8, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.28, 0.42, 32]} />
          <meshBasicMaterial ref={holoMat} color={spec.color} transparent opacity={0.45} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <mesh rotation={[Math.PI / 3, 0, 0]}>
          <torusGeometry args={[0.3, 0.012, 6, 32]} />
          <meshBasicMaterial color="#38BDF8" transparent opacity={0.6} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.35, 0]}>
          <octahedronGeometry args={[0.12]} />
          <meshBasicMaterial color={spec.color} transparent opacity={0.8} toneMapped={false} wireframe />
        </mesh>
      </group>
      {/* 座椅环 */}
      {Array.from({ length: seats }).map((_, i) => {
        const a = (Math.PI * 2 * i) / seats;
        const sx = Math.cos(a) * 1.55;
        const sz = Math.sin(a) * 1.55;
        return (
          <group key={i} position={[sx, 0, sz]} rotation={[0, -a + Math.PI / 2, 0]}>
            <mesh position={[0, 0.28, 0]}>
              <boxGeometry args={[0.42, 0.09, 0.42]} />
              <meshStandardMaterial color="#1f2937" metalness={0.4} roughness={0.5} />
            </mesh>
            <mesh position={[0, 0.5, 0.19]}>
              <boxGeometry args={[0.42, 0.44, 0.07]} />
              <meshStandardMaterial color="#1f2937" metalness={0.4} roughness={0.5} />
            </mesh>
            <mesh position={[0, 0.12, 0]}>
              <cylinderGeometry args={[0.05, 0.09, 0.24, 8]} />
              <meshStandardMaterial color="#101318" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ─────────── 休息区道具：沙发组 + 电视墙 ─────────── */
function LoungeProps({ spec }: { spec: ZoneSpec }) {
  const e = spec.elevation;
  const tvMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (tvMat.current) tvMat.current.opacity = 0.65 + 0.15 * Math.sin(clock.elapsedTime * 2.3);
  });
  const sofa = (key: string, pos: [number, number, number], rotY: number, len: number) => (
    <group key={key} position={pos} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.24, 0]}>
        <boxGeometry args={[len, 0.34, 0.72]} />
        <meshStandardMaterial color="#26221c" metalness={0.2} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.52, -0.28]}>
        <boxGeometry args={[len, 0.42, 0.16]} />
        <meshStandardMaterial color="#26221c" metalness={0.2} roughness={0.7} />
      </mesh>
    </group>
  );
  return (
    <group position={[0, e, 0]}>
      {sofa('s1', [-0.4, 0, -0.9], 0, 2.4)}
      {sofa('s2', [-1.5, 0, 0.35], Math.PI / 2, 1.6)}
      {/* 茶几 */}
      <mesh position={[0.1, 0.2, 0.2]}>
        <cylinderGeometry args={[0.45, 0.45, 0.06, 20]} />
        <meshStandardMaterial color="#1a2238" metalness={0.5} roughness={0.35} emissive={spec.color} emissiveIntensity={0.12} />
      </mesh>
      {/* 电视墙 */}
      <group position={[1.9, 0, 0.3]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh position={[0, 0.95, 0]}>
          <boxGeometry args={[1.7, 1.0, 0.08]} />
          <meshStandardMaterial color="#0b0f18" metalness={0.5} roughness={0.3} />
          <Edges color={spec.color} threshold={15} />
        </mesh>
        <mesh position={[0, 0.95, 0.05]}>
          <planeGeometry args={[1.55, 0.85]} />
          <meshBasicMaterial ref={tvMat} color={spec.color} transparent opacity={0.7} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[0.1, 0.4, 0.1]} />
          <meshStandardMaterial color="#101318" />
        </mesh>
      </group>
    </group>
  );
}

/* ─────────── 充电进化区道具：发光充电桩 ×3 ─────────── */
function ChargerProps({ spec }: { spec: ZoneSpec }) {
  const e = spec.elevation;
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    mats.current.forEach((m, i) => {
      if (m) m.opacity = 0.35 + 0.2 * Math.sin(clock.elapsedTime * 1.4 + i * 2.0);
    });
  });
  return (
    <group position={[0, e, 0]}>
      {[-1.9, 0, 1.9].map((x, i) => (
        <group key={x} position={[x, 0, -1.1]}>
          {/* 充电地圈 */}
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.4, 0.56, 28]} />
            <meshBasicMaterial ref={(m) => { mats.current[i] = m; }} color={spec.color} transparent opacity={0.4} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
          {/* 能量柱 */}
          <mesh position={[0, 0.85, -0.55]}>
            <boxGeometry args={[0.3, 1.7, 0.18]} />
            <meshStandardMaterial color="#0d1a14" metalness={0.5} roughness={0.4} emissive={spec.color} emissiveIntensity={0.35} />
            <Edges color={spec.color} threshold={15} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ─────────── 决策中心道具：指挥数据墙 ─────────── */
function ExecWallProps({ spec }: { spec: ZoneSpec }) {
  const [w, d] = spec.size;
  const barMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    barMats.current.forEach((m, i) => {
      if (m) m.opacity = 0.5 + 0.25 * Math.sin(clock.elapsedTime * 1.1 + i * 0.9);
    });
  });
  const bars = [0.5, 0.8, 0.62, 0.95, 0.7];
  return (
    <group position={[0, spec.elevation, -d / 2 + 0.35]}>
      <mesh position={[0, 1.15, 0]}>
        <boxGeometry args={[w - 1.6, 1.5, 0.1]} />
        <meshStandardMaterial color="#0b0f1c" metalness={0.55} roughness={0.3} emissive={spec.color} emissiveIntensity={0.1} />
        <Edges color={spec.color} threshold={15} />
      </mesh>
      {/* 全息柱状图 */}
      {bars.map((h, i) => (
        <mesh key={i} position={[-1.5 + i * 0.75, 0.62 + (h * 0.9) / 2, 0.08]}>
          <planeGeometry args={[0.4, h * 0.9]} />
          <meshBasicMaterial ref={(m) => { barMats.current[i] = m; }} color={i === 3 ? '#38BDF8' : spec.color} transparent opacity={0.6} toneMapped={false} />
        </mesh>
      ))}
      <Text position={[0, 2.05, 0.08]} fontSize={0.16} color={spec.color} anchorX="center" anchorY="middle" letterSpacing={0.2}>
        KPI COMMAND WALL
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
    if (spec.round) return null;
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
  }, [w, d, spec.elevation, spec.round]);

  const pointerHandlers = {
    onPointerOver: (e: any) => { e.stopPropagation(); setHovered(true); },
    onPointerOut: () => setHovered(false),
    onClick: (e: any) => { e.stopPropagation(); setActiveZone(isActive ? null : spec.id); },
  };

  const platformMaterial = (
    <meshStandardMaterial
      ref={platformMat}
      color={isActive ? spec.color : '#101830'}
      roughness={0.5}
      metalness={0.45}
      emissive={spec.color}
      emissiveIntensity={isActive ? 0.35 : hovered ? 0.22 : 0.1}
    />
  );

  return (
    <group position={[cx, 0, cz]}>
      {/* 台面：圆形舱用圆柱台，其余用圆角矩形 */}
      {spec.round ? (
        <mesh position={[0, spec.elevation / 2, 0]} {...pointerHandlers}>
          <cylinderGeometry args={[w / 2, w / 2 + 0.15, spec.elevation, 40]} />
          {platformMaterial}
          <Edges color={spec.color} threshold={30} />
        </mesh>
      ) : (
        <mesh geometry={geometry!} position={[0, spec.elevation, 0]} {...pointerHandlers}>
          {platformMaterial}
          <Edges color={spec.color} threshold={15} />
        </mesh>
      )}

      {/* 玻璃围墙（矩形区） */}
      {spec.hasGlassWall && !spec.round && (
        <group position={[0, spec.elevation, 0]}>
          <GlassWall size={[w - 0.3, d - 0.3]} height={1.8} color={spec.color} />
        </group>
      )}

      {/* 圆形会议舱内容 */}
      {spec.round && <ConferencePod spec={spec} hovered={hovered || isActive} />}

      {/* 分区专属道具 */}
      {spec.id === 'rest' && <LoungeProps spec={spec} />}
      {spec.id === 'learn' && <ChargerProps spec={spec} />}
      {spec.id === 'boss' && <ExecWallProps spec={spec} />}

      {/* 楼梯 · executive */}
      {spec.hasStairs && (
        <Stairs from={[-w / 2 - 0.7, 0, 0]} to={[-w / 2 + 0.2, spec.elevation, 0]} />
      )}

      {/* 悬浮发光铭牌（双语，面向相机） */}
      <SignBoard zh={spec.label} en={spec.sub} color={spec.color} y={spec.elevation + (spec.round ? 3.1 : 2.1)} />

      {/* 地面光圈（呼吸） */}
      <mesh position={[0, spec.elevation + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.max(w, d) / 2 - 0.3, Math.max(w, d) / 2 - 0.1, 32]} />
        <meshBasicMaterial ref={ringMat} color={spec.color} transparent opacity={isActive ? 0.5 : 0.18} toneMapped={false} />
      </mesh>
    </group>
  );
}
