/**
 * OfficeShell · Agent Workforce 顶层办公室外壳（参考图形态）
 * - 矩形倒角办公楼板（= Agentrix 堆叠的顶层平台，正面刻 AGENT WORKFORCE）
 * - L 形玻璃幕墙（后 + 左）+ 发光窗棂，城市夜景透出
 * - HUMMER HQ 主墙牌 + AI WORKFLOW 悬牌 + AI EMPOWERING ENTERPRISE 立方标
 * - 地面走道霓虹线 + 分区地面铭文（OPEN OFFICE / SECTION A/B）
 * - 健身角（跑步机 + 哑铃架）+ 绿植盆栽
 */
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges, Instance, Instances, Text, useCursor } from '@react-three/drei';
import * as THREE from 'three';
import type { ArchLayerId } from '../../data/archLayers';
import { STACK, roundedRectGeometry, LayerFrontLabel } from './ArchBase';

const F = STACK.floor;
const WALL_H = 7.4;

/* ─────────── 办公楼板（顶层平台 · 可点击聚焦 Workforce 层） ─────────── */
function FloorSlab({ focusLayer, onSelectLayer }: {
  focusLayer: ArchLayerId | null;
  onSelectLayer: (id: ArchLayerId) => void;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const geometry = useMemo(() => roundedRectGeometry(F.w, F.d, F.h, 1.2), []);

  useFrame(({ clock }) => {
    const m = matRef.current;
    if (!m) return;
    const dimmed = focusLayer !== null && focusLayer !== 'workforce';
    m.opacity += ((dimmed ? 0.2 : 1) - m.opacity) * 0.12;
    const base = focusLayer === 'workforce' ? 0.3 : hovered ? 0.18 : 0.08;
    m.emissiveIntensity = base + 0.02 * Math.sin(clock.elapsedTime * 0.7);
  });

  return (
    <mesh
      geometry={geometry}
      position={[0, F.topY - F.h, 0]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); onSelectLayer('workforce'); }}
    >
      <meshStandardMaterial
        ref={matRef}
        color="#131b30"
        roughness={0.55}
        metalness={0.45}
        emissive="#3B82F6"
        emissiveIntensity={0.08}
        transparent
      />
      <Edges color="#3B82F6" threshold={15} />
    </mesh>
  );
}

/* ─────────── L 形玻璃幕墙（后墙 + 左墙）· 城市夜景透出 ─────────── */
function CurtainWall({ length, position, rotationY }: {
  length: number; position: [number, number, number]; rotationY: number;
}) {
  const mullions = useMemo(() => {
    const xs: number[] = [];
    const step = 2.9;
    for (let x = -length / 2; x <= length / 2 + 0.01; x += step) xs.push(x);
    return xs;
  }, [length]);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 玻璃 */}
      <mesh position={[0, WALL_H / 2, 0]}>
        <planeGeometry args={[length, WALL_H]} />
        <meshStandardMaterial
          color="#0f2036" transparent opacity={0.22} roughness={0.1} metalness={0.3}
          emissive="#0f2036" emissiveIntensity={0.15} side={THREE.DoubleSide} depthWrite={false}
        />
      </mesh>
      {/* 窗棂（实例化） */}
      <Instances limit={mullions.length}>
        <boxGeometry args={[0.14, WALL_H, 0.14]} />
        <meshStandardMaterial color="#101a30" metalness={0.6} roughness={0.35} emissive="#1d4ed8" emissiveIntensity={0.25} />
        {mullions.map((x) => <Instance key={x} position={[x, WALL_H / 2, 0]} />)}
      </Instances>
      {/* 横梁 ×2 + 底裙 */}
      {[WALL_H * 0.62, WALL_H].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[length, 0.18, 0.18]} />
          <meshStandardMaterial color="#101a30" metalness={0.6} roughness={0.35} emissive="#1d4ed8" emissiveIntensity={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[length, 0.6, 0.22]} />
        <meshStandardMaterial color="#0b1220" metalness={0.5} roughness={0.4} emissive="#1d4ed8" emissiveIntensity={0.12} />
      </mesh>
    </group>
  );
}

