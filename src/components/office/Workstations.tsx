/**
 * Workstations (v10) · 真实现代办公家具
 * - 槽位系统（scenePositions.WS_SLOTS）：网格化布局 + 朝向 + 家具变体
 * - 变体：desk 木纹办公桌 / exec 老板桌 / table 会议圆桌 / lounge 沙发 / pod 训练舱
 * - 人物面向镜头，桌子在人物身前；桌前缘状态 LED 灯带承载状态色
 * - 名牌仅在选中或分区聚焦时显示（降噪）
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { RoundedBox, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { workstations } from '../../data/workstations';
import { employees } from '../../data/employees';
import { marketEmployees } from '../../data/marketplace';
import { useAppStore } from '../../store/useAppStore';
import { resolveSlot, type SlotVariant } from './scenePositions';
import VoxelHuman, { AGENT_LOOKS, TRAINEE_LOOK, STATUS_COLOR, hashCode, type FigureLook } from './VoxelHuman';
import { getWoodTexture } from './textures';
import { useAutoShadows } from './useAutoShadows';
import type { Employee } from '../../lib/types';

export const HIRES_CHANGED_EVENT = 'hummer-hires-changed';

const SKIN_TONES = ['#F5D7B5', '#EBC094', '#D4A276'];
const WOOD = '#D4B489';
const WOOD_DARK = '#96754F';
const METAL_DARK = '#2A2F38';
const FABRIC = '#5C6577';

const FALLBACK_LOOK: FigureLook = {
  outfit: '#0F70B7', hair: 'neat', hairColor: '#2A2723', accessories: [], build: 'default',
};

/* ───────────── 现代办公桌（木纹面 + 白侧板 + 显示器 + 键盘 + 状态灯带） ───────────── */
function ModernDesk({ statusColor, screenMatRef, dim }: {
  statusColor?: string;
  screenMatRef?: React.RefObject<THREE.MeshBasicMaterial>;
  dim?: boolean;
}) {
  return (
    <group>
      {/* 桌面（木纹 + 圆角） */}
      <RoundedBox args={[1.5, 0.05, 0.7]} radius={0.018} smoothness={2} position={[0, 0.72, 0.75]}>
        <meshStandardMaterial map={getWoodTexture()} color={dim ? '#B09C7E' : '#E8D4B2'} roughness={0.55} metalness={0.05} />
      </RoundedBox>
      {/* 侧板腿 */}
      <mesh position={[-0.68, 0.36, 0.75]}>
        <boxGeometry args={[0.05, 0.7, 0.6]} />
        <meshStandardMaterial color="#D8DBE0" roughness={0.5} metalness={0.15} />
      </mesh>
      <mesh position={[0.68, 0.36, 0.75]}>
        <boxGeometry args={[0.05, 0.7, 0.6]} />
        <meshStandardMaterial color="#D8DBE0" roughness={0.5} metalness={0.15} />
      </mesh>
      {/* 显示器（屏幕面向人物；镜头看到背板 + 顶部散热缝光） */}
      <mesh position={[0, 0.83, 0.95]}>
        <cylinderGeometry args={[0.09, 0.13, 0.02, 8]} />
        <meshStandardMaterial color={METAL_DARK} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.92, 0.95]}>
        <cylinderGeometry args={[0.025, 0.025, 0.18, 6]} />
        <meshStandardMaterial color={METAL_DARK} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.12, 0.94]}>
        <boxGeometry args={[0.8, 0.44, 0.035]} />
        <meshStandardMaterial color="#252A33" metalness={0.4} roughness={0.35} />
      </mesh>
      {/* 屏幕（朝 -z 即人物侧） */}
      <mesh position={[0, 1.12, 0.918]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.74, 0.38]} />
        <meshBasicMaterial ref={screenMatRef} color={dim ? '#2A3140' : '#9FC3EF'} toneMapped={false} />
      </mesh>
      {/* 显示器顶部散热缝光（镜头可见的科技细节） */}
      {!dim && (
        <mesh position={[0, 1.335, 0.94]}>
          <boxGeometry args={[0.78, 0.015, 0.02]} />
          <meshBasicMaterial color="#7FA8DF" transparent opacity={0.5} toneMapped={false} />
        </mesh>
      )}
      {/* 键盘 + 鼠标 */}
      <mesh position={[0.02, 0.755, 0.52]}>
        <boxGeometry args={[0.46, 0.02, 0.15]} />
        <meshStandardMaterial color={METAL_DARK} roughness={0.5} />
      </mesh>
      <mesh position={[0.36, 0.755, 0.55]}>
        <boxGeometry args={[0.07, 0.02, 0.11]} />
        <meshStandardMaterial color={METAL_DARK} roughness={0.5} />
      </mesh>
      {/* 桌前缘状态 LED 灯带（面向镜头） */}
      <mesh position={[0, 0.705, 1.105]}>
        <boxGeometry args={[1.5, 0.028, 0.015]} />
        <meshBasicMaterial
          color={statusColor ?? '#39404E'}
          transparent
          opacity={statusColor ? 0.95 : 0.4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/* ───────────── 人体工学椅 ───────────── */
function OfficeChair({ z = -0.28 }: { z?: number }) {
  return (
    <group position={[0, 0, z]}>
      <RoundedBox args={[0.48, 0.09, 0.46]} radius={0.03} smoothness={2} position={[0, 0.5, 0]}>
        <meshStandardMaterial color="#353B47" roughness={0.75} />
      </RoundedBox>
      <RoundedBox args={[0.46, 0.62, 0.07]} radius={0.03} smoothness={2} position={[0, 0.88, -0.22]} rotation={[-0.08, 0, 0]}>
        <meshStandardMaterial color="#353B47" roughness={0.75} />
      </RoundedBox>
      {/* 扶手 */}
      <mesh position={[-0.24, 0.65, -0.04]}>
        <boxGeometry args={[0.04, 0.05, 0.3]} />
        <meshStandardMaterial color="#2A2F38" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0.24, 0.65, -0.04]}>
        <boxGeometry args={[0.04, 0.05, 0.3]} />
        <meshStandardMaterial color="#2A2F38" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.36, 6]} />
        <meshStandardMaterial color="#4A505C" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.26, 0.26, 0.025, 10]} />
        <meshStandardMaterial color="#3A404C" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

