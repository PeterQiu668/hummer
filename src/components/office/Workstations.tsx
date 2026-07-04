/**
 * Workstations (v8)
 * 1. 体素小人替换胶囊体（头/身/双臂分块 BoxGeometry，更像 humanoid）
 * 2. 已招聘的 marketEmployees 自动出现在「过渡区/休息区」附近的额外工位
 */
import { useEffect, useMemo, useState } from 'react';
import { Instances, Instance, Text } from '@react-three/drei';
import { workstations } from '../../data/workstations';
import { employees } from '../../data/employees';
import { marketEmployees } from '../../data/marketplace';
import { useAppStore } from '../../store/useAppStore';
import { ZONE_SPECS } from './ZonePlatform';
import type { Employee } from '../../lib/types';

const ZONE_2D_CENTERS: Record<string, { x: number; y: number }> = {
  boss:     { x: 81, y: 19 },
  business: { x: 47, y: 45 },
  support:  { x: 18, y: 42 },
  meeting:  { x: 69, y: 61 },
  rest:     { x: 88, y: 54 },
  learn:    { x: 17, y: 21 },
  transit:  { x: 55, y: 73 },
};

function getPos3D(ws: { x: number; y: number; zone: string }): [number, number, number] {
  const c2d = ZONE_2D_CENTERS[ws.zone] ?? { x: 50, y: 50 };
  const spec = ZONE_SPECS.find((s) => s.id === ws.zone);
  if (!spec) return [0, 0.4, 6];
  const dx = ws.x - c2d.x;
  const dy = ws.y - c2d.y;
  const scaleX = (spec.size[0] * 0.35) / 10;
  const scaleZ = (spec.size[1] * 0.35) / 8;
  return [spec.center[0] + dx * scaleX, spec.elevation + 0.02, spec.center[1] + dy * scaleZ];
}

const STATUS_COLOR: Record<string, string> = {
  working: '#0F70B7', meeting: '#7E22CE', training: '#0F766E',
  blocked: '#C13D3D', idle: '#6B7280',
};

const ROLE_HAIR: Record<string, string> = {
  boss: '#1F1D1A', business: '#2A2723', support: '#553722',
  meeting: '#3A2D24', rest: '#8B6914', learn: '#1F1D1A',
};

const SKIN_TONES = ['#F5D7B5', '#EBC094', '#D4A276'];

function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return Math.abs(h);
}

/* ───────────── 体素小人 (head + torso + arms) ───────────── */
function VoxelHuman({
  position, color, isSelected, hairColor, skin, onClick,
}: {
  position: [number, number, number];
  color: string;
  isSelected: boolean;
  hairColor: string;
  skin: string;
  onClick: (e: any) => void;
}) {
  const torsoY = 1.05;
  const headY = 1.55;
  return (
    <group
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      onClick={onClick}
    >
      {/* 上半身 */}
      <mesh position={[0, torsoY, 0]}>
        <boxGeometry args={[0.42, 0.5, 0.28]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isSelected ? 0.7 : 0.18}
          roughness={0.55}
          metalness={0.15}
        />
      </mesh>
      {/* 衣领 V */}
      <mesh position={[0, torsoY + 0.18, 0.145]}>
        <boxGeometry args={[0.18, 0.06, 0.02]} />
        <meshStandardMaterial color="#FFFFFF" emissive="#FFFFFF" emissiveIntensity={0.35} />
      </mesh>
      {/* 左臂 */}
      <mesh position={[-0.28, torsoY - 0.05, 0]}>
        <boxGeometry args={[0.12, 0.42, 0.18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isSelected ? 0.5 : 0.12} />
      </mesh>
      {/* 右臂 */}
      <mesh position={[0.28, torsoY - 0.05, 0]}>
        <boxGeometry args={[0.12, 0.42, 0.18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isSelected ? 0.5 : 0.12} />
      </mesh>
      {/* 颈 */}
      <mesh position={[0, torsoY + 0.31, 0]}>
        <boxGeometry args={[0.14, 0.1, 0.14]} />
        <meshStandardMaterial color={skin} roughness={0.6} />
      </mesh>
      {/* 头 (chibi 大头) */}
      <mesh position={[0, headY, 0]}>
        <boxGeometry args={[0.36, 0.32, 0.32]} />
        <meshStandardMaterial color={skin} roughness={0.6} />
      </mesh>
      {/* 头发顶盖 */}
      <mesh position={[0, headY + 0.12, 0]}>
        <boxGeometry args={[0.38, 0.12, 0.34]} />
        <meshStandardMaterial color={hairColor} roughness={0.7} />
      </mesh>
      {/* 眼 (左右两小方块) */}
      <mesh position={[-0.08, headY + 0.02, 0.165]}>
        <boxGeometry args={[0.05, 0.05, 0.01]} />
        <meshBasicMaterial color="#1f1d1a" toneMapped={false} />
      </mesh>
      <mesh position={[0.08, headY + 0.02, 0.165]}>
        <boxGeometry args={[0.05, 0.05, 0.01]} />
        <meshBasicMaterial color="#1f1d1a" toneMapped={false} />
      </mesh>
      {/* 选中圈 */}
      {isSelected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.66, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.85} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/* ───────────── EmployeeFigure (桌椅 + 体素小人 + 名牌) ───────────── */
function EmployeeFigure({ employee, position }: { employee: Employee; position: [number, number, number] }) {
  const selectedEmployee = useAppStore((s) => s.selectedEmployee);
  const setSelectedEmployee = useAppStore((s) => s.setSelectedEmployee);
  const isSelected = selectedEmployee?.id === employee.id;
  const color = STATUS_COLOR[employee.status] ?? '#0F70B7';
  const h = hashCode(employee.id);
  const skin = SKIN_TONES[h % SKIN_TONES.length];
  const hairColor = ROLE_HAIR[employee.zone] ?? '#2A2723';

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
      {/* 显示器框 */}
      <mesh position={[0, 0.95, -0.35]}>
        <boxGeometry args={[0.95, 0.6, 0.04]} />
        <meshStandardMaterial color="#1f1d1a" metalness={0.4} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.95, -0.33]}>
        <planeGeometry args={[0.86, 0.5]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.62, -0.35]}>
        <boxGeometry args={[0.08, 0.2, 0.04]} />
        <meshStandardMaterial color="#1f1d1a" />
      </mesh>

      {/* 体素小人 */}
      <VoxelHuman
        position={[0, 0, 0.5]}
        color={color}
        isSelected={isSelected}
        hairColor={hairColor}
        skin={skin}
        onClick={(e) => { e.stopPropagation(); setSelectedEmployee(employee); }}
      />

      {/* 名字 */}
      <Text
        position={[0, 2.05, 0.5]}
        fontSize={0.18}
        color={isSelected ? color : '#dcdcd0'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.008}
        outlineColor="#1A1B1E"
      >
        {employee.name}
      </Text>
    </group>
  );
}

