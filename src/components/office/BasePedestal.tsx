import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges, Text, useCursor } from '@react-three/drei';
import * as THREE from 'three';

export type BaseLayerId = 'agentos' | 'dataos';

interface TierSpec {
  id: BaseLayerId;
  title: string;
  zh: string;
  color: string;
  radius: number;
  height: number;
  yTop: number; // 顶面世界 y
}

/** 架构基座两层：Agent Workforce（上层场景）之下是 Agent OS 与 Data OS */
const TIERS: TierSpec[] = [
  { id: 'agentos', title: 'AGENT OS', zh: '智能体操作系统 · 调度 / 路由 / 审批 / MCP', color: '#A855F7', radius: 15.2, height: 2.2, yTop: -0.42 },
  { id: 'dataos',  title: 'DATA OS',  zh: '数据操作系统 · 知识 / 数据 / 审计 / 凭证',   color: '#14B8A6', radius: 16.8, height: 2.4, yTop: -2.66 },
];

function hexGeometry(radius: number, height: number) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.06,
    bevelSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** 单层基座：正面 3 个朝向刻发光层名，悬停增亮，点击展开模块面板 */
function Tier({ spec, active, onSelect }: { spec: TierSpec; active: boolean; onSelect: (id: BaseLayerId) => void }) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const seamRef = useRef<THREE.MeshBasicMaterial>(null);
  const geometry = useMemo(() => hexGeometry(spec.radius, spec.height), [spec.radius, spec.height]);
  const yBottom = spec.yTop - spec.height;
  const yCenter = spec.yTop - spec.height / 2;
  const facetDist = spec.radius * Math.cos(Math.PI / 6) + 0.1;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (matRef.current) {
      const base = active ? 0.4 : hovered ? 0.26 : 0.12;
      matRef.current.emissiveIntensity = base + 0.03 * Math.sin(t * 0.7 + (spec.id === 'agentos' ? 0 : 1.7));
    }
    if (seamRef.current) seamRef.current.opacity = 0.5 + 0.18 * Math.sin(t * 0.9 + (spec.id === 'agentos' ? 0 : 2.2));
  });

  // 正面 + 左右前侧三个立面都刻字，旋转视角时始终可读
  const facets: { rotY: number }[] = [{ rotY: 0 }, { rotY: Math.PI / 3 }, { rotY: -Math.PI / 3 }];

  return (
    <group>
      <mesh
        geometry={geometry}
        position={[0, yBottom, 0]}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => { e.stopPropagation(); onSelect(spec.id); }}
      >
        <meshStandardMaterial
          ref={matRef}
          color="#0c1424"
          roughness={0.55}
          metalness={0.5}
          emissive={spec.color}
          emissiveIntensity={0.12}
        />
        <Edges color={spec.color} threshold={15} />
      </mesh>

      {/* 层间霓虹接缝 */}
      <mesh position={[0, spec.yTop + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[spec.radius - 0.55, spec.radius - 0.2, 6, 1, Math.PI / 6]} />
        <meshBasicMaterial ref={seamRef} color={spec.color} transparent opacity={0.5} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* 立面发光层名 ×3 朝向 */}
      {facets.map(({ rotY }, i) => {
        const nx = Math.sin(rotY);
        const nz = Math.cos(rotY);
        return (
          <group key={i} position={[nx * facetDist, yCenter, nz * facetDist]} rotation={[0, rotY, 0]}>
            <Text fontSize={spec.height * 0.42} color={spec.color} anchorX="center" anchorY="middle" outlineWidth={0.02} outlineColor="#050810" letterSpacing={0.16}>
              {spec.title}
            </Text>
            <Text position={[0, -spec.height * 0.33, 0]} fontSize={spec.height * 0.13} color="#94a3b8" anchorX="center" anchorY="middle">
              {spec.zh}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

export default function BasePedestal({ activeLayer, onSelect }: {
  activeLayer: BaseLayerId | null;
  onSelect: (id: BaseLayerId) => void;
}) {
  const glowRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (glowRef.current) glowRef.current.opacity = 0.12 + 0.05 * Math.sin(clock.elapsedTime * 0.6);
  });
  const bottomY = TIERS[1].yTop - TIERS[1].height;

  return (
    <group>
      {TIERS.map((t) => (
        <Tier key={t.id} spec={t} active={activeLayer === t.id} onSelect={onSelect} />
      ))}
      {/* 基座底部光晕 */}
      <mesh position={[0, bottomY - 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[TIERS[1].radius + 2.5, 48]} />
        <meshBasicMaterial ref={glowRef} color="#14B8A6" transparent opacity={0.12} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ─────────── HUMMER HQ 主铭牌（场景后方） ─────────── */
export function HQSign() {
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.opacity = 0.55 + 0.15 * Math.sin(clock.elapsedTime * 1.1);
  });
  return (
    <group position={[-10.5, 5.6, -11.5]} rotation={[0, Math.PI / 5, 0]}>
      {/* 牌身 */}
      <mesh>
        <boxGeometry args={[7.4, 2.3, 0.22]} />
        <meshStandardMaterial color="#0b1220" metalness={0.55} roughness={0.35} emissive="#0F70B7" emissiveIntensity={0.14} />
        <Edges color="#38BDF8" threshold={15} />
      </mesh>
      {/* 底部霓虹条 */}
      <mesh position={[0, -1.02, 0.13]}>
        <planeGeometry args={[7.0, 0.07]} />
        <meshBasicMaterial ref={glow} color="#38BDF8" transparent opacity={0.6} toneMapped={false} />
      </mesh>
      <Text position={[0, 0.34, 0.14]} fontSize={0.88} color="#E0F2FE" anchorX="center" anchorY="middle" letterSpacing={0.14} outlineWidth={0.02} outlineColor="#0F70B7">
        HUMMER HQ
      </Text>
      <Text position={[0, -0.52, 0.14]} fontSize={0.3} color="#38BDF8" anchorX="center" anchorY="middle" letterSpacing={0.3}>
        AGENT WORKFORCE · AI WORKFLOW
      </Text>
      {/* 支撑柱 ×2 */}
      {[-2.6, 2.6].map((x) => (
        <mesh key={x} position={[x, -3.0, 0]}>
          <boxGeometry args={[0.18, 4.0, 0.18]} />
          <meshStandardMaterial color="#101830" metalness={0.5} roughness={0.4} emissive="#0F70B7" emissiveIntensity={0.2} />
        </mesh>
      ))}
    </group>
  );
}
