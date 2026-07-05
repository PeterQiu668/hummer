/**
 * 体素小人 v9 · 人物鲜明感系统
 * - 每位 Agent 固定职业着装色（状态不再改衣服，改为脚下状态环 / 光效）
 * - 发型 / 配饰 / 体型按角色差异化
 * - 状态驱动动作（useFrame + refs，零 setState）：
 *   working=打字 · meeting=手势 · training=悬浮知识面板 · blocked=声呐告警 · idle=慢速摇摆
 */
import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, useCursor } from '@react-three/drei';
import * as THREE from 'three';
import type { EmployeeStatus } from '../../lib/types';

export const STATUS_COLOR: Record<EmployeeStatus, string> = {
  working: '#0F70B7', meeting: '#7E22CE', training: '#0F766E',
  blocked: '#C13D3D', idle: '#6B7280',
};

export type HairStyle =
  | 'neat' | 'flat-top' | 'side-part' | 'ponytail' | 'bob' | 'twin-buns'
  | 'bun-pen' | 'messy' | 'buzz' | 'beret' | 'cap' | 'wave';

export type Accessory =
  | 'glasses' | 'tie' | 'headset' | 'headset-dual' | 'badge'
  | 'hoodie' | 'sec-emblem' | 'tablet' | 'shoulder-pads';

export interface FigureLook {
  outfit: string;
  hair: HairStyle;
  hairColor: string;
  accessories: Accessory[];
  tieColor?: string;
  build: 'manager' | 'slim' | 'broad' | 'default';
}

/** 15 位数字员工的角色档案（key = employee.id） */
export const AGENT_LOOKS: Record<string, FigureLook> = {
  'emp-ceo':       { outfit: '#2B3040', hair: 'flat-top',  hairColor: '#1F1D1A', accessories: ['tie', 'shoulder-pads'], tieColor: '#D4AF37', build: 'manager' },
  'emp-sales-1':   { outfit: '#2563EB', hair: 'side-part', hairColor: '#2A2723', accessories: ['headset'], build: 'default' },
  'emp-ops':       { outfit: '#0EA5E9', hair: 'ponytail',  hairColor: '#553722', accessories: ['badge'], build: 'default' },
  'emp-finance':   { outfit: '#475569', hair: 'neat',      hairColor: '#3A2D24', accessories: ['glasses', 'tie'], tieColor: '#64748B', build: 'broad' },
  'emp-hr':        { outfit: '#DB7093', hair: 'bob',       hairColor: '#6B4FA0', accessories: ['badge'], build: 'slim' },
  'emp-legal':     { outfit: '#334155', hair: 'neat',      hairColor: '#1F1D1A', accessories: ['glasses'], build: 'default' },
  'emp-cs':        { outfit: '#14B8A6', hair: 'wave',      hairColor: '#553722', accessories: ['headset-dual'], build: 'default' },
  'emp-dev':       { outfit: '#3F3F46', hair: 'messy',     hairColor: '#2A2723', accessories: ['hoodie', 'glasses'], build: 'broad' },
  'emp-data':      { outfit: '#7C3AED', hair: 'twin-buns', hairColor: '#1F1D1A', accessories: ['glasses'], build: 'slim' },
  'emp-doc':       { outfit: '#94A3B8', hair: 'bun-pen',   hairColor: '#4A3728', accessories: [], build: 'slim' },
  'emp-meeting-1': { outfit: '#2B3040', hair: 'neat',      hairColor: '#2A2723', accessories: ['tie', 'tablet'], tieColor: '#7E22CE', build: 'manager' },
  'emp-design':    { outfit: '#F97316', hair: 'beret',     hairColor: '#C13D3D', accessories: [], build: 'slim' },
  'emp-pm':        { outfit: '#2B3040', hair: 'side-part', hairColor: '#3A2D24', accessories: ['tie', 'badge'], tieColor: '#3B82F6', build: 'manager' },
  'emp-sec':       { outfit: '#1E293B', hair: 'buzz',      hairColor: '#15171B', accessories: ['shoulder-pads', 'sec-emblem'], build: 'broad' },
  'emp-rest-1':    { outfit: '#F59E0B', hair: 'cap',       hairColor: '#8B6914', accessories: [], build: 'default' },
};

