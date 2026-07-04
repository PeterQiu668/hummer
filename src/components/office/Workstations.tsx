/**
 * Workstations (v9)
 * - 体素小人升级为角色档案系统（VoxelHuman.tsx：发型/配饰/体型/职业色 + 状态动作）
 * - 坐标映射统一走 scenePositions.ts（消除与 CameraRig3D 的重复）
 * - 招聘员工监听 storage + 自定义事件（替代 4s 轮询）
 * - 精细化 zustand 订阅：仅选中态翻转的小人重渲染
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Instances, Instance, Text } from '@react-three/drei';
import * as THREE from 'three';
import { workstations } from '../../data/workstations';
import { employees } from '../../data/employees';
import { marketEmployees } from '../../data/marketplace';
import { useAppStore } from '../../store/useAppStore';
import { getPos3D } from './scenePositions';
import VoxelHuman, { AGENT_LOOKS, TRAINEE_LOOK, hashCode, type FigureLook } from './VoxelHuman';
import type { Employee } from '../../lib/types';

export const HIRES_CHANGED_EVENT = 'hummer-hires-changed';

const SKIN_TONES = ['#F5D7B5', '#EBC094', '#D4A276'];

const FALLBACK_LOOK: FigureLook = {
  outfit: '#0F70B7', hair: 'neat', hairColor: '#2A2723', accessories: [], build: 'default',
};

/* ───────────── EmployeeFigure (桌椅 + 体素小人 + 名牌) ───────────── */
const EmployeeFigure = memo(function EmployeeFigure({
  employee, position,
}: { employee: Employee; position: [number, number, number] }) {
  const isSelected = useAppStore((s) => s.selectedEmployee?.id === employee.id);
  const setSelectedEmployee = useAppStore((s) => s.setSelectedEmployee);
  const look = AGENT_LOOKS[employee.id] ?? FALLBACK_LOOK;
  const skin = SKIN_TONES[hashCode(employee.id) % SKIN_TONES.length];
  const screenMatRef = useRef<THREE.MeshBasicMaterial>(null);

  return (
    <group position={position}>
      {/* 椅子 */}
      <mesh position={[0, 0.25, 0.55]}>
        <boxGeometry args={[0.55, 0.5, 0.55]} />
        <meshStandardMaterial color="#3a3a36" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.7, 0.78]}>
        <boxGeometry args={[0.55, 0.55, 0.08]} />
        <meshStandardMaterial color="#3a3a36" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* 桌子 */}
      <mesh position={[0, 0.45, -0.1]}>
        <boxGeometry args={[1.4, 0.06, 0.8]} />
        <meshStandardMaterial color="#5a5a55" metalness={0.3} roughness={0.4} />
      </mesh>
      <mesh position={[-0.6, 0.22, -0.3]}>
        <boxGeometry args={[0.06, 0.42, 0.06]} />
        <meshStandardMaterial color="#3a3a36" />
      </mesh>
      <mesh position={[0.6, 0.22, -0.3]}>
        <boxGeometry args={[0.06, 0.42, 0.06]} />
        <meshStandardMaterial color="#3a3a36" />
      </mesh>
      {/* 显示器框 + 屏幕（屏幕材质交给 VoxelHuman 做状态闪烁） */}
      <mesh position={[0, 0.95, -0.35]}>
        <boxGeometry args={[0.95, 0.6, 0.04]} />
        <meshStandardMaterial color="#1f1d1a" metalness={0.4} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.95, -0.33]}>
        <planeGeometry args={[0.86, 0.5]} />
        <meshBasicMaterial ref={screenMatRef} color={look.outfit} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.62, -0.35]}>
        <boxGeometry args={[0.08, 0.2, 0.04]} />
        <meshStandardMaterial color="#1f1d1a" />
      </mesh>

      {/* 体素小人（角色档案 + 状态动作） */}
      <VoxelHuman
        position={[0, 0, 0.5]}
        look={look}
        status={employee.status}
        isSelected={isSelected}
        seed={employee.id}
        skin={skin}
        screenMatRef={screenMatRef}
        screenBaseColor={look.outfit}
        onClick={(e) => { e.stopPropagation(); setSelectedEmployee(employee); }}
      />

      {/* 名字 */}
      <Text
        position={[0, 2.05, 0.5]}
        fontSize={0.18}
        color={isSelected ? look.outfit : '#dcdcd0'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.008}
        outlineColor="#1A1B1E"
      >
        {employee.name}
      </Text>
    </group>
  );
});

