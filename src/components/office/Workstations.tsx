/**
 * Workstations v14 · SYBERNETIC HQ 1:1
 * - 岛式工位 Pod：整体桌岛（基座缝光 + 台面霓虹缘 + 中脊隔板）+ 2排×4席对坐 + 人手全息屏
 * - 高管台 / 会议舱圆桌（中央全息投影）/ 休闲沙发组 / 健身角（跑步机充电）
 * - 人物：坐姿体素小人（状态动作保留），名牌仅选中/分区聚焦显示
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { workstations } from '../../data/workstations';
import { employees } from '../../data/employees';
import { marketEmployees } from '../../data/marketplace';
import { useAppStore } from '../../store/useAppStore';
import { resolveSlot, PODS, seatLocal, type SlotVariant, type PodDef } from './scenePositions';
import VoxelHuman, { AGENT_LOOKS, TRAINEE_LOOK, hashCode, type FigureLook } from './VoxelHuman';
import { NEON, HoloScreen, GlowPlane } from './neon';
import { useAutoShadows } from './useAutoShadows';
import type { Employee } from '../../lib/types';

export const HIRES_CHANGED_EVENT = 'hummer-hires-changed';

const SKIN_TONES = ['#F5D7B5', '#EBC094', '#D4A276'];
const CHAIR = '#20262F';
const ISLAND = '#232B38';
const ISLAND_TOP = '#2A3342';
const ISLAND_DARK = '#171D28';

const FALLBACK_LOOK: FigureLook = {
  outfit: '#2B3038', hair: 'neat', hairColor: '#2A2723', accessories: [], build: 'default',
};

const HOLO_KINDS = ['dashboard', 'chart', 'rings', 'dashboard'] as const;

/* ───────────── 科幻办公椅 ───────────── */
function SciChair(props: JSX.IntrinsicElements['group']) {
  return (
    <group {...props}>
      <mesh position={[0, 0.48, -0.1]}>
        <boxGeometry args={[0.5, 0.07, 0.5]} />
        <meshStandardMaterial color={CHAIR} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.85, -0.38]} rotation={[-0.08, 0, 0]}>
        <boxGeometry args={[0.48, 0.62, 0.06]} />
        <meshStandardMaterial color={CHAIR} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.3, -0.1]}>
        <cylinderGeometry args={[0.03, 0.03, 0.32, 6]} />
        <meshStandardMaterial color="#3A424E" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.13, -0.1]}>
        <cylinderGeometry args={[0.26, 0.28, 0.025, 10]} />
        <meshStandardMaterial color="#2A303A" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

