/**
 * SYBERNETIC HQ · 场景结构件（1:1 复刻规格 · 参考图坐标系）
 * 高管夹层 / 会议舱玻璃壳 / 休闲露台 / 健身角 / Section B 平台 / 台阶 / 绿植
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { NEON, NEON_TEXT, PANEL, PANEL_EDGE, NeonBar, NeonSignPanel, GlowPlane, getHoloTexture, chamferPanelGeo } from './neon';

const STRUCT = '#C6C0B5';
const STRUCT_DARK = '#B2ADA2';
const GLASS_TINT = '#D2E6EF';

/* ── 绿植（叶片交叉面片） ── */
export function Plant({ height = 1.4, potColor = '#E4DED2', ...props }: { height?: number; potColor?: string } & JSX.IntrinsicElements['group']) {
  const leaves = useMemo(() => Array.from({ length: 7 }, (_, i) => ({
    rotY: (i / 7) * Math.PI * 2 + i * 0.7,
    tilt: 0.35 + (i % 3) * 0.18,
    s: 0.75 + (i % 4) * 0.12,
  })), []);
  return (
    <group {...props}>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.22, 0.27, 0.4, 10]} />
        <meshStandardMaterial color={potColor} roughness={0.6} />
      </mesh>
      {leaves.map((l, i) => (
        <group key={i} rotation={[0, l.rotY, 0]}>
          <mesh position={[0.12 * l.s, 0.4 + height * 0.45 * l.s, 0]} rotation={[0, 0, -l.tilt]}>
            <planeGeometry args={[0.16 * l.s, height * 0.9 * l.s]} />
            <meshStandardMaterial color={i % 2 ? '#74B36E' : '#4F9A5E'} roughness={1} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── 霓虹包边台阶 ── */
export function NeonStairs({
  steps = 9, width = 2.8, rise = 0.15, run = 0.36, down = false, ...props
}: { steps?: number; width?: number; rise?: number; run?: number; down?: boolean } & JSX.IntrinsicElements['group']) {
  return (
    <group {...props}>
      {Array.from({ length: steps }, (_, i) => {
        const y = down ? -(i + 1) * rise : (i + 1) * rise;
        const z = (i + 0.5) * run;
        return (
          <group key={i} position={[0, y - rise / 2, z]}>
            <mesh>
              <boxGeometry args={[width, rise, run]} />
              <meshStandardMaterial color={STRUCT_DARK} roughness={0.6} metalness={0.3} />
            </mesh>
            {/* 踏步鼻缝光 */}
            <mesh position={[0, rise / 2 - 0.012, -run / 2 + 0.02]}>
              <boxGeometry args={[width - 0.15, 0.02, 0.02]} />
              <meshBasicMaterial color={NEON} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ── 玻璃栏板 ── */
export function GlassRail({ length = 4, height = 1.0, ...props }: { length?: number; height?: number } & JSX.IntrinsicElements['group']) {
  return (
    <group {...props}>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[length, height, 0.04]} />
        <meshStandardMaterial color={GLASS_TINT} transparent opacity={0.18} roughness={0.14} metalness={0} emissive="#FFFFFF" emissiveIntensity={0.05} depthWrite={false} />
      </mesh>
      <mesh position={[0, height, 0]}>
        <boxGeometry args={[length, 0.05, 0.07]} />
        <meshStandardMaterial color={PANEL_EDGE} metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, height - 0.015, 0]}>
        <boxGeometry args={[length, 0.015, 0.03]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ── Section B 抬高平台（13×7 · +0.3） ── */
export function SectionBPlatform() {
  return (
    <group position={[-1, 0, -8.5]}>
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[13, 0.3, 7]} />
        <meshStandardMaterial color="#CBD1DC" roughness={0.45} metalness={0.25} />
      </mesh>
      {/* 前缘踏步 + 平台沿缝光 */}
      <mesh position={[0, 0.075, 3.75]}>
        <boxGeometry args={[6, 0.15, 0.5]} />
        <meshStandardMaterial color={STRUCT_DARK} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.29, 3.49]}>
        <boxGeometry args={[12.9, 0.02, 0.02]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      <mesh position={[-6.49, 0.29, 0]}>
        <boxGeometry args={[0.02, 0.02, 6.9]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      <mesh position={[6.49, 0.29, 0]}>
        <boxGeometry args={[0.02, 0.02, 6.9]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ── 高管夹层（10×7 @ y2.7）+ 楼梯 + 玻璃栏板 + 角柱 ── */
export function ExecMezzanine() {
  return (
    <group position={[11.5, 0, -9]}>
      {/* 楼板（厚板） */}
      <mesh position={[0, 2.45, 0]}>
        <boxGeometry args={[10, 0.5, 7]} />
        <meshStandardMaterial color="#CBD1DC" roughness={0.45} metalness={0.25} />
      </mesh>
      {/* 板底裙边 + 支撑体 */}
      <mesh position={[0, 1.1, -1.2]}>
        <boxGeometry args={[9.2, 2.2, 4.2]} />
        <meshStandardMaterial color={STRUCT_DARK} roughness={0.6} metalness={0.3} />
      </mesh>
      {/* 楼板沿霓虹 */}
      <mesh position={[0, 2.71, 3.49]}>
        <boxGeometry args={[9.9, 0.02, 0.02]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      <mesh position={[-4.99, 2.71, 0]}>
        <boxGeometry args={[0.02, 0.02, 6.9]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      {/* 玻璃栏板：-x 边 + +z 边（留楼梯口） */}
      <GlassRail length={6.8} position={[-4.9, 2.7, 0]} rotation={[0, Math.PI / 2, 0]} />
      <GlassRail length={6.2} position={[1.6, 2.7, 3.45]} />
      {/* 角形装甲侧柱 ×2 */}
      {[-5, 5].map((x) => (
        <group key={x} position={[x, 0, -2.2]}>
          <mesh position={[0, 3.4, 0]} rotation={[0, 0, x < 0 ? 0.12 : -0.12]}>
            <boxGeometry args={[0.7, 6.8, 2.6]} />
            <meshStandardMaterial color={STRUCT} roughness={0.5} metalness={0.35} />
          </mesh>
          <NeonBar length={5.8} vertical position={[x < 0 ? 0.38 : -0.38, 3.4, 1.1]} thickness={0.05} glow={0.8} />
        </group>
      ))}
      {/* 上行楼梯（14 级 · 朝 -z 上） */}
      <group position={[-4.7, 0, 4.0]} rotation={[0, Math.PI, 0]}>
        <NeonStairs steps={14} width={1.8} rise={0.193} run={0.3} />
      </group>
    </group>
  );
}

/* ── 会议舱玻璃壳（八角三层基座 + 圆柱玻璃 + 光环） ── */
export function ConferenceShell() {
  const octa = useMemo(() => {
    const mk = (r: number, h: number) => {
      const shape = new THREE.Shape();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i + Math.PI / 8;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
      }
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      return g;
    };
    return [mk(4.3, 0.9), mk(3.8, 0.9), mk(3.4, 0.08)];
  }, []);
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ringRef.current) ringRef.current.rotation.z = clock.elapsedTime * 0.15;
  });
  return (
    <group position={[3.5, 0, 3.5]}>
      {/* 八角三层基座（从下层甲板升起，顶面 y=0.45） */}
      <mesh geometry={octa[0]} position={[0, -1.35, 0]}>
        <meshStandardMaterial color={STRUCT_DARK} roughness={0.55} metalness={0.3} />
      </mesh>
      <mesh geometry={octa[1]} position={[0, -0.45, 0]}>
        <meshStandardMaterial color="#C2C9D6" roughness={0.5} metalness={0.15} />
      </mesh>
      <mesh geometry={octa[2]} position={[0, 0.45, 0]}>
        <meshStandardMaterial color="#CBD1DC" roughness={0.45} metalness={0.25} />
      </mesh>
      {/* 基座层间霓虹 */}
      {[-0.44, 0.0, 0.46].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 8]}>
          <ringGeometry args={[3.35 + i * 0.06, 3.42 + i * 0.06, 8, 1]} />
          <meshBasicMaterial color={NEON} transparent opacity={0.75 - i * 0.1} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* 圆柱玻璃（门口朝 +z 开 70°） */}
      <mesh position={[0, 0.45 + 1.28, 0]}>
        <cylinderGeometry args={[3.0, 3.0, 2.55, 48, 1, true, Math.PI * 0.31, Math.PI * 1.62]} />
        <meshStandardMaterial
          color={GLASS_TINT}
          transparent
          opacity={0.16}
          roughness={0.14}
          metalness={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* 上下光环 */}
      <mesh position={[0, 0.52, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.01, 0.035, 8, 64]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      <mesh ref={ringRef} position={[0, 3.0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.01, 0.045, 8, 64]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      <GlowPlane size={[6.6, 1.2]} color={NEON} opacity={0} position={[0, 3.0, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      {/* 悬浮标牌 */}
      <NeonSignPanel text="CONFERENCE HUB" width={3.4} height={0.7} position={[0, 3.55, 1.0]} />
    </group>
  );
}

/* ── 休闲露台结构（媒体墙 + TV + 置物架 + 标牌） ── */
export function LoungeTerrace() {
  return (
    <group position={[12.5, 0, 2.5]}>
      {/* 露台板 */}
      <mesh position={[0, 0.175, 0]}>
        <boxGeometry args={[8.5, 0.35, 7.5]} />
        <meshStandardMaterial color="#CBD1DC" roughness={0.5} metalness={0.25} />
      </mesh>
      <mesh position={[-4.24, 0.34, 0]}>
        <boxGeometry args={[0.02, 0.02, 7.4]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      {/* 媒体墙 */}
      <group position={[0, 0.35, -3.6]}>
        <mesh position={[0, 1.3, 0]}>
          <boxGeometry args={[6.5, 2.6, 0.3]} />
          <meshStandardMaterial color="#C4CDDB" roughness={0.5} metalness={0.35} />
        </mesh>
        {/* TV ×2（全息内容） */}
        {[-1.6, 1.7].map((x, i) => (
          <group key={x} position={[x, 1.35, 0.17]}>
            <mesh>
              <boxGeometry args={[1.95, 1.15, 0.05]} />
              <meshStandardMaterial color="#26303F" roughness={0.3} metalness={0.4} />
            </mesh>
            <mesh position={[0, 0, 0.03]}>
              <planeGeometry args={[1.82, 1.02]} />
              <meshBasicMaterial map={getHoloTexture(i ? 'rings' : 'chart', i + 3)} color="#FFFFFF" transparent opacity={0.98} toneMapped={false} />
            </mesh>
          </group>
        ))}
        {/* 置物架 */}
        <group position={[2.9, 0, 0.2]}>
          {[0.5, 0.95, 1.4, 1.85].map((y, i) => (
            <mesh key={y} position={[0, y, 0]}>
              <boxGeometry args={[0.6, 0.03, 0.22]} />
              <meshStandardMaterial color={PANEL_EDGE} metalness={0.5} roughness={0.4} />
            </mesh>
          ))}
          {[0.58, 1.03, 1.48].map((y, i) => (
            <mesh key={y} position={[i % 2 ? 0.12 : -0.1, y + 0.07, 0]}>
              <boxGeometry args={[0.1, 0.14, 0.1]} />
              <meshBasicMaterial color={NEON} transparent opacity={0.5} toneMapped={false} />
            </mesh>
          ))}
        </group>
        {/* 标牌 */}
        <NeonSignPanel text="RELAXATION" sub="LOUNGE" width={2.6} height={1.0} color="#EC6A5E" position={[2.7, 2.95, 0.2]} />
      </group>
      <Plant height={1.3} position={[3.7, 0.35, 3.2]} />
      <Plant height={1.1} position={[-3.6, 0.35, 3.3]} />
    </group>
  );
}

/* ── 健身角（下层甲板 · 地垫 + 墙面数据屏） ── */
export function GymCorner() {
  return (
    <group position={[-13.5, -1.35, 8.5]}>
      {/* 地垫 */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[6.2, 4.2]} />
        <meshStandardMaterial color="#CFD4DC" roughness={0.95} />
      </mesh>
      {/* 侧墙 + 数据屏（朝 +x） */}
      <group position={[-3.3, 0, -1.0]}>
        <mesh position={[0, 1.5, 0]}>
          <boxGeometry args={[0.3, 3.0, 4.5]} />
          <meshStandardMaterial color={STRUCT} roughness={0.55} metalness={0.3} />
        </mesh>
        <group position={[0.17, 1.45, 0]} rotation={[0, Math.PI / 2, 0]}>
          <mesh>
            <boxGeometry args={[2.6, 1.2, 0.05]} />
            <meshStandardMaterial color="#26303F" roughness={0.3} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0, 0.03]}>
            <planeGeometry args={[2.45, 1.05]} />
            <meshBasicMaterial map={getHoloTexture('dashboard', 9)} color="#FFFFFF" transparent opacity={0.98} toneMapped={false} />
          </mesh>
        </group>
      </group>
      <Plant height={1.7} potColor="#C8CDD4" position={[2.6, 0, 1.4]} />
    </group>
  );
}

/* ── AI EMPOWERING ENTERPRISE 发光块（下层甲板右侧） ── */
export function AIEnterpriseBlock() {
  const geo = useMemo(() => chamferPanelGeo(3.2, 2.6, 0.4, 0.25), []);
  return (
    <group position={[12.8, -1.35 + 1.5, 8.6]} rotation={[0, -0.1, 0]}>
      <mesh geometry={geo}>
        <meshStandardMaterial color='#F2F5FA' roughness={0.55} metalness={0.06} />
      </mesh>
      <mesh geometry={useMemo(() => chamferPanelGeo(3.36, 2.76, 0.44, 0.06), [])} position={[0, 0, -0.05]}>
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>
      <GlowPlane size={[4.6, 4.6]} color={NEON} opacity={0} position={[0, 0, 0.3]} />
      <Text position={[0, 0.55, 0.3]} fontSize={1.0} color="#EAF7FF" anchorX="center" anchorY="middle">
        AI
      </Text>
      <Text position={[0, -0.35, 0.3]} fontSize={0.3} color={NEON_TEXT} anchorX="center" anchorY="middle" letterSpacing={0.1}>
        EMPOWERING
      </Text>
      <Text position={[0, -0.75, 0.3]} fontSize={0.3} color={NEON_TEXT} anchorX="center" anchorY="middle" letterSpacing={0.1}>
        ENTERPRISE
      </Text>
    </group>
  );
}