/* ─────────── 墙牌（HUMMER HQ 主牌 / AI WORKFLOW 悬牌） ─────────── */
function WallSign({ position, w, h, title, sub, color, titleSize = 0.9 }: {
  position: [number, number, number]; w: number; h: number;
  title: string; sub?: string; color: string; titleSize?: number;
}) {
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.opacity = 0.5 + 0.18 * Math.sin(clock.elapsedTime * 1.1 + position[0]);
  });
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[w, h, 0.22]} />
        <meshStandardMaterial color="#0b1220" metalness={0.55} roughness={0.35} emissive={color} emissiveIntensity={0.14} />
        <Edges color={color} threshold={15} />
      </mesh>
      <mesh position={[0, -h / 2 + 0.1, 0.13]}>
        <planeGeometry args={[w - 0.4, 0.07]} />
        <meshBasicMaterial ref={glow} color={color} transparent opacity={0.6} toneMapped={false} />
      </mesh>
      <Text position={[0, sub ? h * 0.14 : 0, 0.14]} fontSize={titleSize} color="#E0F2FE" anchorX="center" anchorY="middle" letterSpacing={0.14} outlineWidth={0.02} outlineColor={color}>
        {title}
      </Text>
      {sub && (
        <Text position={[0, -h * 0.26, 0.14]} fontSize={titleSize * 0.32} color={color} anchorX="center" anchorY="middle" letterSpacing={0.3}>
          {sub}
        </Text>
      )}
    </group>
  );
}

/* ─────────── AI EMPOWERING ENTERPRISE 发光立方标（参考图右下角） ─────────── */
function AiPlaque() {
  const faceMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (faceMat.current) faceMat.current.opacity = 0.75 + 0.15 * Math.sin(clock.elapsedTime * 1.6);
  });
  return (
    <group position={[16.6, 0, 12.6]} rotation={[0, -Math.PI / 5, 0]}>
      <mesh position={[0, 1.35, 0]}>
        <boxGeometry args={[2.9, 2.7, 0.5]} />
        <meshStandardMaterial color="#0b1220" metalness={0.55} roughness={0.35} emissive="#38BDF8" emissiveIntensity={0.12} />
        <Edges color="#38BDF8" threshold={15} />
      </mesh>
      <mesh position={[0, 1.7, 0.26]}>
        <planeGeometry args={[2.3, 1.35]} />
        <meshBasicMaterial ref={faceMat} color="#0ea5e9" transparent opacity={0.8} toneMapped={false} />
      </mesh>
      <Text position={[0, 1.72, 0.28]} fontSize={0.92} color="#03131f" anchorX="center" anchorY="middle" letterSpacing={0.05}>
        AI
      </Text>
      <Text position={[0, 0.62, 0.28]} fontSize={0.21} color="#7DD3FC" anchorX="center" anchorY="middle" letterSpacing={0.18}>
        EMPOWERING ENTERPRISE
      </Text>
    </group>
  );
}