/** 试岗新员工（市场招聘）：无配饰 + 琥珀色工牌 */
export const TRAINEE_LOOK: Omit<FigureLook, 'outfit'> = {
  hair: 'neat', hairColor: '#2A2723', accessories: ['badge'], build: 'default',
};

const BUILDS = {
  manager: { torso: [0.46, 0.52, 0.30] as const, arm: [0.12, 0.42, 0.18] as const, scaleY: 1.08 },
  slim:    { torso: [0.38, 0.50, 0.24] as const, arm: [0.10, 0.40, 0.15] as const, scaleY: 1 },
  broad:   { torso: [0.48, 0.50, 0.30] as const, arm: [0.14, 0.42, 0.20] as const, scaleY: 1 },
  default: { torso: [0.42, 0.50, 0.28] as const, arm: [0.12, 0.42, 0.18] as const, scaleY: 1 },
};

const TORSO_Y = 1.05;
const HEAD_Y = 1.55;
const DARK = '#1F1D1A';

export function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return Math.abs(h);
}

/* ── 发型 ── */
function Hair({ style, color }: { style: HairStyle; color: string }) {
  switch (style) {
    case 'flat-top':
      return (
        <>
          <mesh position={[0, 0.16, 0]}><boxGeometry args={[0.38, 0.16, 0.34]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[0, 0.02, -0.14]}><boxGeometry args={[0.38, 0.14, 0.08]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
        </>
      );
    case 'side-part':
      return (
        <>
          <mesh position={[0, 0.13, 0]}><boxGeometry args={[0.38, 0.10, 0.34]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[-0.09, 0.08, 0.165]}><boxGeometry args={[0.20, 0.06, 0.04]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
        </>
      );
    case 'ponytail':
      return (
        <>
          <mesh position={[0, 0.14, 0]}><boxGeometry args={[0.38, 0.12, 0.34]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[0, -0.02, -0.22]} rotation={[0.25, 0, 0]}><boxGeometry args={[0.10, 0.28, 0.10]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
        </>
      );
    case 'bob':
      return (
        <>
          <mesh position={[0, 0.14, 0]}><boxGeometry args={[0.40, 0.12, 0.36]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[-0.205, -0.04, 0]}><boxGeometry args={[0.05, 0.22, 0.30]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[0.205, -0.04, 0]}><boxGeometry args={[0.05, 0.22, 0.30]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
        </>
      );
    case 'twin-buns':
      return (
        <>
          <mesh position={[0, 0.13, 0]}><boxGeometry args={[0.38, 0.10, 0.34]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[-0.16, 0.18, -0.06]}><boxGeometry args={[0.10, 0.10, 0.10]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[0.16, 0.18, -0.06]}><boxGeometry args={[0.10, 0.10, 0.10]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
        </>
      );
    case 'bun-pen':
      return (
        <>
          <mesh position={[0, 0.14, 0]}><boxGeometry args={[0.38, 0.12, 0.34]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[0, 0.20, -0.10]}><boxGeometry args={[0.12, 0.10, 0.12]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[0.19, 0.02, 0.05]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.015, 0.015, 0.16, 6]} /><meshStandardMaterial color="#F59E0B" /></mesh>
        </>
      );
    case 'messy':
      return (
        <>
          <mesh position={[0, 0.15, 0]}><boxGeometry args={[0.40, 0.14, 0.36]} /><meshStandardMaterial color={color} roughness={0.75} /></mesh>
          <mesh position={[-0.10, 0.23, 0.05]}><boxGeometry args={[0.08, 0.06, 0.08]} /><meshStandardMaterial color={color} roughness={0.75} /></mesh>
          <mesh position={[0.08, 0.24, -0.08]}><boxGeometry args={[0.08, 0.06, 0.08]} /><meshStandardMaterial color={color} roughness={0.75} /></mesh>
          <mesh position={[0.02, 0.23, 0.10]}><boxGeometry args={[0.08, 0.06, 0.08]} /><meshStandardMaterial color={color} roughness={0.75} /></mesh>
        </>
      );
    case 'buzz':
      return <mesh position={[0, 0.12, 0]}><boxGeometry args={[0.37, 0.05, 0.33]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>;
    case 'beret':
      return (
        <>
          <mesh position={[0, 0.12, 0]}><boxGeometry args={[0.38, 0.08, 0.34]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[0.12, 0.13, 0]}><boxGeometry args={[0.10, 0.04, 0.34]} /><meshStandardMaterial color="#E45858" roughness={0.7} /></mesh>
          <mesh position={[0.03, 0.20, 0]} rotation={[0, 0, 0.12]}><cylinderGeometry args={[0.24, 0.24, 0.06, 12]} /><meshStandardMaterial color="#1F2937" roughness={0.6} /></mesh>
        </>
      );
    case 'cap':
      return (
        <>
          <mesh position={[0, 0.16, 0]}><cylinderGeometry args={[0.21, 0.21, 0.08, 10]} /><meshStandardMaterial color="#F59E0B" roughness={0.6} /></mesh>
          <mesh position={[0, 0.12, 0.22]}><boxGeometry args={[0.20, 0.03, 0.14]} /><meshStandardMaterial color="#F59E0B" roughness={0.6} /></mesh>
        </>
      );
    case 'wave':
      return (
        <>
          <mesh position={[0, 0.14, 0]}><boxGeometry args={[0.38, 0.12, 0.34]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
          <mesh position={[0, 0.09, 0.17]}><boxGeometry args={[0.34, 0.05, 0.05]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
        </>
      );
    default: // neat
      return <mesh position={[0, 0.14, 0]}><boxGeometry args={[0.38, 0.12, 0.34]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>;
  }
}

/* ── 头部配饰（相对头部原点） ── */
function HeadAccessories({ accessories }: { accessories: Accessory[] }) {
  const hasHeadset = accessories.includes('headset') || accessories.includes('headset-dual');
  return (
    <>
      {accessories.includes('glasses') && (
        <>
          <mesh position={[-0.085, 0.02, 0.17]}><boxGeometry args={[0.11, 0.09, 0.02]} /><meshStandardMaterial color={DARK} roughness={0.4} /></mesh>
          <mesh position={[0.085, 0.02, 0.17]}><boxGeometry args={[0.11, 0.09, 0.02]} /><meshStandardMaterial color={DARK} roughness={0.4} /></mesh>
          <mesh position={[0, 0.03, 0.17]}><boxGeometry args={[0.05, 0.02, 0.02]} /><meshStandardMaterial color={DARK} /></mesh>
        </>
      )}
      {hasHeadset && (
        <>
          <mesh position={[0.20, 0.02, 0]}><boxGeometry args={[0.05, 0.10, 0.10]} /><meshStandardMaterial color={DARK} roughness={0.4} /></mesh>
          {accessories.includes('headset-dual') && (
            <mesh position={[-0.20, 0.02, 0]}><boxGeometry args={[0.05, 0.10, 0.10]} /><meshStandardMaterial color={DARK} roughness={0.4} /></mesh>
          )}
          <mesh position={[0, 0.19, 0]}><boxGeometry args={[0.40, 0.03, 0.05]} /><meshStandardMaterial color={DARK} roughness={0.4} /></mesh>
          <mesh position={[0.14, -0.06, 0.09]} rotation={[0, 0, -0.9]}><cylinderGeometry args={[0.012, 0.012, 0.16, 6]} /><meshStandardMaterial color={DARK} /></mesh>
          <mesh position={[0.08, -0.10, 0.14]}><sphereGeometry args={[0.025, 8, 8]} /><meshBasicMaterial color="#22C55E" toneMapped={false} /></mesh>
        </>
      )}
    </>
  );
}

/* ── 躯干配饰 ── */
function TorsoAccessories({ look, torsoD }: { look: FigureLook; torsoD: number }) {
  const zFront = torsoD / 2 + 0.01;
  return (
    <>
      {look.accessories.includes('tie') && (
        <>
          <mesh position={[0, TORSO_Y + 0.20, zFront]}><boxGeometry args={[0.07, 0.05, 0.03]} /><meshStandardMaterial color={look.tieColor ?? '#D4AF37'} /></mesh>
          <mesh position={[0, TORSO_Y + 0.05, zFront]}><boxGeometry args={[0.08, 0.26, 0.02]} /><meshStandardMaterial color={look.tieColor ?? '#D4AF37'} /></mesh>
        </>
      )}
      {look.accessories.includes('badge') && (
        <>
          <mesh position={[0.08, TORSO_Y + 0.16, zFront]}><boxGeometry args={[0.04, 0.18, 0.01]} /><meshStandardMaterial color="#334155" /></mesh>
          <mesh position={[0.08, TORSO_Y + 0.02, zFront + 0.005]}><boxGeometry args={[0.10, 0.13, 0.015]} /><meshStandardMaterial color="#F8FAFC" emissive="#F8FAFC" emissiveIntensity={0.3} /></mesh>
        </>
      )}
      {look.accessories.includes('hoodie') && (
        <>
          <mesh position={[0, TORSO_Y + 0.30, -0.16]}><boxGeometry args={[0.30, 0.12, 0.10]} /><meshStandardMaterial color={look.outfit} roughness={0.7} /></mesh>
          <mesh position={[-0.06, TORSO_Y + 0.14, zFront]}><cylinderGeometry args={[0.01, 0.01, 0.12, 4]} /><meshStandardMaterial color="#D1D5DB" /></mesh>
          <mesh position={[0.06, TORSO_Y + 0.14, zFront]}><cylinderGeometry args={[0.01, 0.01, 0.12, 4]} /><meshStandardMaterial color="#D1D5DB" /></mesh>
        </>
      )}
      {look.accessories.includes('tablet') && (
        <mesh position={[0.18, TORSO_Y + 0.05, 0.24]} rotation={[-0.4, 0, 0]}>
          <boxGeometry args={[0.22, 0.30, 0.02]} />
          <meshStandardMaterial color={DARK} emissive="#7E22CE" emissiveIntensity={0.5} />
        </mesh>
      )}
    </>
  );
}

export interface VoxelHumanProps {
  position: [number, number, number];
  look: FigureLook;
  status: EmployeeStatus;
  isSelected: boolean;
  seed: string;
  skin: string;
  /** 姿态：seated 屈腿坐姿（整体下沉），stand 直立 */
  pose?: 'stand' | 'sit';
  /** 工位显示器材质（打字状态时做屏幕闪烁） */
  screenMatRef?: React.RefObject<THREE.MeshBasicMaterial>;
  screenBaseColor?: string;
  onClick?: (e: any) => void;
}

export default function VoxelHuman({
  position, look, status, isSelected, seed, skin, pose = 'stand', screenMatRef, screenBaseColor, onClick,
}: VoxelHumanProps) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && !!onClick);

  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const armLRef = useRef<THREE.Group>(null);
  const armRRef = useRef<THREE.Group>(null);
  const statusRingMat = useRef<THREE.MeshBasicMaterial>(null);
  const sonarRef = useRef<THREE.Mesh>(null);
  const sonarMat = useRef<THREE.MeshBasicMaterial>(null);
  const knowledgeRef = useRef<THREE.Mesh>(null);
  const knowledgeMat = useRef<THREE.MeshStandardMaterial>(null);
  const emblemMat = useRef<THREE.MeshStandardMaterial>(null);
  const screenBase = useRef(new THREE.Color(screenBaseColor ?? '#0F70B7'));

  const h = hashCode(seed);
  const phase = (h % 628) / 100;
  const jitter = 0.85 + (h % 30) / 100;
  const build = BUILDS[look.build];
  const [tw, th, td] = build.torso;
  const [aw, ah, ad] = build.arm;
  const shoulderX = tw / 2 + aw / 2 + 0.01;
  const statusColor = STATUS_COLOR[status];

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const body = bodyRef.current;
    const head = headRef.current;
    const armL = armLRef.current;
    const armR = armRRef.current;
    if (!body || !head || !armL || !armR) return;

    // 基础呼吸浮动 + 头部微倾
    if (status === 'idle') {
      body.position.y = 0.04 * Math.sin(t * 0.8 * jitter + phase);
      body.rotation.y = 0.06 * Math.sin(t * 0.5 + phase);
    } else {
      body.position.y = 0.025 * Math.sin(t * 1.4 * jitter + phase);
      body.rotation.y = 0;
    }
    head.rotation.z = 0.03 * Math.sin(t * 0.9 + phase);

    // 状态动作
    if (status === 'working') {
      const burst = Math.sin(t * 0.31 + phase) > -0.6 ? 1 : 0.15; // 间歇停顿
      armL.rotation.x = -0.85 + 0.12 * burst * Math.sin(t * 9 * jitter + phase);
      armR.rotation.x = -0.85 + 0.12 * burst * Math.sin(t * 9 * jitter + phase + Math.PI);
      armR.rotation.z = 0;
      head.rotation.x = 0.12;
    } else if (status === 'meeting') {
      armR.rotation.x = -1.2 + 0.25 * Math.sin(t * 2.2 + phase);
      armR.rotation.z = -0.5 + 0.2 * Math.sin(t * 1.7 + phase);
      armL.rotation.x = -0.3;
      head.rotation.x = 0.08 * Math.sin(t * 2.0 + phase);
    } else if (status === 'blocked') {
      armL.rotation.x = -0.4;
      armR.rotation.x = -0.4;
      armR.rotation.z = 0;
      head.rotation.x = -0.06 + 0.02 * Math.sin(t * 6);
    } else {
      armL.rotation.x = 0;
      armR.rotation.x = 0;
      armR.rotation.z = 0;
      head.rotation.x = status === 'training' ? -0.18 : 0;
    }

    // 脚下状态环呼吸
    if (statusRingMat.current) {
      statusRingMat.current.opacity = 0.35 + 0.2 * Math.sin(t * 2 + phase);
    }
    // blocked 声呐扩散环
    if (sonarRef.current && sonarMat.current) {
      const u = (t * 1.5 + phase) % 1;
      sonarRef.current.scale.setScalar(1 + 1.2 * u);
      sonarMat.current.opacity = 0.85 * (1 - u);
    }
    // training 悬浮知识面板
    if (knowledgeRef.current && knowledgeMat.current) {
      knowledgeRef.current.position.y = 2.0 + 0.06 * Math.sin(t * 1.2 + phase);
      knowledgeRef.current.rotation.y += 0.008;
      knowledgeMat.current.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 2.5 + phase);
    }
    // 安全官胸章脉冲
    if (emblemMat.current) {
      emblemMat.current.emissiveIntensity = 0.4 + 0.3 * Math.sin(t * 3 + phase);
    }
    // 显示器闪烁（working 时）
    if (screenMatRef?.current) {
      const flick = status === 'working'
        ? 0.8 + 0.15 * Math.sin(t * 13 + phase) * Math.sin(t * 3.7 + phase * 2)
        : status === 'idle' ? 0.35 : 0.7;
      const scan = 0.3 * Math.max(0, Math.sin(t * 0.9 + phase)) ** 8;
      screenMatRef.current.color.copy(screenBase.current).multiplyScalar(flick + scan);
    }
  });

  return (
    <group
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
      onClick={onClick}
    >
      <group ref={bodyRef} scale={[1, build.scaleY, 1]}>
        {/* 躯干 */}
        <mesh position={[0, TORSO_Y, 0]}>
          <boxGeometry args={[tw, th, td]} />
          <meshStandardMaterial
            color={look.outfit}
            emissive={isSelected ? look.outfit : '#000000'}
            emissiveIntensity={isSelected ? 0.55 : 0}
            roughness={0.55}
            metalness={0.15}
          />
        </mesh>
        {/* 衣领 V */}
        <mesh position={[0, TORSO_Y + 0.18, td / 2 + 0.005]}>
          <boxGeometry args={[0.18, 0.06, 0.02]} />
          <meshStandardMaterial color="#FFFFFF" emissive="#FFFFFF" emissiveIntensity={0.3} />
        </mesh>
        {/* 肩垫（manager / sec） */}
        {look.accessories.includes('shoulder-pads') && (
          <>
            <mesh position={[-shoulderX, TORSO_Y + 0.22, 0]}><boxGeometry args={[0.14, 0.08, td * 0.85]} /><meshStandardMaterial color={look.outfit} roughness={0.4} metalness={0.3} /></mesh>
            <mesh position={[shoulderX, TORSO_Y + 0.22, 0]}><boxGeometry args={[0.14, 0.08, td * 0.85]} /><meshStandardMaterial color={look.outfit} roughness={0.4} metalness={0.3} /></mesh>
          </>
        )}
        {/* 安全官胸章 */}
        {look.accessories.includes('sec-emblem') && (
          <mesh position={[0, TORSO_Y + 0.10, td / 2 + 0.01]}>
            <boxGeometry args={[0.08, 0.08, 0.01]} />
            <meshStandardMaterial ref={emblemMat} color="#C13D3D" emissive="#C13D3D" emissiveIntensity={0.6} />
          </mesh>
        )}
        <TorsoAccessories look={look} torsoD={td} />
        {/* 双臂（肩部枢轴，便于打字/手势动作） */}
        <group ref={armLRef} position={[-shoulderX, TORSO_Y + 0.16, 0]}>
          <mesh position={[0, -ah / 2, 0]}>
            <boxGeometry args={[aw, ah, ad]} />
            <meshStandardMaterial color={look.outfit} roughness={0.55} />
          </mesh>
        </group>
        <group ref={armRRef} position={[shoulderX, TORSO_Y + 0.16, 0]}>
          <mesh position={[0, -ah / 2, 0]}>
            <boxGeometry args={[aw, ah, ad]} />
            <meshStandardMaterial color={look.outfit} roughness={0.55} />
          </mesh>
        </group>
        {/* 双腿（深色西裤 + 鞋）· 站姿直立 / 坐姿屈腿 */}
        {pose === 'stand' ? (
          <>
            <mesh position={[-0.11, 0.5, 0]}>
              <boxGeometry args={[0.14, 0.6, 0.17]} />
              <meshStandardMaterial color="#23272F" roughness={0.7} />
            </mesh>
            <mesh position={[0.11, 0.5, 0]}>
              <boxGeometry args={[0.14, 0.6, 0.17]} />
              <meshStandardMaterial color="#23272F" roughness={0.7} />
            </mesh>
            <mesh position={[-0.11, 0.18, 0.04]}>
              <boxGeometry args={[0.14, 0.09, 0.26]} />
              <meshStandardMaterial color="#15181E" roughness={0.5} />
            </mesh>
            <mesh position={[0.11, 0.18, 0.04]}>
              <boxGeometry args={[0.14, 0.09, 0.26]} />
              <meshStandardMaterial color="#15181E" roughness={0.5} />
            </mesh>
          </>
        ) : (
          <>
            {/* 大腿（水平前伸） */}
            <mesh position={[-0.11, 0.68, 0.2]}>
              <boxGeometry args={[0.14, 0.15, 0.42]} />
              <meshStandardMaterial color="#23272F" roughness={0.7} />
            </mesh>
            <mesh position={[0.11, 0.68, 0.2]}>
              <boxGeometry args={[0.14, 0.15, 0.42]} />
              <meshStandardMaterial color="#23272F" roughness={0.7} />
            </mesh>
            {/* 小腿（垂下） */}
            <mesh position={[-0.11, 0.38, 0.38]}>
              <boxGeometry args={[0.13, 0.5, 0.14]} />
              <meshStandardMaterial color="#23272F" roughness={0.7} />
            </mesh>
            <mesh position={[0.11, 0.38, 0.38]}>
              <boxGeometry args={[0.13, 0.5, 0.14]} />
              <meshStandardMaterial color="#23272F" roughness={0.7} />
            </mesh>
            <mesh position={[-0.11, 0.12, 0.44]}>
              <boxGeometry args={[0.13, 0.08, 0.24]} />
              <meshStandardMaterial color="#15181E" roughness={0.5} />
            </mesh>
            <mesh position={[0.11, 0.12, 0.44]}>
              <boxGeometry args={[0.13, 0.08, 0.24]} />
              <meshStandardMaterial color="#15181E" roughness={0.5} />
            </mesh>
          </>
        )}
        {/* 颈 */}
        <mesh position={[0, TORSO_Y + 0.31, 0]}>
          <boxGeometry args={[0.12, 0.1, 0.12]} />
          <meshStandardMaterial color={skin} roughness={0.6} />
        </mesh>
        {/* 头部组（正常比例 · 整组缩放去 Q 版化） */}
        <group ref={headRef} position={[0, HEAD_Y, 0]} scale={0.76}>
          <mesh>
            <boxGeometry args={[0.36, 0.32, 0.32]} />
            <meshStandardMaterial color={skin} roughness={0.6} />
          </mesh>
          <Hair style={look.hair} color={look.hairColor} />
          <HeadAccessories accessories={look.accessories} />
          {/* 眼 */}
          <mesh position={[-0.08, 0.02, 0.165]}><boxGeometry args={[0.05, 0.05, 0.01]} /><meshBasicMaterial color={DARK} toneMapped={false} /></mesh>
          <mesh position={[0.08, 0.02, 0.165]}><boxGeometry args={[0.05, 0.05, 0.01]} /><meshBasicMaterial color={DARK} toneMapped={false} /></mesh>
        </group>
      </group>

      {/* 脚下状态环（状态色从衣服转移到这里） */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.44, 24]} />
        <meshBasicMaterial ref={statusRingMat} color={statusColor} transparent opacity={0.45} toneMapped={false} />
      </mesh>

      {/* blocked · 声呐告警环 + 感叹标 */}
      {status === 'blocked' && (
        <>
          <mesh ref={sonarRef} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.5, 0.58, 24]} />
            <meshBasicMaterial ref={sonarMat} color="#C13D3D" transparent opacity={0.8} toneMapped={false} />
          </mesh>
          <Text position={[0, 2.35, 0]} fontSize={0.3} color="#C13D3D" anchorX="center" anchorY="middle" outlineWidth={0.015} outlineColor="#1A1B1E">
            !
          </Text>
        </>
      )}

      {/* training · 悬浮知识面板 */}
      {status === 'training' && (
        <mesh ref={knowledgeRef} position={[0, 2.0, 0]}>
          <boxGeometry args={[0.26, 0.18, 0.02]} />
          <meshStandardMaterial ref={knowledgeMat} color="#0F766E" emissive="#0F766E" emissiveIntensity={0.8} />
        </mesh>
      )}

      {/* 选中圈 */}
      {isSelected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.66, 32]} />
          <meshBasicMaterial color={look.outfit} transparent opacity={0.85} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
