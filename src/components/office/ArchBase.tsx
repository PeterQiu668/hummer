/**
 * ArchBase · Agentrix 架构基座（深度复刻 aihuashen.com 三层平台堆叠模型）
 * 自下而上：Data OS（存储节点阵列 + NODE-37 数据库）→ Agent OS（任务塔 + 业务目标条）
 * 顶层 Agent Workforce 即办公室楼板（见 OfficeShell）。
 * 复刻要素：倒角矩形平台堆叠 / 正面产品名标签 / 层聚焦调光 / 层间正交数据流脉冲 / 可点击元素档案
 */
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges, Instance, Instances, Text, useCursor } from '@react-three/drei';
import * as THREE from 'three';
import type { ArchLayerId } from '../../data/archLayers';

/* ─────────── 层级尺寸（比例复刻 Agentrix 1360→0.74→0.64 收窄堆叠） ─────────── */
export const STACK = {
  floor:   { w: 40, d: 30, h: 1.2, topY: 0 },     // Agent Workforce（办公室楼板，OfficeShell 渲染）
  agentos: { w: 48, d: 37, h: 1.6, topY: -4.6 },
  dataos:  { w: 58, d: 45, h: 1.9, topY: -9.6 },
};

const ACCENT: Record<ArchLayerId, string> = {
  workforce: '#3B82F6',
  agentos: '#A855F7',
  dataos: '#14B8A6',
};

export function roundedRectGeometry(w: number, d: number, h: number, r = 0.9) {
  const shape = new THREE.Shape();
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
    depth: h,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.07,
    bevelSegments: 1,
  });
  g.rotateX(-Math.PI / 2); // 顶面朝上，y ∈ [0, h] → 使用时下移 h
  return g;
}

/* ─────────── 正面产品名标签（复刻 layerFrontLabel，产品名不本地化） ─────────── */
export function LayerFrontLabel({ badge, zh, color, w, d, topY, h }: {
  badge: string; zh: string; color: string; w: number; d: number; topY: number; h: number;
}) {
  const yCenter = topY - h / 2;
  return (
    <group position={[-w / 2 + 1.4, yCenter, d / 2 + 0.09]}>
      <Text fontSize={h * 0.52} color={color} anchorX="left" anchorY="middle" letterSpacing={0.14} outlineWidth={0.02} outlineColor="#050810">
        {badge}
      </Text>
      <Text position={[0, -h * 0.42, 0]} fontSize={h * 0.16} color="#94a3b8" anchorX="left" anchorY="middle">
        {zh}
      </Text>
    </group>
  );
}

/* ─────────── 单层平台（点击聚焦 · 非聚焦层调暗，复刻 setLayerFocusMesh） ─────────── */
function TierPlatform({ id, focusLayer, onSelect }: {
  id: 'agentos' | 'dataos';
  focusLayer: ArchLayerId | null;
  onSelect: (id: ArchLayerId) => void;
}) {
  const spec = STACK[id];
  const color = ACCENT[id];
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const geometry = useMemo(() => roundedRectGeometry(spec.w, spec.d, spec.h, 1.1), [spec.w, spec.d, spec.h]);

  useFrame(({ clock }) => {
    const m = matRef.current;
    if (!m) return;
    const dimmed = focusLayer !== null && focusLayer !== id;
    const targetOpacity = dimmed ? 0.16 : 1;
    m.opacity += (targetOpacity - m.opacity) * 0.12;
    const focused = focusLayer === id;
    const base = focused ? 0.38 : hovered ? 0.24 : 0.1;
    m.emissiveIntensity = base + 0.03 * Math.sin(clock.elapsedTime * 0.7 + (id === 'agentos' ? 0 : 1.9));
  });

  return (
    <mesh
      geometry={geometry}
      position={[0, spec.topY - spec.h, 0]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); onSelect(id); }}
    >
      <meshStandardMaterial
        ref={matRef}
        color="#0c1424"
        roughness={0.55}
        metalness={0.5}
        emissive={color}
        emissiveIntensity={0.1}
        transparent
      />
      <Edges color={color} threshold={15} />
    </mesh>
  );
}

/* ─────────── Data OS · 存储节点阵列（实例化，复刻 storageField） ─────────── */
interface NodeInst { pos: [number, number, number]; scl: number; hot: boolean }

