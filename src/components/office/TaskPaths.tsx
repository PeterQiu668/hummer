/**
 * Agent 工作路径可视化
 * collabTasks 的 ownerId → collaboratorIds 协作图映射为 3D 弧线：
 * - 颜色 = 任务状态 · 粗细/脉冲速度 = 优先级 · 弧高分层 = 状态（减少交叉）
 * - 脉冲点（单个 InstancedMesh，1 draw call）沿曲线流动，方向 = owner → collaborator
 * - blocked 边的脉冲卡在 60% 处闪烁（视觉上"卡住"）
 * - 聚焦：选中员工 / 激活分区时，相关边高亮，其余淡出
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useCursor } from '@react-three/drei';
import * as THREE from 'three';
import { collabTasks } from '../../data/tasks';
import { employees } from '../../data/employees';
import { getEmployeePos3D } from './scenePositions';
import { useAppStore } from '../../store/useAppStore';
import type { CollabTask, TaskStatus } from '../../lib/types';

export const PATH_STATUS_COLOR: Record<string, string> = {
  in_progress: '#3B82F6',
  waiting_approval: '#F59E0B',
  blocked: '#C13D3D',
  pending: '#6B7280',
  completed: '#10B981',
  failed: '#C13D3D',
  overdue: '#C13D3D',
};

const PRIORITY_RADIUS: Record<string, number> = { urgent: 0.035, high: 0.028, normal: 0.02, low: 0.018 };
const PRIORITY_SPEED: Record<string, number> = { urgent: 0.5, high: 0.35, normal: 0.22, low: 0.18 };
/** 弧高分层：blocked 最低（贴近地面 = 需要注意），completed/pending 最高最淡 */
const STATUS_LIFT: Record<string, number> = {
  blocked: 0.8, in_progress: 1.0, waiting_approval: 1.2, pending: 1.4, completed: 1.4, failed: 0.8, overdue: 0.9,
};

const ANCHOR_Y = 2.15; // 头顶上方出发/到达（高于名牌）

export interface PathEdge {
  key: string;
  task: CollabTask;
  ownerName: string;
  collabName: string;
  curve: THREE.QuadraticBezierCurve3;
  tube: THREE.TubeGeometry;
  color: string;
  speed: number;
  phase: number;
  arrowPos: THREE.Vector3;
  arrowQuat: THREE.Quaternion;
  start: THREE.Vector3;
}

export interface HoverInfo {
  title: string;
  status: TaskStatus;
  progress: number;
  ownerName: string;
  collabName: string;
  priority: string;
}

const EMP_NAME = new Map(employees.map((e) => [e.id, e.name]));

function buildEdges(): PathEdge[] {
  const edges: PathEdge[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const task of collabTasks) {
    const fromArr = getEmployeePos3D(task.ownerId);
    if (!fromArr) continue;
    const from = new THREE.Vector3(fromArr[0], fromArr[1] + ANCHOR_Y, fromArr[2]);
    task.collaboratorIds.forEach((cid, lane) => {
      const toArr = getEmployeePos3D(cid);
      if (!toArr) return;
      const to = new THREE.Vector3(toArr[0], toArr[1] + ANCHOR_Y, toArr[2]);
      const dist = from.distanceTo(to);
      const lift = THREE.MathUtils.clamp(dist * 0.22, 0.7, 2.4) * (STATUS_LIFT[task.status] ?? 1) + lane * 0.4;
      const mid = from.clone().lerp(to, 0.5);
      mid.y += lift;
      // 平行边横向错开
      const perp = to.clone().sub(from).setY(0).normalize().cross(up).multiplyScalar(lane * 0.3);
      mid.add(perp);
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const radius = PRIORITY_RADIUS[task.priority] ?? 0.02;
      const tube = new THREE.TubeGeometry(curve, 28, radius, 6, false);
      const arrowPos = curve.getPointAt(0.92);
      const tangent = curve.getTangentAt(0.92);
      const arrowQuat = new THREE.Quaternion().setFromUnitVectors(up, tangent);
      edges.push({
        key: `${task.id}:${cid}`,
        task,
        ownerName: EMP_NAME.get(task.ownerId) ?? task.ownerId,
        collabName: EMP_NAME.get(cid) ?? cid,
        curve, tube,
        color: PATH_STATUS_COLOR[task.status] ?? '#6B7280',
        speed: PRIORITY_SPEED[task.priority] ?? 0.22,
        phase: (lane * 0.37 + task.id.length * 0.13) % 1,
        arrowPos, arrowQuat,
        start: from,
      });
    });
  }
  return edges;
}

const scratchMatrix = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const HIDDEN_SCALE = new THREE.Vector3(0, 0, 0);
const scratchScale = new THREE.Vector3(1, 1, 1);
const IDENTITY_QUAT = new THREE.Quaternion();