/* ───────────── 办公岛（4.6×2 · 8 席） ───────────── */
function PodIsland({ pod }: { pod: PodDef }) {
  return (
    <group position={[pod.center[0], pod.y, pod.center[1]]} rotation={[0, pod.rotY, 0]}>
      {/* 基座缝光 */}
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[4.4, 0.12, 1.8]} />
        <meshStandardMaterial color={ISLAND_DARK} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.11, 0]}>
        <boxGeometry args={[4.42, 0.015, 1.82]} />
        <meshBasicMaterial color={NEON} transparent opacity={0.5} toneMapped={false} />
      </mesh>
      {/* 桌体 */}
      <mesh position={[0, 0.44, 0]}>
        <boxGeometry args={[4.6, 0.62, 2.0]} />
        <meshStandardMaterial color={ISLAND} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* 台面板（悬挑） */}
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[4.7, 0.06, 2.15]} />
        <meshStandardMaterial color={ISLAND_TOP} roughness={0.4} metalness={0.35} />
      </mesh>
      {/* 台面霓虹缘 ×2 */}
      <mesh position={[0, 0.81, 1.06]}>
        <boxGeometry args={[4.68, 0.02, 0.02]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.81, -1.06]}>
        <boxGeometry args={[4.68, 0.02, 0.02]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      {/* 中脊隔板 + 槽灯 */}
      <mesh position={[0, 0.96, 0]}>
        <boxGeometry args={[4.6, 0.34, 0.12]} />
        <meshStandardMaterial color="#1E252F" roughness={0.45} metalness={0.35} />
      </mesh>
      {[-1.4, 0, 1.4].map((x) => (
        <mesh key={x} position={[x, 0.99, 0]}>
          <boxGeometry args={[0.7, 0.02, 0.14]} />
          <meshBasicMaterial color={NEON} transparent opacity={0.7} toneMapped={false} />
        </mesh>
      ))}
      {/* 8 席椅子（含空位）+ 键盘 */}
      {Array.from({ length: 8 }, (_, seat) => {
        const { dx, dz, rotY } = seatLocal(seat);
        return (
          <group key={seat} position={[dx, 0, dz]} rotation={[0, rotY, 0]}>
            <SciChair position={[0, 0, -0.32]} />
            {/* 键盘（台面上，靠人一侧） */}
            <mesh position={[0, 0.825, 0.62]}>
              <boxGeometry args={[0.32, 0.02, 0.12]} />
              <meshStandardMaterial color="#12161D" roughness={0.5} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ───────────── 高管控制台（夹层） ───────────── */
function ExecConsole() {
  return (
    <group>
      {/* 桌板 + 侧板腿 + 前挡板霓虹 */}
      <mesh position={[0, 0.78, 0.75]}>
        <boxGeometry args={[3.4, 0.08, 1.3]} />
        <meshStandardMaterial color={ISLAND_TOP} roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh position={[-1.55, 0.38, 0.75]}>
        <boxGeometry args={[0.12, 0.76, 1.1]} />
        <meshStandardMaterial color={ISLAND_DARK} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[1.55, 0.38, 0.75]}>
        <boxGeometry args={[0.12, 0.76, 1.1]} />
        <meshStandardMaterial color={ISLAND_DARK} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.42, 1.38]}>
        <boxGeometry args={[3.4, 0.72, 0.06]} />
        <meshStandardMaterial color={ISLAND} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.76, 1.42]}>
        <boxGeometry args={[3.3, 0.025, 0.02]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      {/* 大全息屏 */}
      <HoloScreen w={1.75} h={0.95} kind="dashboard" seed={11} tilt={-0.12} position={[0, 1.45, 0.55]} />
      <GlowPlane size={[2.4, 1.4]} color={NEON} opacity={0.15} position={[0, 1.4, 0.5]} />
      {/* 高背椅 */}
      <group position={[0, 0, 0]}>
        <mesh position={[0, 0.5, -0.15]}>
          <boxGeometry args={[0.55, 0.08, 0.52]} />
          <meshStandardMaterial color="#12161D" roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.05, -0.45]} rotation={[-0.06, 0, 0]}>
          <boxGeometry args={[0.55, 1.05, 0.08]} />
          <meshStandardMaterial color="#12161D" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.28, -0.15]}>
          <cylinderGeometry args={[0.035, 0.035, 0.3, 6]} />
          <meshStandardMaterial color="#3A424E" metalness={0.7} roughness={0.3} />
        </mesh>
      </group>
      {/* 背柜 + 暖光台灯 */}
      <mesh position={[0.4, 0.45, -1.5]}>
        <boxGeometry args={[2.6, 0.9, 0.5]} />
        <meshStandardMaterial color={ISLAND} roughness={0.5} metalness={0.3} />
      </mesh>
      <pointLight position={[1.2, 1.2, -1.4]} intensity={2.2} distance={4} decay={2} color="#D9A05B" />
    </group>
  );
}