/* ───────────── 老板桌（加宽胡桃木 + 双显示器 + 台灯 + 地毯） ───────────── */
function ExecDesk({ statusColor, screenMatRef }: {
  statusColor?: string;
  screenMatRef?: React.RefObject<THREE.MeshBasicMaterial>;
}) {
  return (
    <group>
      {/* 区域地毯 */}
      <mesh position={[0, 0.006, 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.4, 2.6]} />
        <meshStandardMaterial color="#2B3040" roughness={0.95} />
      </mesh>
      {/* 桌面（深色胡桃木纹 + 圆角） */}
      <RoundedBox args={[2.3, 0.07, 0.95]} radius={0.02} smoothness={2} position={[0, 0.74, 0.8]}>
        <meshStandardMaterial map={getWoodTexture('#96754F', '#6E5236', 'walnut')} color="#C9A87E" roughness={0.45} metalness={0.08} />
      </RoundedBox>
      {/* 前挡板 */}
      <mesh position={[0, 0.42, 1.1]}>
        <boxGeometry args={[2.3, 0.6, 0.05]} />
        <meshStandardMaterial map={getWoodTexture('#96754F', '#6E5236', 'walnut')} color="#A88B62" roughness={0.55} />
      </mesh>
      {/* 腿 */}
      <mesh position={[-1.05, 0.36, 0.8]}>
        <boxGeometry args={[0.08, 0.72, 0.8]} />
        <meshStandardMaterial color={METAL_DARK} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[1.05, 0.36, 0.8]}>
        <boxGeometry args={[0.08, 0.72, 0.8]} />
        <meshStandardMaterial color={METAL_DARK} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* 双显示器 */}
      {[-0.46, 0.46].map((x, i) => (
        <group key={i} position={[x, 0, 0]} rotation={[0, i === 0 ? 0.28 : -0.28, 0]}>
          <mesh position={[0, 1.18, 1.0]}>
            <boxGeometry args={[0.78, 0.46, 0.035]} />
            <meshStandardMaterial color="#252A33" metalness={0.4} roughness={0.35} />
          </mesh>
          <mesh position={[0, 1.18, 0.978]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[0.72, 0.4]} />
            <meshBasicMaterial ref={i === 0 ? screenMatRef : undefined} color="#9FC3EF" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.9, 1.0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.24, 6]} />
            <meshStandardMaterial color={METAL_DARK} />
          </mesh>
        </group>
      ))}
      {/* 黄铜台灯 */}
      <mesh position={[0.95, 0.92, 0.7]}>
        <cylinderGeometry args={[0.015, 0.015, 0.3, 6]} />
        <meshStandardMaterial color="#B9975B" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0.88, 1.06, 0.7]} rotation={[0, 0, 0.7]}>
        <cylinderGeometry args={[0.05, 0.08, 0.12, 8]} />
        <meshStandardMaterial color="#B9975B" metalness={0.8} roughness={0.25} emissive="#FFE9BE" emissiveIntensity={0.6} />
      </mesh>
      {/* 状态 LED */}
      <mesh position={[0, 0.72, 1.28]}>
        <boxGeometry args={[2.3, 0.03, 0.015]} />
        <meshBasicMaterial color={statusColor ?? '#39404E'} transparent opacity={0.95} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ───────────── 会议圆桌（含全息投影 + 空椅） ───────────── */