/* ─────────── 地面走道霓虹线 + 分区地面铭文 ─────────── */
function FloorMarkings() {
  const laneMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (laneMat.current) laneMat.current.opacity = 0.4 + 0.12 * Math.sin(clock.elapsedTime * 1.2);
  });
  const y = F.topY + 0.015;
  const flat: [number, number, number] = [-Math.PI / 2, 0, 0];

  return (
    <group>
      {/* 主走道（横贯 z≈1.6）：路面微光 + 双边线 */}
      <mesh position={[0, y, 1.6]} rotation={flat}>
        <planeGeometry args={[35, 1.9]} />
        <meshBasicMaterial color="#3B82F6" transparent opacity={0.05} toneMapped={false} depthWrite={false} />
      </mesh>
      {[0.62, -0.62].map((dz) => (
        <mesh key={dz} position={[0, y + 0.002, 1.6 + dz * 1.9]} rotation={flat}>
          <planeGeometry args={[35, 0.09]} />
          <meshBasicMaterial ref={dz > 0 ? laneMat : undefined} color="#38BDF8" transparent opacity={0.4} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
      {/* 走道铭文 */}
      <Text position={[-4.5, y + 0.004, 1.62]} rotation={flat} fontSize={0.72} color="#7DD3FC" anchorX="center" anchorY="middle" letterSpacing={0.34} fillOpacity={0.65}>
        OPEN OFFICE
      </Text>
      {/* 分区地面铭文（贴地，参考图分区描字） */}
      <Text position={[-14.5, y + 0.004, -1.2]} rotation={flat} fontSize={0.44} color="#5EEAD4" anchorX="center" anchorY="middle" letterSpacing={0.22} fillOpacity={0.55}>
        PUBLIC OFFICE SECTION A
      </Text>
      <Text position={[-2, y + 0.004, -0.8]} rotation={flat} fontSize={0.44} color="#93C5FD" anchorX="center" anchorY="middle" letterSpacing={0.22} fillOpacity={0.55}>
        PUBLIC OFFICE SECTION B
      </Text>
      <Text position={[7, y + 0.004, 9.6]} rotation={flat} fontSize={0.4} color="#C4B5FD" anchorX="center" anchorY="middle" letterSpacing={0.22} fillOpacity={0.5}>
        CONFERENCE HUB
      </Text>
      {/* 会议舱支路 */}
      <mesh position={[7, y, 3.1]} rotation={flat}>
        <planeGeometry args={[1.3, 2.4]} />
        <meshBasicMaterial color="#7E22CE" transparent opacity={0.08} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ─────────── 绿植盆栽 ─────────── */
function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.26, 0.34, 0.44, 10]} />
        <meshStandardMaterial color="#e7e2d8" roughness={0.7} />
      </mesh>
      {[0, 1.1, 2.2, 3.4, 4.6].map((a) => (
        <mesh key={a} position={[Math.cos(a) * 0.12, 0.78, Math.sin(a) * 0.12]} rotation={[Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4]}>
          <coneGeometry args={[0.13, 0.85, 6]} />
          <meshStandardMaterial color="#166534" roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/* ─────────── 健身角（跑步机 + 哑铃架，参考图左下） ─────────── */
function GymCorner() {
  const beltMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (beltMat.current) beltMat.current.opacity = 0.25 + 0.1 * Math.sin(clock.elapsedTime * 3.2);
  });
  return (
    <group position={[-16.8, F.topY, 12.2]} rotation={[0, Math.PI / 7, 0]}>
      {/* 跑步机 */}
      <group>
        <mesh position={[0, 0.12, 0]}>
          <boxGeometry args={[0.85, 0.16, 2.0]} />
          <meshStandardMaterial color="#15171d" metalness={0.4} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.21, 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.6, 1.6]} />
          <meshBasicMaterial ref={beltMat} color="#38BDF8" transparent opacity={0.3} toneMapped={false} />
        </mesh>
        {[-0.32, 0.32].map((x) => (
          <mesh key={x} position={[x, 0.7, -0.82]} rotation={[0.25, 0, 0]}>
            <boxGeometry args={[0.06, 1.15, 0.06]} />
            <meshStandardMaterial color="#22262e" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[0, 1.28, -0.95]}>
          <boxGeometry args={[0.78, 0.34, 0.08]} />
          <meshStandardMaterial color="#0b0f18" emissive="#38BDF8" emissiveIntensity={0.5} />
        </mesh>
      </group>
      {/* 哑铃架 */}
      <group position={[1.7, 0, 0.3]} rotation={[0, -0.3, 0]}>
        {[-0.55, 0.55].map((x) => (
          <mesh key={x} position={[x, 0.42, 0]}>
            <boxGeometry args={[0.08, 0.84, 0.5]} />
            <meshStandardMaterial color="#22262e" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        {[0.3, 0.66].map((yy) => (
          <group key={yy}>
            <mesh position={[0, yy, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.028, 0.028, 1.1, 6]} />
              <meshStandardMaterial color="#3a3f49" metalness={0.6} roughness={0.35} />
            </mesh>
            {[-0.32, 0.32].map((x) => (
              <mesh key={x} position={[x, yy, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.09, 0.09, 0.14, 10]} />
                <meshStandardMaterial color="#15171d" metalness={0.5} roughness={0.4} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      <Plant position={[2.9, 0, -0.5]} scale={1.15} />
    </group>
  );
}

/* ─────────── OfficeShell 主组件 ─────────── */
export default function OfficeShell({ focusLayer, onSelectLayer }: {
  focusLayer: ArchLayerId | null;
  onSelectLayer: (id: ArchLayerId) => void;
}) {
  return (
    <group>
      <FloorSlab focusLayer={focusLayer} onSelectLayer={onSelectLayer} />
      <LayerFrontLabel
        badge="AGENT WORKFORCE" zh="专业智能体员工队伍 · 15 位数字员工 / 6 分区"
        color="#3B82F6" w={F.w} d={F.d} topY={F.topY} h={F.h}
      />

      {/* L 形幕墙：后墙 + 左墙 */}
      <CurtainWall length={F.w + 0.8} position={[0, F.topY, -F.d / 2 - 0.35]} rotationY={0} />
      <CurtainWall length={F.d + 0.8} position={[-F.w / 2 - 0.35, F.topY, 0]} rotationY={Math.PI / 2} />

      {/* 墙牌（复刻参考图 SYBERNETIC HQ / AI WORKFLOW 位置关系） */}
      <WallSign position={[-11.5, F.topY + 5.1, -F.d / 2 - 0.1]} w={10.5} h={2.6} title="HUMMER HQ" sub="AGENT WORKFORCE · AI NATIVE OFFICE" color="#38BDF8" titleSize={1.05} />
      <WallSign position={[3.5, F.topY + 5.4, -F.d / 2 - 0.1]} w={6.4} h={1.5} title="AI WORKFLOW" color="#818CF8" titleSize={0.62} />

      <AiPlaque />
      <FloorMarkings />
      <GymCorner />

      {/* 绿植点缀 */}
      <Plant position={[-18.4, F.topY, -13.2]} scale={1.3} />
      <Plant position={[18.3, F.topY, 13.4]} scale={1.1} />
      <Plant position={[-4.6, F.topY, 13.6]} scale={1.2} />
      <Plant position={[2.2, F.topY, -12.8]} scale={1.0} />
    </group>
  );
}