/* ───────────── 会议圆桌（中央全息投影） ───────────── */
function ConferenceSet() {
  const holoRing = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (holoRing.current) holoRing.current.rotation.z = clock.elapsedTime * 0.4;
  });
  // 空椅（避开门口 200°-270° 和两个与会者 20°/160°）
  const emptyAngles = [60, 110, 300, 340];
  return (
    <group position={[3.5, 0.53, 3.5]}>
      {/* 圆桌 */}
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[1.5, 1.5, 0.1, 32]} />
        <meshStandardMaterial color="#1B222E" roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.5, 0.6, 0.72, 16]} />
        <meshStandardMaterial color={ISLAND_DARK} metalness={0.5} roughness={0.4} />
      </mesh>
      {/* 台面同心全息环 */}
      {[0.35, 0.7, 1.05, 1.35].map((r, i) => (
        <mesh key={r} position={[0, 0.78, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r - 0.025, r + 0.025, 48]} />
          <meshBasicMaterial color="#4DD8FF" transparent opacity={0.7 - i * 0.13} toneMapped={false} />
        </mesh>
      ))}
      {/* 全息投影：光锥 + 旋转环 + 核心 */}
      <mesh position={[0, 1.16, 0]}>
        <cylinderGeometry args={[0.6, 0.06, 0.7, 24, 1, true]} />
        <meshBasicMaterial color="#4DD8FF" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={holoRing} position={[0, 1.38, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.55, 0.02, 8, 48]} />
        <meshBasicMaterial color="#9FE8FF" toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.4, 0]}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshBasicMaterial color="#B5ECFF" toneMapped={false} />
      </mesh>
      <GlowPlane size={[1.6, 1.6]} color="#4DD8FF" opacity={0.3} position={[0, 1.35, 0]} />
      {/* 空椅 */}
      {emptyAngles.map((deg) => {
        const a = (deg * Math.PI) / 180;
        const x = Math.cos(a) * 2.15;
        const z = Math.sin(a) * 2.15;
        return (
          <group key={deg} position={[x, -0.08, z]} rotation={[0, Math.atan2(-x, -z), 0]}>
            <SciChair />
          </group>
        );
      })}
    </group>
  );
}

/* ───────────── 休闲沙发组 ───────────── */
function SofaBlock({ width = 2.3, ...props }: { width?: number } & JSX.IntrinsicElements['group']) {
  return (
    <group {...props}>
      <mesh position={[0, 0.24, 0]}>
        <boxGeometry args={[width, 0.42, 0.95]} />
        <meshStandardMaterial color="#232A35" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.62, -0.38]}>
        <boxGeometry args={[width, 0.55, 0.22]} />
        <meshStandardMaterial color="#232A35" roughness={0.9} />
      </mesh>
      <mesh position={[-width / 2 + 0.1, 0.5, 0]}>
        <boxGeometry args={[0.2, 0.55, 0.95]} />
        <meshStandardMaterial color="#1D2430" roughness={0.9} />
      </mesh>
      <mesh position={[width / 2 - 0.1, 0.5, 0]}>
        <boxGeometry args={[0.2, 0.55, 0.95]} />
        <meshStandardMaterial color="#1D2430" roughness={0.9} />
      </mesh>
    </group>
  );
}