function MeetingTable() {
  const holoRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (holoRef.current) holoRef.current.rotation.y = clock.elapsedTime * 0.5;
  });
  return (
    <group>
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[1.15, 1.15, 0.06, 32]} />
        <meshStandardMaterial map={getWoodTexture()} color="#E8D4B2" roughness={0.5} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.66, 8]} />
        <meshStandardMaterial color={METAL_DARK} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.5, 0.55, 0.05, 16]} />
        <meshStandardMaterial color={METAL_DARK} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* 全息投影台 + 旋转全息环 */}
      <mesh position={[0, 0.78, 0]}>
        <cylinderGeometry args={[0.14, 0.16, 0.05, 10]} />
        <meshStandardMaterial color="#1A2030" metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh ref={holoRef} position={[0, 1.25, 0]}>
        <torusGeometry args={[0.28, 0.015, 8, 32]} />
        <meshBasicMaterial color="#B07CF0" transparent opacity={0.7} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.05, 0]}>
        <cylinderGeometry args={[0.05, 0.3, 0.55, 12, 1, true]} />
        <meshBasicMaterial color="#B07CF0" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* 椅子：两个与会位（±x）+ 三把空椅 */}
      {[0, Math.PI, Math.PI * 0.5, Math.PI * 1.3, Math.PI * 1.7].map((a, i) => (
        <group key={i} position={[Math.cos(a) * 1.7, 0, Math.sin(a) * 1.7]} rotation={[0, -a - Math.PI / 2, 0]}>
          <OfficeChair z={0} />
        </group>
      ))}
    </group>
  );
}