function StorageField({ onSelectDbNode }: { onSelectDbNode: () => void }) {
  const { w, d, topY } = STACK.dataos;
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const hotRingMat = useRef<THREE.MeshBasicMaterial>(null);

  const nodes = useMemo<NodeInst[]>(() => {
    const list: NodeInst[] = [];
    const cols = 9, rows = 6;
    const rng = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (rng(i * 3 + 2) < 0.12) continue; // 稀疏缺口，避免呆板
        const x = -w * 0.42 + (c / (cols - 1)) * w * 0.84 + (rng(i) - 0.5) * 1.2;
        const z = -d * 0.4 + (r / (rows - 1)) * d * 0.8 + (rng(i * 7 + 1) - 0.5) * 1.0;
        list.push({ pos: [x, topY, z], scl: 0.8 + rng(i * 13 + 5) * 0.45, hot: false });
      }
    }
    return list;
  }, [w, d, topY]);

  // NODE-37 · 前排右侧可点击热点节点
  const hotPos: [number, number, number] = [w * 0.28, topY, d * 0.3];

  useFrame(({ clock }) => {
    if (hotRingMat.current) hotRingMat.current.opacity = 0.45 + 0.3 * Math.sin(clock.elapsedTime * 2.2);
  });

  return (
    <group>
      {/* 普通存储节点 · 桶身 + 顶环各 1 个 InstancedMesh（2 draw call） */}
      <Instances limit={nodes.length}>
        <cylinderGeometry args={[0.42, 0.42, 1.1, 10]} />
        <meshStandardMaterial color="#0e1a2c" roughness={0.5} metalness={0.55} emissive="#14B8A6" emissiveIntensity={0.12} />
        {nodes.map((n, i) => (
          <Instance key={i} position={[n.pos[0], n.pos[1] + 0.55 * n.scl, n.pos[2]]} scale={n.scl} />
        ))}
      </Instances>
      <Instances limit={nodes.length}>
        <ringGeometry args={[0.2, 0.34, 12]} />
        <meshBasicMaterial color="#14B8A6" transparent opacity={0.35} toneMapped={false} side={THREE.DoubleSide} />
        {nodes.map((n, i) => (
          <Instance key={i} position={[n.pos[0], n.pos[1] + 1.12 * n.scl, n.pos[2]]} scale={n.scl} rotation={[-Math.PI / 2, 0, 0]} />
        ))}
      </Instances>

      {/* NODE-37 热点数据库（可点击 → 档案弹窗） */}
      <group
        position={hotPos}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => { e.stopPropagation(); onSelectDbNode(); }}
      >
        {[0, 0.62, 1.24].map((y) => (
          <mesh key={y} position={[0, y + 0.28, 0]}>
            <cylinderGeometry args={[0.62, 0.62, 0.5, 14]} />
            <meshStandardMaterial color="#0e2231" roughness={0.4} metalness={0.6} emissive="#22D3EE" emissiveIntensity={hovered ? 0.6 : 0.3} />
            <Edges color="#22D3EE" threshold={30} />
          </mesh>
        ))}
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.85, 1.05, 24]} />
          <meshBasicMaterial ref={hotRingMat} color="#22D3EE" transparent opacity={0.5} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <Text position={[0, 2.25, 0]} fontSize={0.34} color="#22D3EE" anchorX="center" anchorY="middle" letterSpacing={0.12} outlineWidth={0.015} outlineColor="#050810">
          NODE-37
        </Text>
      </group>
    </group>
  );
}

