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

/* ─────────── 智能绿植舱（暗金属花盆 + 霓虹环 + 低多边形植株，风格与全场统一） ─────────── */
function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {/* 六棱金属盆 */}
      <mesh position={[0, 0.26, 0]}>
        <cylinderGeometry args={[0.28, 0.36, 0.52, 6]} />
        <meshStandardMaterial color="#141c2e" metalness={0.6} roughness={0.35} emissive="#10B981" emissiveIntensity={0.08} />
        <Edges color="#10B981" threshold={30} />
      </mesh>
      {/* 盆口霓虹环 */}
      <mesh position={[0, 0.53, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, 0.27, 18]} />
        <meshBasicMaterial color="#34D399" transparent opacity={0.55} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* 低多边形植株（八面体叶簇，微发光边缘） */}
      {[[0, 0.95, 0, 0.3], [-0.16, 0.8, 0.1, 0.2], [0.15, 0.82, -0.1, 0.22], [0.02, 1.18, 0.05, 0.18]].map(([x, y, z, s], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[i * 0.6, i * 1.1, 0]}>
          <octahedronGeometry args={[s as number]} />
          <meshStandardMaterial color="#14532d" roughness={0.55} metalness={0.2} emissive="#22C55E" emissiveIntensity={0.12} flatShading />
        </mesh>
      ))}
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[0.03, 0.045, 0.42, 6]} />
        <meshStandardMaterial color="#1f2d24" roughness={0.6} />
      </mesh>
    </group>
  );
}

/* ─────────── 能量健身舱（悬浮跑步机 + 智能力量架 · 暗金属 + 霓虹描边） ─────────── */
function GymCorner() {
  const beltMat = useRef<THREE.MeshBasicMaterial>(null);
  const padMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (beltMat.current) beltMat.current.opacity = 0.35 + 0.18 * Math.sin(t * 3.2);
    if (padMat.current) padMat.current.opacity = 0.22 + 0.1 * Math.sin(t * 1.1);
  });
  return (
    <group position={[-16.8, F.topY, 12.2]} rotation={[0, Math.PI / 7, 0]}>
      {/* 区域能量垫 */}
      <mesh position={[1.3, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.6, 2.74, 36]} />
        <meshBasicMaterial ref={padMat} color="#F59E0B" transparent opacity={0.25} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* 悬浮跑步机：流线基座 + 光带跑带 + 全息面板 */}
      <group>
        <mesh position={[0, 0.14, 0]}>
          <boxGeometry args={[0.9, 0.14, 2.1]} />
          <meshStandardMaterial color="#101623" metalness={0.6} roughness={0.3} emissive="#38BDF8" emissiveIntensity={0.1} />
          <Edges color="#38BDF8" threshold={15} />
        </mesh>
        <mesh position={[0, 0.22, 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.62, 1.7]} />
          <meshBasicMaterial ref={beltMat} color="#38BDF8" transparent opacity={0.4} toneMapped={false} />
        </mesh>
        {/* 单侧悬臂扶手 */}
        {[-0.36, 0.36].map((x) => (
          <mesh key={x} position={[x, 0.72, -0.85]} rotation={[0.22, 0, 0]}>
            <boxGeometry args={[0.05, 1.2, 0.05]} />
            <meshStandardMaterial color="#182238" metalness={0.65} roughness={0.3} emissive="#38BDF8" emissiveIntensity={0.15} />
          </mesh>
        ))}
        {/* 悬浮全息面板（半透明发光屏） */}
        <mesh position={[0, 1.36, -0.98]} rotation={[-0.12, 0, 0]}>
          <planeGeometry args={[0.8, 0.42]} />
          <meshBasicMaterial color="#38BDF8" transparent opacity={0.5} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* 智能力量架：发光杠铃 + 磁悬浮配重 */}
      <group position={[1.8, 0, 0.35]} rotation={[0, -0.3, 0]}>
        {[-0.6, 0.6].map((x) => (
          <mesh key={x} position={[x, 0.46, 0]}>
            <boxGeometry args={[0.09, 0.92, 0.5]} />
            <meshStandardMaterial color="#141c2e" metalness={0.6} roughness={0.3} emissive="#A855F7" emissiveIntensity={0.12} />
            <Edges color="#A855F7" threshold={15} />
          </mesh>
        ))}
        {[0.34, 0.72].map((yy) => (
          <group key={yy}>
            <mesh position={[0, yy, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.025, 0.025, 1.2, 6]} />
              <meshStandardMaterial color="#2a3550" metalness={0.7} roughness={0.25} emissive="#A855F7" emissiveIntensity={0.2} />
            </mesh>
            {[-0.36, 0.36].map((x) => (
              <mesh key={x} position={[x, yy, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.1, 0.1, 0.12, 12]} />
                <meshStandardMaterial color="#101623" metalness={0.6} roughness={0.3} emissive="#C084FC" emissiveIntensity={0.18} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      <Plant position={[3.1, 0, -0.6]} scale={1.15} />
      <Text position={[1.3, 2.0, 0]} fontSize={0.26} color="#FCD34D" anchorX="center" anchorY="middle" letterSpacing={0.2}>
        ENERGY GYM
      </Text>
    </group>
  );
}

/* ─────────── 楼板周圈能量光带（双色呼吸，科技感描边） ─────────── */
function PerimeterGlow() {
  const matA = useRef<THREE.MeshBasicMaterial>(null);
  const matB = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (matA.current) matA.current.opacity = 0.4 + 0.2 * Math.sin(t * 1.4);
    if (matB.current) matB.current.opacity = 0.4 + 0.2 * Math.sin(t * 1.4 + Math.PI);
  });
  const y = F.topY + 0.02;
  const inset = 0.55;
  const hw = F.w / 2 - inset;
  const hd = F.d / 2 - inset;
  const flat: [number, number, number] = [-Math.PI / 2, 0, 0];
  return (
    <group>
      {/* 前后光带（青） */}
      {[hd, -hd].map((z) => (
        <mesh key={`z${z}`} position={[0, y, z]} rotation={flat}>
          <planeGeometry args={[hw * 2, 0.12]} />
          <meshBasicMaterial ref={z > 0 ? matA : undefined} color="#22D3EE" transparent opacity={0.45} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
      {/* 左右光带（蓝紫） */}
      {[hw, -hw].map((x) => (
        <mesh key={`x${x}`} position={[x, y, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
          <planeGeometry args={[hd * 2, 0.12]} />
          <meshBasicMaterial ref={x > 0 ? matB : undefined} color="#818CF8" transparent opacity={0.45} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
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
      <PerimeterGlow />
      <GymCorner />

      {/* 绿植点缀 */}
      <Plant position={[-18.4, F.topY, -13.2]} scale={1.3} />
      <Plant position={[18.3, F.topY, 13.4]} scale={1.1} />
      <Plant position={[-4.6, F.topY, 13.6]} scale={1.2} />
      <Plant position={[2.2, F.topY, -12.8]} scale={1.0} />
    </group>
  );
}