export default function TaskPaths({
  visibleStatuses,
  onHover,
}: {
  visibleStatuses: TaskStatus[];
  onHover?: (info: HoverInfo | null) => void;
}) {
  const selectedId = useAppStore((s) => s.selectedEmployee?.id ?? null);
  const activeZone = useAppStore((s) => s.activeZone);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  useCursor(!!hoverKey);

  const edges = useMemo(buildEdges, []);
  const pulseRef = useRef<THREE.InstancedMesh>(null);

  // 脉冲点按边的状态色着色（一次性）
  useEffect(() => {
    const inst = pulseRef.current;
    if (!inst) return;
    const c = new THREE.Color();
    edges.forEach((e, i) => inst.setColorAt(i, c.set(e.color)));
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }, [edges]);

  const zoneEmpIds = useMemo(() => {
    if (!activeZone) return null;
    return new Set(employees.filter((e) => e.zone === activeZone).map((e) => e.id));
  }, [activeZone]);

  // 每条边的展示层级：1=高亮 0.5=常规 0=淡出
  const emphasis = (e: PathEdge): number => {
    if (!visibleStatuses.includes(e.task.status)) return 0;
    if (hoverKey) return e.key === hoverKey ? 1 : 0.15;
    if (selectedId) {
      return e.task.ownerId === selectedId || e.task.collaboratorIds.includes(selectedId) ? 1 : 0.1;
    }
    if (zoneEmpIds) {
      const touches = zoneEmpIds.has(e.task.ownerId) || e.task.collaboratorIds.some((c) => zoneEmpIds.has(c));
      return touches ? 1 : 0.1;
    }
    return 0.6;
  };

  useFrame(({ clock }) => {
    const inst = pulseRef.current;
    if (!inst) return;
    const t = clock.elapsedTime;
    edges.forEach((e, i) => {
      const em = emphasis(e);
      const done = e.task.status === 'completed';
      if (em < 0.2 || done) {
        scratchMatrix.compose(e.start, IDENTITY_QUAT, HIDDEN_SCALE);
        inst.setMatrixAt(i, scratchMatrix);
        return;
      }
      let u = (t * e.speed * (em === 1 ? 1.5 : 1) + e.phase) % 1;
      let s = em === 1 ? 1.25 : 0.85;
      if (e.task.status === 'blocked') {
        u = Math.min(u, 0.6);
        if (u >= 0.6) s *= 0.7 + 0.5 * Math.abs(Math.sin(t * 5)); // 卡住闪烁
      }
      e.curve.getPointAt(u, scratchPos);
      scratchScale.setScalar(s);
      scratchMatrix.compose(scratchPos, IDENTITY_QUAT, scratchScale);
      inst.setMatrixAt(i, scratchMatrix);
    });
    inst.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {edges.map((e) => {
        const em = emphasis(e);
        if (em === 0) return null;
        const opacity = em === 1 ? 0.92 : em < 0.2 ? 0.05 : 0.3;
        return (
          <group key={e.key}>
            <mesh
              geometry={e.tube}
              onPointerOver={(ev) => {
                ev.stopPropagation();
                setHoverKey(e.key);
                onHover?.({
                  title: e.task.title,
                  status: e.task.status,
                  progress: e.task.progress,
                  ownerName: e.ownerName,
                  collabName: e.collabName,
                  priority: e.task.priority,
                });
              }}
              onPointerOut={() => { setHoverKey(null); onHover?.(null); }}
            >
              <meshBasicMaterial color={e.color} transparent opacity={opacity} toneMapped={false} depthWrite={false} />
            </mesh>
            {/* 方向箭头（owner → collaborator） */}
            {em >= 0.2 && (
              <mesh position={e.arrowPos} quaternion={e.arrowQuat}>
                <coneGeometry args={[0.06, 0.14, 6]} />
                <meshBasicMaterial color={e.color} transparent opacity={Math.min(1, opacity + 0.2)} toneMapped={false} />
              </mesh>
            )}
            {/* 发起方标记环 */}
            {em >= 0.2 && (
              <mesh position={[e.start.x, e.start.y + 0.1, e.start.z]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.12, 0.16, 16]} />
                <meshBasicMaterial color={e.color} transparent opacity={opacity} toneMapped={false} />
              </mesh>
            )}
          </group>
        );
      })}

      {/* 流动脉冲点 · 所有边共享一个 InstancedMesh（1 draw call） */}
      <instancedMesh ref={pulseRef} args={[undefined, undefined, edges.length]} frustumCulled={false}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial color="#FFFFFF" toneMapped={false} transparent opacity={0.95} />
      </instancedMesh>
    </group>
  );
}