/* ───────────── 空工位（占位桌 · 实例化） ───────────── */
function EmptyDeskCluster({ desks }: { desks: { id: string; pos: [number, number, number] }[] }) {
  if (desks.length === 0) return null;
  return (
    <group>
      <Instances limit={workstations.length}>
        <boxGeometry args={[1.4, 0.06, 0.8]} />
        <meshStandardMaterial color="#3a3a36" metalness={0.3} roughness={0.6} />
        {desks.map((d) => (
          <Instance key={d.id} position={[d.pos[0], d.pos[1] + 0.45, d.pos[2] - 0.1]} />
        ))}
      </Instances>
    </group>
  );
}

/* ───────────── 招聘的市场员工 → 试岗工位 ───────────── */
function HiredFigures({ hiredIds }: { hiredIds: string[] }) {
  const hired = marketEmployees.filter((m) => hiredIds.includes(m.id));
  if (hired.length === 0) return null;
  return (
    <>
      {hired.map((m, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const pos: [number, number, number] = [3 + col * 2.2, 0.02, 8 + row * 2.2];
        const look: FigureLook = { ...TRAINEE_LOOK, outfit: m.color };
        return (
          <group key={m.id} position={pos}>
            <mesh position={[0, 0.45, -0.1]}>
              <boxGeometry args={[1.4, 0.06, 0.8]} />
              <meshStandardMaterial color="#5a5a55" roughness={0.45} />
            </mesh>
            <VoxelHuman
              position={[0, 0, 0.4]}
              look={look}
              status="training"
              isSelected={false}
              seed={m.id}
              skin={SKIN_TONES[hashCode(m.id) % SKIN_TONES.length]}
            />
            <Text
              position={[0, 2.05, 0.4]}
              fontSize={0.16}
              color="#F59E0B"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.008}
              outlineColor="#1A1B1E"
            >
              {`${m.name} · 试岗中`}
            </Text>
          </group>
        );
      })}
    </>
  );
}

function readHires(): string[] {
  try {
    const m = JSON.parse(localStorage.getItem('hummer-marketplace-hires') ?? '{}');
    return Object.keys(m).filter((k) => m[k]);
  } catch {
    return [];
  }
}

export default function Workstations() {
  const empById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), []);
  const occupied = useMemo(() => workstations.filter((w) => w.employeeId), []);
  const emptyDesks = useMemo(
    () => workstations.filter((w) => !w.employeeId).map((w) => ({ id: w.id, pos: getPos3D(w) })),
    [],
  );

  // 招聘自市场的员工 id：storage 事件（跨 tab）+ 自定义事件（同 tab 写入方 dispatch）
  const [hiredIds, setHiredIds] = useState<string[]>(readHires);
  useEffect(() => {
    const read = () => setHiredIds(readHires());
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'hummer-marketplace-hires') read();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(HIRES_CHANGED_EVENT, read);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(HIRES_CHANGED_EVENT, read);
    };
  }, []);

  return (
    <group>
      {occupied.map((ws) => {
        const emp = empById[ws.employeeId!];
        if (!emp) return null;
        return <EmployeeFigure key={ws.id} employee={emp} position={getPos3D(ws)} />;
      })}
      <EmptyDeskCluster desks={emptyDesks} />
      <HiredFigures hiredIds={hiredIds} />
    </group>
  );
}
