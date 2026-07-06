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

  // 阵列收缩到右半区 —— 左半区留给知识图谱星座 + 企业数据域（v12）
  const nodes = useMemo<NodeInst[]>(() => {
    const list: NodeInst[] = [];
    const cols = 6, rows = 5;
    const rng = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (rng(i * 3 + 2) < 0.12) continue; // 稀疏缺口，避免呆板
        const x = w * 0.04 + (c / (cols - 1)) * w * 0.38 + (rng(i) - 0.5) * 1.2;
        const z = -d * 0.38 + (r / (rows - 1)) * d * 0.76 + (rng(i * 7 + 1) - 0.5) * 1.0;
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

/* ─────────── Data OS · 知识图谱星座（企业知识 9.6k 边 · 缓慢自转） ─────────── */
function KnowledgeGraph() {
  const { w, d, topY } = STACK.dataos;
  const groupRef = useRef<THREE.Group>(null);

  const { nodes, edgeGeometry } = useMemo(() => {
    const rng = (n: number) => { const x = Math.sin(n * 91.7 + 47.3) * 43758.5453; return x - Math.floor(x); };
    const pts: THREE.Vector3[] = [];
    const count = 16;
    for (let i = 0; i < count; i++) {
      const a = rng(i) * Math.PI * 2;
      const r = 0.7 + rng(i * 3 + 1) * 1.9;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0.9 + rng(i * 7 + 2) * 1.7, Math.sin(a) * r * 0.8));
    }
    // 邻近连边（每点连 2 个最近点）
    const positions: number[] = [];
    for (let i = 0; i < count; i++) {
      const dists = pts.map((p, j) => ({ j, d: i === j ? Infinity : pts[i].distanceTo(p) }))
        .sort((a, b) => a.d - b.d).slice(0, 2);
      for (const { j } of dists) {
        positions.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return { nodes: pts, edgeGeometry: geo };
  }, []);

  useFrame(({ clock }) => {
    if (groupRef.current) groupRef.current.rotation.y = clock.elapsedTime * 0.12;
  });

  return (
    <group position={[-w * 0.3, topY, -d * 0.14]}>
      <group ref={groupRef}>
        <Instances limit={nodes.length}>
          <sphereGeometry args={[0.14, 10, 10]} />
          <meshBasicMaterial color="#2DD4BF" toneMapped={false} />
          {nodes.map((p, i) => (
            <Instance key={i} position={[p.x, p.y, p.z]} scale={0.7 + (i % 4) * 0.22} color={i % 5 === 0 ? '#38BDF8' : '#2DD4BF'} />
          ))}
        </Instances>
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial color="#14B8A6" transparent opacity={0.35} toneMapped={false} />
        </lineSegments>
      </group>
      {/* 图谱基环 */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.4, 2.62, 40]} />
        <meshBasicMaterial color="#14B8A6" transparent opacity={0.3} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <Text position={[0, 2.9, 0]} fontSize={0.34} color="#5EEAD4" anchorX="center" anchorY="middle" letterSpacing={0.1} outlineWidth={0.015} outlineColor="#050810">
        知识图谱 · 9.6k 边
      </Text>
    </group>
  );
}

/* ─────────── Data OS · 企业数据域方块（CRM / ERP / BI / OA / 合同 / 工单） ─────────── */
const DATA_DOMAINS = ['CRM', 'ERP', 'BI', 'OA', '合同', '工单'];

function DataDomains() {
  const { w, d, topY } = STACK.dataos;
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    mats.current.forEach((m, i) => {
      if (m) m.emissiveIntensity = 0.16 + 0.1 * Math.sin(clock.elapsedTime * 1.1 + i * 1.05);
    });
  });
  return (
    <group position={[-w * 0.36, topY, d * 0.3]}>
      {DATA_DOMAINS.map((name, i) => (
        <group key={name} position={[i * 2.5, 0, (i % 2) * 0.9 - 0.45]}>
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[1.9, 1.1, 1.5]} />
            <meshStandardMaterial
              ref={(m) => { mats.current[i] = m; }}
              color="#0d1a2a" roughness={0.45} metalness={0.55}
              emissive="#14B8A6" emissiveIntensity={0.16}
            />
            <Edges color="#2DD4BF" threshold={15} />
          </mesh>
          <Text position={[0, 0.58, 0.78]} fontSize={0.4} color="#99F6E4" anchorX="center" anchorY="middle" letterSpacing={0.06} outlineWidth={0.012} outlineColor="#050810">
            {name}
          </Text>
        </group>
      ))}
      <Text position={[6.2, 2.0, 0]} fontSize={0.3} color="#5EEAD4" anchorX="center" anchorY="middle" letterSpacing={0.14}>
        企业业务数据域
      </Text>
    </group>
  );
}

/* ─────────── Agent OS · 技能芯片阵列（爱化身式能力单元） ─────────── */
const SKILLS = ['合同审阅', '数据分析', '文案生成', '报表生成', '客服应答', '舆情监控', '招聘筛选', '排班优化'];