function LoungeSet() {
  return (
    <group position={[0, 0.35, 0]}>
      {/* 对坐沙发 ×2 */}
      <SofaBlock position={[10.6, 0, 2.2]} rotation={[0, Math.PI / 2, 0]} />
      <SofaBlock position={[14.4, 0, 2.2]} rotation={[0, -Math.PI / 2, 0]} />
      {/* 单人扶手椅 ×2（面向电视墙） */}
      <SofaBlock width={1.1} position={[11.6, 0, 5.0]} rotation={[0, Math.PI, 0]} />
      <SofaBlock width={1.1} position={[13.4, 0, 5.0]} rotation={[0, Math.PI, 0]} />
      {/* 茶几（玻璃面） */}
      <mesh position={[12.5, 0.36, 2.2]}>
        <boxGeometry args={[1.3, 0.05, 0.7]} />
        <meshStandardMaterial color="#A8E4F2" transparent opacity={0.22} roughness={0.1} metalness={0.2} />
      </mesh>
      <mesh position={[12.5, 0.18, 2.2]}>
        <boxGeometry args={[1.1, 0.32, 0.5]} />
        <meshStandardMaterial color={ISLAND_DARK} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[12.3, 0.43, 2.2]}>
        <cylinderGeometry args={[0.06, 0.06, 0.08, 8]} />
        <meshBasicMaterial color={NEON} transparent opacity={0.7} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ───────────── 跑步机（充电进化 · 数据官在此训练） ───────────── */
function Treadmill(props: JSX.IntrinsicElements['group']) {
  return (
    <group {...props}>
      <mesh position={[0, 0.09, 0.1]} rotation={[0.05, 0, 0]}>
        <boxGeometry args={[0.75, 0.14, 1.75]} />
        <meshStandardMaterial color="#1A2028" roughness={0.5} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.17, 0.12]} rotation={[0.05, 0, 0]}>
        <boxGeometry args={[0.6, 0.02, 1.6]} />
        <meshStandardMaterial color="#10141B" roughness={0.7} />
      </mesh>
      {/* 侧扶手 + 前控制台 */}
      {[-0.34, 0.34].map((x) => (
        <mesh key={x} position={[x, 0.7, -0.55]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.05, 0.05, 0.9]} />
          <meshStandardMaterial color="#3A424E" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      <group position={[0, 1.05, -0.92]}>
        <mesh rotation={[-0.3, 0, 0]}>
          <boxGeometry args={[0.6, 0.32, 0.06]} />
          <meshStandardMaterial color="#12161D" roughness={0.4} metalness={0.4} />
        </mesh>
        <mesh position={[0, 0.02, 0.04]} rotation={[-0.3, 0, 0]}>
          <planeGeometry args={[0.5, 0.22]} />
          <meshBasicMaterial color="#46C68A" transparent opacity={0.75} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function GymEquipment() {
  return (
    <group position={[0, -1.35, 0]}>
      {/* 哑铃架 */}
      <group position={[-12.4, 0, 7.4]} rotation={[0, -0.17, 0]}>
        {[-0.7, 0.7].map((x) => (
          <mesh key={x} position={[x, 0.55, 0]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[0.08, 1.1, 0.6]} />
            <meshStandardMaterial color="#262C36" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        {[0.35, 0.7, 1.05].map((y) => (
          <mesh key={y} position={[0, y, (1.05 - y) * 0.35]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.022, 0.022, 1.4, 6]} />
            <meshStandardMaterial color="#3A424E" metalness={0.6} roughness={0.3} />
          </mesh>
        ))}
        {Array.from({ length: 8 }, (_, i) => {
          const tier = i < 4 ? 0.35 : 0.7;
          const x = -0.5 + (i % 4) * 0.33;
          return (
            <group key={i} position={[x, tier + 0.07, (1.05 - tier) * 0.35]} rotation={[0, 0, Math.PI / 2]}>
              <mesh><cylinderGeometry args={[0.018, 0.018, 0.2, 6]} /><meshStandardMaterial color="#3A424E" metalness={0.5} /></mesh>
              <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[0.055, 0.055, 0.06, 8]} /><meshStandardMaterial color="#262C36" roughness={0.5} /></mesh>
              <mesh position={[0, -0.1, 0]}><cylinderGeometry args={[0.055, 0.055, 0.06, 8]} /><meshStandardMaterial color="#262C36" roughness={0.5} /></mesh>
            </group>
          );
        })}
      </group>
      {/* 训练凳 */}
      <group position={[-13.6, 0, 9.6]} rotation={[0, 0.3, 0]}>
        <mesh position={[0, 0.45, 0]}>
          <boxGeometry args={[1.1, 0.08, 0.35]} />
          <meshStandardMaterial color="#232A35" roughness={0.8} />
        </mesh>
        {[-0.45, 0.45].map((x) => (
          <mesh key={x} position={[x, 0.22, 0]}>
            <boxGeometry args={[0.06, 0.42, 0.3]} />
            <meshStandardMaterial color="#1A2028" metalness={0.4} roughness={0.5} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ───────────── EmployeeFigure：按槽位变体 ───────────── */
const EmployeeFigure = memo(function EmployeeFigure({
  employee, pos, rotY, variant,
}: { employee: Employee; pos: [number, number, number]; rotY: number; variant: SlotVariant }) {
  const isSelected = useAppStore((s) => s.selectedEmployee?.id === employee.id);
  const zoneFocused = useAppStore((s) => s.activeZone === employee.zone);
  const setSelectedEmployee = useAppStore((s) => s.setSelectedEmployee);
  const look = AGENT_LOOKS[employee.id] ?? FALLBACK_LOOK;
  const skin = SKIN_TONES[hashCode(employee.id) % SKIN_TONES.length];
  const showName = isSelected || zoneFocused;
  const seated = variant === 'desk' || variant === 'exec' || variant === 'table' || variant === 'lounge';
  const holoKind = HOLO_KINDS[hashCode(employee.id) % HOLO_KINDS.length];

  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {variant === 'exec' && <ExecConsole />}
      {variant === 'gym' && <Treadmill />}
      {/* 席位全息屏（工位席） */}
      {variant === 'desk' && (
        <group rotation={[0, Math.PI, 0]} position={[0, 0, 0.72]}>
          <HoloScreen w={0.58} h={0.42} kind={holoKind} seed={hashCode(employee.id) % 17} tilt={-0.24} position={[0, 1.18, 0]} />
        </group>
      )}
      <VoxelHuman
        position={[0, seated ? -0.06 : variant === 'gym' ? 0.16 : 0, 0]}
        look={look}
        status={employee.status}
        isSelected={isSelected}
        seed={employee.id}
        skin={skin}
        pose={seated ? 'sit' : 'stand'}
        onClick={(e) => { e.stopPropagation(); setSelectedEmployee(employee); }}
      />
      {showName && (
        <Text
          position={[0, 2.1, 0]}
          fontSize={0.16}
          color={isSelected ? '#FFFFFF' : '#B8C2D4'}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.01}
          outlineColor="#0A0F18"
        >
          {employee.name}
        </Text>
      )}
    </group>
  );
});

/* ───────────── 沙箱试岗区（下层甲板） ───────────── */
function SandboxAnnex({ hiredIds }: { hiredIds: string[] }) {
  const hired = marketEmployees.filter((m) => hiredIds.includes(m.id));
  if (hired.length === 0) return null;
  return (
    <group position={[5.5, -1.35, 10.8]}>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.max(6, hired.length * 2.4), 3.4]} />
        <meshStandardMaterial color="#1B222E" roughness={0.9} emissive="#E8A33D" emissiveIntensity={0.03} />
      </mesh>
      <Text position={[0, 0.03, 1.85]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.28} color="#E8A33D" anchorX="center" anchorY="middle" letterSpacing={0.12}>
        SANDBOX · TRIAL
      </Text>
      {hired.map((m, i) => {
        const x = (i - (hired.length - 1) / 2) * 2.4;
        const look: FigureLook = { ...TRAINEE_LOOK, outfit: m.color };
        return (
          <group key={m.id} position={[x, 0, 0]}>
            <SciChair position={[0, 0, -0.32]} />
            <group rotation={[0, Math.PI, 0]} position={[0, 0, 0.6]}>
              <HoloScreen w={0.58} h={0.42} kind="chart" seed={i + 21} tilt={-0.24} position={[0, 1.15, 0]} />
            </group>
            <VoxelHuman position={[0, -0.06, 0]} look={look} status="training" isSelected={false} seed={m.id} skin={SKIN_TONES[hashCode(m.id) % SKIN_TONES.length]} pose="sit" />
            <Text position={[0, 2.05, 0]} fontSize={0.15} color="#E8A33D" anchorX="center" anchorY="middle" outlineWidth={0.01} outlineColor="#0A0F18">
              {`${m.name} · 试岗中`}
            </Text>
          </group>
        );
      })}
    </group>
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
  const slots = useMemo(
    () => workstations
      .map((ws) => ({ ws, slot: resolveSlot(ws.id) }))
      .filter((x): x is { ws: typeof workstations[number]; slot: NonNullable<ReturnType<typeof resolveSlot>> } => !!x.slot),
    [],
  );

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

  const rootRef = useAutoShadows([hiredIds]);

  return (
    <group ref={rootRef}>
      {/* 办公岛 ×4（含全部椅子） */}
      {PODS.map((pod) => <PodIsland key={pod.id} pod={pod} />)}
      {/* 员工（各变体） */}
      {slots.map(({ ws, slot }) => {
        const emp = ws.employeeId ? empById[ws.employeeId] : null;
        if (!emp) return null;
        return <EmployeeFigure key={ws.id} employee={emp} pos={slot.pos} rotY={slot.rotY} variant={slot.variant} />;
      })}
      {/* 会议圆桌 + 休闲沙发组 + 健身器械 */}
      <ConferenceSet />
      <LoungeSet />
      <GymEquipment />
      <SandboxAnnex hiredIds={hiredIds} />
    </group>
  );
}