/* ───────────── 空工位（占位桌） ───────────── */
function EmptyDeskCluster({ positions }: { positions: [number, number, number][] }) {
  if (positions.length === 0) return null;
  return (
    <group>
      <Instances limit={positions.length} range={positions.length}>
        <boxGeometry args={[1.4, 0.06, 0.8]} />
        <meshStandardMaterial color="#3a3a36" metalness={0.3} roughness={0.6} />
        {positions.map((p, i) => (
          <Instance key={i} position={[p[0], p[1] + 0.45, p[2] - 0.1]} />
        ))}
      </Instances>
    </group>
  );
}

/* ───────────── 招聘的市场员工 → 临时工位（沿 rest zone 旁排开） ───────────── */
function HiredFigures({ hiredIds }: { hiredIds: string[] }) {
  const hired = marketEmployees.filter((m) => hiredIds.includes(m.id));
  if (hired.length === 0) return null;
  return (
    <>
      {hired.map((m, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        // 新员工临时排在「过渡区 / 休息区」外侧
        const pos: [number, number, number] = [3 + col * 2.2, 0.02, 8 + row * 2.2];
        return (
          <group key={m.id} position={pos}>
            {/* 简单桌 */}
            <mesh position={[0, 0.45, -0.1]}>
              <boxGeometry args={[1.4, 0.06, 0.8]} />
              <meshStandardMaterial color="#5a5a55" roughness={0.45} />
            </mesh>
            {/* 体素小人 (用 marketEmployee color 作为上衣) */}
            <VoxelHuman
              position={[0, 0, 0.4]}
              color={m.color}
              isSelected={false}
              hairColor="#2A2723"
              skin={SKIN_TONES[hashCode(m.id) % SKIN_TONES.length]}
              onClick={(e) => { e.stopPropagation(); }}
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

export default function Workstations() {
  const empById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), []);
  const occupied = workstations.filter((w) => w.employeeId);
  const empty = workstations.filter((w) => !w.employeeId);
  const emptyPositions: [number, number, number][] = empty.map((w) => getPos3D(w));

  // 招聘自市场的员工 id（localStorage）
  const [hiredIds, setHiredIds] = useState<string[]>([]);
  useEffect(() => {
    const read = () => {
      const m = JSON.parse(localStorage.getItem('hummer-marketplace-hires') ?? '{}');
      setHiredIds(Object.keys(m).filter((k) => m[k]));
    };
    read();
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'hummer-marketplace-hires') read();
    };
    window.addEventListener('storage', onStorage);
    // 同 tab 不会触发，做轮询
    const id = setInterval(read, 4000);
    return () => { window.removeEventListener('storage', onStorage); clearInterval(id); };
  }, []);

  return (
    <group>
      {occupied.map((ws) => {
        const emp = empById[ws.employeeId!];
        if (!emp) return null;
        const pos = getPos3D(ws);
        return <EmployeeFigure key={ws.id} employee={emp} position={pos} />;
      })}
      <EmptyDeskCluster positions={emptyPositions} />
      <HiredFigures hiredIds={hiredIds} />
    </group>
  );
}