function SkillChips() {
  const { w, d, topY } = STACK.agentos;
  const chipRefs = useRef<(THREE.Group | null)[]>([]);
  const chipMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    chipRefs.current.forEach((g, i) => {
      if (g) g.position.y = 0.5 + 0.1 * Math.sin(t * 1.3 + i * 0.9);
    });
    chipMats.current.forEach((m, i) => {
      if (m) m.emissiveIntensity = 0.22 + 0.14 * Math.sin(t * 1.6 + i * 0.8);
    });
  });
  return (
    <group position={[w * 0.13, topY, d * 0.2]}>
      {SKILLS.map((name, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        return (
          <group key={name} ref={(g) => { chipRefs.current[i] = g; }} position={[col * 3.1, 0.5, row * 2.6]}>
            <mesh>
              <boxGeometry args={[2.6, 0.34, 1.5]} />
              <meshStandardMaterial
                ref={(m) => { chipMats.current[i] = m; }}
                color="#151132" roughness={0.4} metalness={0.55}
                emissive={i % 2 === 0 ? '#A855F7' : '#6366F1'} emissiveIntensity={0.22}
              />
              <Edges color={i % 2 === 0 ? '#C084FC' : '#818CF8'} threshold={15} />
            </mesh>
            <Text position={[0, 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.44} color="#EDE9FE" anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#0a0618">
              {name}
            </Text>
          </group>
        );
      })}
      <Text position={[4.7, 2.1, -1.3]} fontSize={0.3} color="#C4B5FD" anchorX="center" anchorY="middle" letterSpacing={0.14}>
        技能库 · SKILL UNITS
      </Text>
    </group>
  );
}

/* ─────────── Agent OS · 工作流流水线（意图 → 拆解 → 执行 → 交付） ─────────── */
const WORKFLOW_STAGES = ['意图理解', '任务拆解', '执行 · 工具', '审批交付'];

function WorkflowPipeline() {
  const { w, d, topY } = STACK.agentos;
  const pulseRef = useRef<THREE.Mesh>(null);
  const stageMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const stageX = (i: number) => i * 3.9;
  const total = stageX(WORKFLOW_STAGES.length - 1);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const u = (t * 0.28) % 1;
    if (pulseRef.current) pulseRef.current.position.x = u * total;
    // 脉冲经过的阶段点亮
    stageMats.current.forEach((m, i) => {
      if (!m) return;
      const su = stageX(i) / total;
      const lit = Math.max(0, 1 - Math.abs(u - su) * 6);
      m.emissiveIntensity = 0.18 + lit * 0.5;
    });
  });

  return (
    <group position={[-w * 0.42, topY, d * 0.16]}>
      {/* 传送轨道 */}
      <mesh position={[total / 2, 0.5, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.035, 0.035, total, 6]} />
        <meshBasicMaterial color="#A855F7" transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <mesh ref={pulseRef} position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.13, 8, 8]} />
        <meshBasicMaterial color="#F0ABFC" toneMapped={false} />
      </mesh>
      {WORKFLOW_STAGES.map((name, i) => (
        <group key={name} position={[stageX(i), 0, 0]}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[2.2, 1.0, 1.5]} />
            <meshStandardMaterial
              ref={(m) => { stageMats.current[i] = m; }}
              color="#141230" roughness={0.42} metalness={0.55}
              emissive="#A855F7" emissiveIntensity={0.18}
            />
            <Edges color="#C084FC" threshold={15} />
          </mesh>
          <Text position={[0, 0.52, 0.78]} fontSize={0.3} color="#F3E8FF" anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#0a0618">
            {name}
          </Text>
        </group>
      ))}
      <Text position={[total / 2, 1.9, 0]} fontSize={0.3} color="#C4B5FD" anchorX="center" anchorY="middle" letterSpacing={0.14}>
        工作流引擎 · WORKFLOW
      </Text>
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
  const slabs = 4; // 塔顶须低于上层楼板底（层间净空 3.4）
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
        <Text position={[towers[1], 2.95, -d * 0.16]} fontSize={0.36} color="#C084FC" anchorX="center" anchorY="middle" letterSpacing={0.12} outlineWidth={0.015} outlineColor="#050810">
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

      <LayerFrontLabel badge="AGENT OS" zh="企业智能体操作系统 · 技能库 / 工作流 / 调度 / A2A" color={ACCENT.agentos}
        w={STACK.agentos.w} d={STACK.agentos.d} topY={STACK.agentos.topY} h={STACK.agentos.h} />
      <LayerFrontLabel badge="DATA OS" zh="企业数据与知识底座 · 知识图谱 / 数据域 / 存储节点" color={ACCENT.dataos}
        w={STACK.dataos.w} d={STACK.dataos.d} topY={STACK.dataos.topY} h={STACK.dataos.h} />

      <StorageField onSelectDbNode={onSelectDbNode} />
      <KnowledgeGraph />
      <DataDomains />
      <TaskTowers onSelectTaskTower={onSelectTaskTower} />
      <SkillChips />
      <WorkflowPipeline />
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