/* ─────────── Agent OS · 任务塔 ×3 + 业务目标条（复刻 taskTower / businessGoalBars） ─────────── */
function TaskTowers({ onSelectTaskTower }: { onSelectTaskTower: () => void }) {
  const { w, d, topY } = STACK.agentos;
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const slabMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const barMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const barMeshes = useRef<(THREE.Mesh | null)[]>([]);

  const towers = [-w * 0.3, -w * 0.02, w * 0.26];
  const slabs = 5;
  const goalBars = [0.55, 0.85, 0.68, 1.0, 0.75, 0.6];

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // 任务塔层板发光轮播（复刻 taskTowerLayerStates 的逐层点亮）
    slabMats.current.forEach((m, i) => {
      if (!m) return;
      const tower = Math.floor(i / slabs);
      const layer = i % slabs;
      const wave = (t * 1.5 + tower * 2.1) % slabs;
      const lit = Math.max(0, 1 - Math.abs(wave - layer)) ;
      m.emissiveIntensity = 0.12 + lit * (hovered ? 0.75 : 0.55);
    });
    // 业务目标条呼吸伸缩
    barMats.current.forEach((m, i) => {
      if (m) m.opacity = 0.5 + 0.3 * Math.sin(t * 1.3 + i * 0.8);
    });
    barMeshes.current.forEach((mesh, i) => {
      if (!mesh) return;
      const s = 0.75 + 0.25 * Math.sin(t * 0.9 + i * 1.1);
      mesh.scale.y = s;
    });
  });

  return (
    <group position={[0, topY, 0]}>
      {/* 任务塔 ×3（可点击 → TASK-42 档案） */}
      <group
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => { e.stopPropagation(); onSelectTaskTower(); }}
      >
        {towers.map((x, ti) => (
          <group key={ti} position={[x, 0, -d * 0.16]}>
            {Array.from({ length: slabs }).map((_, li) => (
              <mesh key={li} position={[0, 0.32 + li * 0.56, 0]}>
                <boxGeometry args={[2.6 - li * 0.18, 0.3, 2.1 - li * 0.14]} />
                <meshStandardMaterial
                  ref={(m) => { slabMats.current[ti * slabs + li] = m; }}
                  color="#141230"
                  roughness={0.45}
                  metalness={0.5}
                  emissive="#A855F7"
                  emissiveIntensity={0.15}
                />
                <Edges color="#A855F7" threshold={15} />
              </mesh>
            ))}
            {/* 塔顶核心 */}
            <mesh position={[0, 0.32 + slabs * 0.56 + 0.18, 0]}>
              <octahedronGeometry args={[0.3]} />
              <meshBasicMaterial color="#C084FC" transparent opacity={0.85} toneMapped={false} wireframe />
            </mesh>
          </group>
        ))}
        <Text position={[towers[1], 3.6, -d * 0.16]} fontSize={0.36} color="#C084FC" anchorX="center" anchorY="middle" letterSpacing={0.12} outlineWidth={0.015} outlineColor="#050810">
          TASK-42 · 调度矩阵
        </Text>
      </group>

      {/* 业务目标条（左前长条基块 + 竖直目标柱，复刻 businessGoalBars） */}
      <group position={[-w * 0.32, 0, d * 0.28]}>
        <mesh position={[2.6, 0.14, 0]}>
          <boxGeometry args={[7.2, 0.28, 1.6]} />
          <meshStandardMaterial color="#101830" roughness={0.5} metalness={0.5} emissive="#A855F7" emissiveIntensity={0.1} />
          <Edges color="#A855F7" threshold={15} />
        </mesh>
        {goalBars.map((h, i) => (
          <mesh
            key={i}
            ref={(m) => { barMeshes.current[i] = m; }}
            position={[i * 1.15, 0.28 + (h * 1.5) / 2, 0]}
          >
            <boxGeometry args={[0.5, h * 1.5, 0.5]} />
            <meshBasicMaterial
              ref={(m) => { barMats.current[i] = m; }}
              color={i === 3 ? '#38BDF8' : '#A855F7'}
              transparent opacity={0.6} toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ─────────── 层间正交数据流（复刻 buildOrthRoute + 流动脉冲） ─────────── */
interface FlowRoute { curve: THREE.CurvePath<THREE.Vector3>; color: string; speed: number; length: number }

function buildOrthCurve(points: [number, number, number][]): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length - 1; i++) {
    path.add(new THREE.LineCurve3(new THREE.Vector3(...points[i]), new THREE.Vector3(...points[i + 1])));
  }
  return path;
}

const PULSES_PER_FLOW = 3;
const scratchMat = new THREE.Matrix4();
const scratchVec = new THREE.Vector3();
const IDENT_Q = new THREE.Quaternion();
const scratchScl = new THREE.Vector3(1, 1, 1);

function DataFlows() {
  const flows = useMemo<FlowRoute[]>(() => {
    const D = STACK.dataos, A = STACK.agentos, F = STACK.floor;
    const defs: { pts: [number, number, number][]; color: string; speed: number }[] = [
      // Data OS 节点 → Agent OS 任务塔（读取）
      { pts: [[-18, D.topY + 0.6, 8], [-18, D.topY + 0.6, 2], [-18, A.topY + 0.4, 2], [-14.5, A.topY + 0.4, -5.9]], color: '#14B8A6', speed: 0.16 },
      { pts: [[14, D.topY + 0.6, -12], [14, A.topY + 0.4, -12], [12.5, A.topY + 0.4, -5.9], [0, A.topY + 0.4, -5.9]], color: '#14B8A6', speed: 0.13 },
      // Agent OS → Agent Workforce 楼板（指令上行）
      { pts: [[-14.5, A.topY + 0.5, -5.9], [-14.5, A.topY + 0.5, -11], [-14.5, F.topY + 0.3, -11], [-14.5, F.topY + 0.3, -6.5]], color: '#A855F7', speed: 0.18 },
      { pts: [[12.5, A.topY + 0.5, -5.9], [15, A.topY + 0.5, -9], [15, F.topY + 0.3, -9], [14, F.topY + 0.3, -8]], color: '#A855F7', speed: 0.15 },
      // Workforce → Data OS（结果回写下行）
      { pts: [[6, F.topY + 0.2, 10], [6, D.topY + 0.7, 10], [12, D.topY + 0.7, 10], [16.2, D.topY + 0.7, 13.5]], color: '#38BDF8', speed: 0.14 },
    ];
    return defs.map((d) => {
      const curve = buildOrthCurve(d.pts);
      return { curve, color: d.color, speed: d.speed, length: curve.getLength() };
    });
  }, []);

  const tubes = useMemo(
    () => flows.map((f) => new THREE.TubeGeometry(f.curve as unknown as THREE.Curve<THREE.Vector3>, 48, 0.045, 6, false)),
    [flows],
  );

  const pulseRef = useRef<THREE.InstancedMesh>(null);
  const count = flows.length * PULSES_PER_FLOW;

  useFrame(({ clock }) => {
    const inst = pulseRef.current;
    if (!inst) return;
    const t = clock.elapsedTime;
    let i = 0;
    const color = new THREE.Color();
    for (const f of flows) {
      for (let p = 0; p < PULSES_PER_FLOW; p++) {
        const u = (t * f.speed + p / PULSES_PER_FLOW) % 1;
        f.curve.getPointAt(u, scratchVec);
        scratchScl.setScalar(0.9 + 0.3 * Math.sin(t * 4 + i));
        scratchMat.compose(scratchVec, IDENT_Q, scratchScl);
        inst.setMatrixAt(i, scratchMat);
        if (inst.instanceColor === null || (inst as any).__colored !== true) inst.setColorAt(i, color.set(f.color));
        i++;
      }
    }
    (inst as any).__colored = true;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      {flows.map((f, i) => (
        <mesh key={i} geometry={tubes[i]}>
          <meshBasicMaterial color={f.color} transparent opacity={0.22} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
      <instancedMesh ref={pulseRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.11, 8, 8]} />
        <meshBasicMaterial color="#FFFFFF" toneMapped={false} transparent opacity={0.95} />
      </instancedMesh>
    </group>
  );
}

/* ─────────── 四角能量立柱（层间视觉支撑 · 取代旧“三脚”） ─────────── */
function CornerBeams() {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.opacity = 0.1 + 0.05 * Math.sin(clock.elapsedTime * 0.8);
  });
  const F = STACK.floor, D = STACK.dataos;
  const xs = [-F.w / 2 + 2.5, F.w / 2 - 2.5];
  const zs = [-F.d / 2 + 2.5, F.d / 2 - 2.5];
  const height = F.topY - D.topY;
  return (
    <group>
      {xs.flatMap((x) => zs.map((z) => (
        <mesh key={`${x}:${z}`} position={[x, D.topY + height / 2 - 0.6, z]}>
          <boxGeometry args={[0.5, height, 0.5]} />
          <meshBasicMaterial ref={matRef} color="#38BDF8" transparent opacity={0.12} toneMapped={false} depthWrite={false} />
        </mesh>
      )))}
    </group>
  );
}

/* ─────────── ArchBase 主组件 ─────────── */
export default function ArchBase({ focusLayer, onSelectLayer, onSelectDbNode, onSelectTaskTower }: {
  focusLayer: ArchLayerId | null;
  onSelectLayer: (id: ArchLayerId) => void;
  onSelectDbNode: () => void;
  onSelectTaskTower: () => void;
}) {
  const glowRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (glowRef.current) glowRef.current.opacity = 0.1 + 0.04 * Math.sin(clock.elapsedTime * 0.6);
  });
  const D = STACK.dataos;

  return (
    <group>
      <TierPlatform id="agentos" focusLayer={focusLayer} onSelect={onSelectLayer} />
      <TierPlatform id="dataos" focusLayer={focusLayer} onSelect={onSelectLayer} />

      <LayerFrontLabel badge="AGENT OS" zh="企业智能体操作系统 · 调度 / 路由 / A2A / 审批" color={ACCENT.agentos}
        w={STACK.agentos.w} d={STACK.agentos.d} topY={STACK.agentos.topY} h={STACK.agentos.h} />
      <LayerFrontLabel badge="DATA OS" zh="企业数据与知识底座 · 42 异构存储节点" color={ACCENT.dataos}
        w={STACK.dataos.w} d={STACK.dataos.d} topY={STACK.dataos.topY} h={STACK.dataos.h} />

      <StorageField onSelectDbNode={onSelectDbNode} />
      <TaskTowers onSelectTaskTower={onSelectTaskTower} />
      <DataFlows />
      <CornerBeams />

      {/* 基座底部光晕 */}
      <mesh position={[0, D.topY - D.h - 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[D.w * 0.62, 48]} />
        <meshBasicMaterial ref={glowRef} color="#14B8A6" transparent opacity={0.1} toneMapped={false} />
      </mesh>
    </group>
  );
}