/* ───────────── 休息区沙发组 ───────────── */
function LoungeSofa() {
  return (
    <group>
      <mesh position={[0, 0.005, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.7, 24]} />
        <meshStandardMaterial color="#31281F" roughness={0.95} />
      </mesh>
      {/* 沙发（圆角软包 + 坐垫分块） */}
      <group position={[0, 0, -0.5]}>
        <RoundedBox args={[1.7, 0.32, 0.68]} radius={0.06} smoothness={3} position={[0, 0.3, 0]}>
          <meshStandardMaterial color={FABRIC} roughness={0.95} />
        </RoundedBox>
        {[-0.42, 0.42].map((x) => (
          <RoundedBox key={x} args={[0.78, 0.1, 0.6]} radius={0.04} smoothness={3} position={[x, 0.49, 0.02]}>
            <meshStandardMaterial color="#677185" roughness={0.95} />
          </RoundedBox>
        ))}
        <RoundedBox args={[1.7, 0.5, 0.16]} radius={0.06} smoothness={3} position={[0, 0.62, -0.28]}>
          <meshStandardMaterial color={FABRIC} roughness={0.95} />
        </RoundedBox>
        <RoundedBox args={[0.16, 0.44, 0.68]} radius={0.05} smoothness={3} position={[-0.84, 0.48, 0]}>
          <meshStandardMaterial color={FABRIC} roughness={0.95} />
        </RoundedBox>
        <RoundedBox args={[0.16, 0.44, 0.68]} radius={0.05} smoothness={3} position={[0.84, 0.48, 0]}>
          <meshStandardMaterial color={FABRIC} roughness={0.95} />
        </RoundedBox>
      </group>
      {/* 茶几 */}
      <mesh position={[0, 0.3, 0.6]}>
        <cylinderGeometry args={[0.4, 0.4, 0.04, 16]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.15, 0.6]}>
        <cylinderGeometry args={[0.04, 0.04, 0.28, 6]} />
        <meshStandardMaterial color={METAL_DARK} metalness={0.6} />
      </mesh>
    </group>
  );
}

/* ───────────── 训练舱（充电进化区） ───────────── */
function TrainingPod() {
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (ringMat.current) ringMat.current.opacity = 0.4 + 0.25 * Math.sin(clock.elapsedTime * 2);
  });
  return (
    <group>
      {/* 发光基座圆环 */}
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.75, 0.92, 32]} />
        <meshBasicMaterial ref={ringMat} color="#46C68A" transparent opacity={0.5} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.75, 0.78, 0.06, 24]} />
        <meshStandardMaterial color="#232B38" metalness={0.4} roughness={0.5} emissive="#46C68A" emissiveIntensity={0.06} />
      </mesh>
      {/* 弧形背板 */}
      <mesh position={[0, 1.1, -0.55]}>
        <cylinderGeometry args={[0.85, 0.85, 2.1, 16, 1, true, Math.PI * 0.7, Math.PI * 0.6]} />
        <meshStandardMaterial color="#2A3242" metalness={0.4} roughness={0.5} side={THREE.DoubleSide} emissive="#46C68A" emissiveIntensity={0.08} />
      </mesh>
    </group>
  );
}

/* ───────────── EmployeeFigure：按槽位变体组装 ───────────── */
const EmployeeFigure = memo(function EmployeeFigure({
  employee, pos, rotY, variant,
}: { employee: Employee; pos: [number, number, number]; rotY: number; variant: SlotVariant }) {
  const isSelected = useAppStore((s) => s.selectedEmployee?.id === employee.id);
  const zoneFocused = useAppStore((s) => s.activeZone === employee.zone);
  const setSelectedEmployee = useAppStore((s) => s.setSelectedEmployee);
  const look = AGENT_LOOKS[employee.id] ?? FALLBACK_LOOK;
  const skin = SKIN_TONES[hashCode(employee.id) % SKIN_TONES.length];
  const screenMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const statusColor = STATUS_COLOR[employee.status];
  const showName = isSelected || zoneFocused;

  return (
    <group position={pos} rotation={[0, rotY, 0]} scale={1.12}>
      {variant === 'desk' && (
        <>
          <ModernDesk statusColor={statusColor} screenMatRef={screenMatRef} />
          <OfficeChair />
        </>
      )}
      {variant === 'exec' && (
        <>
          <ExecDesk statusColor={statusColor} screenMatRef={screenMatRef} />
          <OfficeChair z={-0.3} />
        </>
      )}
      {variant === 'lounge' && <LoungeSofa />}
      {variant === 'pod' && <TrainingPod />}
      {/* table 变体的圆桌由 Workstations 在分区中心渲染一次 */}

      {/* 体素小人（面向 +z；table/lounge 由槽位 rotY 决定朝向） */}
      <VoxelHuman
        position={variant === 'lounge' ? [0.6, 0, 0.5] : [0, 0, 0]}
        look={look}
        status={employee.status}
        isSelected={isSelected}
        seed={employee.id}
        skin={skin}
        screenMatRef={variant === 'desk' || variant === 'exec' ? screenMatRef : undefined}
        screenBaseColor="#9FC3EF"
        onClick={(e) => { e.stopPropagation(); setSelectedEmployee(employee); }}
      />

      {/* 名牌：仅选中 / 分区聚焦时显示（降噪） */}
      {showName && (
        <Text
          position={variant === 'lounge' ? [0.6, 2.1, 0.5] : [0, 2.1, 0]}
          fontSize={0.16}
          color={isSelected ? '#FFFFFF' : '#B8C2D4'}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.01}
          outlineColor="#10151F"
        >
          {employee.name}
        </Text>
      )}
    </group>
  );
});

/* ───────────── 空工位（简化桌 + 暗显示器） ───────────── */
function EmptyDesk({ pos, rotY }: { pos: [number, number, number]; rotY: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]} scale={1.12}>
      <ModernDesk dim />
      <OfficeChair />
    </group>
  );
}

/* ───────────── 沙箱试岗区（市场招聘员工） ───────────── */
function SandboxAnnex({ hiredIds }: { hiredIds: string[] }) {
  const hired = marketEmployees.filter((m) => hiredIds.includes(m.id));
  if (hired.length === 0) return null;
  return (
    <group position={[0, 0, 10.2]}>
      {/* 试岗区地毯 */}
      <mesh position={[0, 0.008, 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.max(5.6, hired.length * 2.4), 3]} />
        <meshStandardMaterial color="#2A2820" roughness={0.95} emissive="#E8A33D" emissiveIntensity={0.02} />
      </mesh>
      <mesh position={[0, 0.012, 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.max(5.72, hired.length * 2.4 + 0.12), 3.12]} />
        <meshBasicMaterial color="#E8A33D" transparent opacity={0.12} toneMapped={false} />
      </mesh>
      <Text position={[0, 0.03, 1.6]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.24} color="#E8A33D" anchorX="center" anchorY="middle">
        沙箱 · 试岗区
      </Text>
      {hired.map((m, i) => {
        const x = (i - (hired.length - 1) / 2) * 2.4;
        const look: FigureLook = { ...TRAINEE_LOOK, outfit: m.color };
        return (
          <group key={m.id} position={[x, 0.02, 0]} scale={1.12}>
            <ModernDesk statusColor="#0F766E" />
            <OfficeChair />
            <VoxelHuman
              position={[0, 0, 0]}
              look={look}
              status="training"
              isSelected={false}
              seed={m.id}
              skin={SKIN_TONES[hashCode(m.id) % SKIN_TONES.length]}
            />
            <Text position={[0, 2.1, 0]} fontSize={0.15} color="#E8A33D" anchorX="center" anchorY="middle" outlineWidth={0.01} outlineColor="#10151F">
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

  // 招聘自市场的员工 id：storage 事件（跨 tab）+ 自定义事件（同 tab）
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

  // 全树自动阴影（招聘变化后重新标记）
  const rootRef = useAutoShadows([hiredIds]);

  return (
    <group ref={rootRef}>
      {slots.map(({ ws, slot }) => {
        const emp = ws.employeeId ? empById[ws.employeeId] : null;
        if (emp) {
          return <EmployeeFigure key={ws.id} employee={emp} pos={slot.pos} rotY={slot.rotY} variant={slot.variant} />;
        }
        // 空槽位：桌位画空桌，站立/沙发/舱位留白
        if (slot.variant === 'desk') {
          return <EmptyDesk key={ws.id} pos={slot.pos} rotY={slot.rotY} />;
        }
        return null;
      })}
      {/* 会议圆桌（渲染一次，与会者槽位绕桌分布） */}
      <group position={[6.5, 0.06, 4]}>
        <MeetingTable />
      </group>
      <SandboxAnnex hiredIds={hiredIds} />
    </group>
  );
}
