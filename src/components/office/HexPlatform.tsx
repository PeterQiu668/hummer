/**
 * OfficeFloor v13 · SYBERNETIC HQ 1:1（文件名保留 HexPlatform 以免改动引用）
 * 主楼板（镜面反射地面）+ 下层甲板 + 中央大台阶 + 招牌实体墙 + 幕墙窗
 * + HQ 巨型霓虹招牌 + 世界地图数据屏 + AI WORKFLOW 悬浮牌 + EXEC 墙牌
 * + AI EMPOWERING ENTERPRISE 发光块 + OPEN OFFICE 地面蚀刻
 */
import { useMemo } from 'react';
import { Instances, Instance, MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { NEON, NeonBar, NeonSignPanel, FloorText, GlowPlane, getHoloTexture } from './neon';
import { NeonStairs, GlassRail, AIEnterpriseBlock, Plant } from './sceneStructures';
import { getCarpetTexture } from './textures';
import { useAutoShadows } from './useAutoShadows';

const MAIN_W = 34;   // x -17..17
const MAIN_D = 20;   // z -13..7
const MAIN_CZ = -3;  // 主楼板中心 z
const DECK_D = 6.8;  // 下层甲板 z 6.6..13.4
const DECK_CZ = 10;
const DECK_Y = -1.35;
const WALL_Z = -13;
const STRUCT = '#C6C0B5';
const STRUCT_DARK = '#B2ADA2';

/** 幕墙窗（竖梃 + 玻璃 + 上下横梁），跨 x∈[-6,17] */
function WindowWall() {
  const H = 6.6;
  const X0 = -6.2, X1 = 17;
  const W = X1 - X0;
  const CX = (X0 + X1) / 2;
  const mullions = useMemo(() => {
    const arr: number[] = [];
    const n = 9;
    for (let i = 0; i <= n; i++) arr.push(X0 + (W / n) * i);
    return arr;
  }, [W]);
  return (
    <group position={[0, 0, WALL_Z]}>
      <mesh position={[CX, H / 2, 0]}>
        <boxGeometry args={[W, H, 0.06]} />
        <meshStandardMaterial color="#CFE0F0" transparent opacity={0.08} roughness={0.05} metalness={0.1} depthWrite={false} />
      </mesh>
      <Instances limit={mullions.length}>
        <boxGeometry args={[0.09, H, 0.09]} />
        <meshStandardMaterial color="#AEB6C1" metalness={0.6} roughness={0.35} />
        {mullions.map((x) => <Instance key={x} position={[x, H / 2, 0]} />)}
      </Instances>
      <mesh position={[CX, H, 0]}>
        <boxGeometry args={[W + 0.1, 0.14, 0.16]} />
        <meshStandardMaterial color="#AEB6C1" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[CX, 0.06, 0]}>
        <boxGeometry args={[W + 0.1, 0.12, 0.16]} />
        <meshStandardMaterial color="#AEB6C1" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* 窗侧微光（城市光晕） */}
      <GlowPlane size={[W, 3.2]} color="#CBDCF2" opacity={0.3} position={[CX, 3, 0.3]} />
    </group>
  );
}

/** 招牌实体墙（x -17..-6.2）：HQ 巨型霓虹招牌 + 世界地图数据屏 + 竖霓虹柱 */
function SignWall() {
  return (
    <group position={[0, 0, WALL_Z + 0.15]}>
      <mesh position={[-11.6, 3.7, -0.2]}>
        <boxGeometry args={[10.8, 7.4, 0.4]} />
        <meshStandardMaterial color={STRUCT} roughness={0.55} metalness={0.3} />
      </mesh>
      {/* 面板缝线 */}
      {[-14.6, -8.6].map((x) => (
        <mesh key={x} position={[x, 3.7, 0.01]}>
          <boxGeometry args={[0.02, 7.2, 0.02]} />
          <meshBasicMaterial color="#AEB6C1" />
        </mesh>
      ))}
      {/* HQ 巨型招牌 */}
      <NeonSignPanel text="HUMMER HQ" width={9.2} height={2.3} fontSize={1.05} position={[-11.5, 5.2, 0.15]} />
      {/* 世界地图 + 数据面板 */}
      <group position={[-12.3, 2.2, 0.05]}>
        <mesh>
          <boxGeometry args={[6.2, 2.3, 0.1]} />
          <meshStandardMaterial color="#26303F" roughness={0.35} metalness={0.35} />
        </mesh>
        <mesh position={[-1.4, 0, 0.07]}>
          <planeGeometry args={[3.1, 2.0]} />
          <meshBasicMaterial map={getHoloTexture('map', 5)} color="#FFFFFF" transparent opacity={0.98} toneMapped={false} />
        </mesh>
        <mesh position={[1.9, 0, 0.07]}>
          <planeGeometry args={[2.1, 2.0]} />
          <meshBasicMaterial map={getHoloTexture('dashboard', 6)} color="#FFFFFF" transparent opacity={0.98} toneMapped={false} />
        </mesh>
      </group>
      {/* 两侧竖霓虹灯柱 */}
      <NeonBar length={5.6} vertical position={[-16.6, 3.6, 0.1]} thickness={0.07} />
      <NeonBar length={5.6} vertical position={[-6.5, 3.6, 0.1]} thickness={0.07} />
    </group>
  );
}

export default function HexPlatform() {
  const rootRef = useAutoShadows();
  const carpetTex = useMemo(() => getCarpetTexture('#CDC7BB', 'floor-v16'), []);

  // 地面拼板缝网格
  const gridLines = useMemo(() => {
    const lines: { pos: [number, number, number]; scl: [number, number, number] }[] = [];
    for (let x = -15; x <= 15; x += 3) lines.push({ pos: [x, 0.004, MAIN_CZ], scl: [0.02, 0.002, MAIN_D - 1.5] });
    for (let z = -12; z <= 6; z += 3) lines.push({ pos: [0, 0.004, z], scl: [MAIN_W - 1.5, 0.002, 0.02] });
    return lines;
  }, []);

  return (
    <group ref={rootRef}>
      {/* ── 主楼板 ── */}
      <mesh position={[0, -0.25, MAIN_CZ]}>
        <boxGeometry args={[MAIN_W, 0.5, MAIN_D]} />
        <meshStandardMaterial map={carpetTex} color="#CFC9BD" roughness={0.72} metalness={0.05} />
      </mesh>
      {/* 镜面反射地面（拉丝反射 · 霓虹倒影的关键） */}
      <mesh position={[0, 0.003, MAIN_CZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[MAIN_W - 0.2, MAIN_D - 0.2]} />
        <MeshReflectorMaterial
          resolution={512}
          mirror={0.2}
          mixBlur={1}
          blur={[300, 80]}
          mixStrength={0.5}
          mixContrast={1}
          depthScale={0.8}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#C6CCD6"
          roughness={0.85}
          metalness={0.1}
        />
      </mesh>
      {/* 主楼板前缘（z=7）沿口 + 霓虹 */}
      <mesh position={[0, -0.7, 7.2]}>
        <boxGeometry args={[MAIN_W, 1.4, 0.5]} />
        <meshStandardMaterial color={STRUCT_DARK} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.01, 6.98]}>
        <boxGeometry args={[MAIN_W - 0.4, 0.025, 0.025]} />
        <meshBasicMaterial color={NEON} toneMapped={false} />
      </mesh>

      {/* ── 下层甲板 ── */}
      <mesh position={[0, DECK_Y - 0.5, DECK_CZ]}>
        <boxGeometry args={[MAIN_W, 1.0, DECK_D]} />
        <meshStandardMaterial color="#C8CEDA" roughness={0.6} metalness={0.12} />
      </mesh>
      <mesh position={[0, DECK_Y + 0.012, DECK_CZ + 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[MAIN_W - 0.4, DECK_D - 0.6]} />
        <meshStandardMaterial color="#C2C9D6" roughness={0.75} metalness={0.1} />
      </mesh>
      {/* 甲板前缘斜切 + 霓虹导引线 */}
      <mesh position={[0, DECK_Y - 0.5, 13.55]} rotation={[0.35, 0, 0]}>
        <boxGeometry args={[MAIN_W, 1.1, 0.35]} />
        <meshStandardMaterial color={STRUCT_DARK} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, DECK_Y + 0.02, 13.15]}>
        <boxGeometry args={[MAIN_W - 2, 0.02, 0.02]} />
        <meshBasicMaterial color={NEON} transparent opacity={0.85} toneMapped={false} />
      </mesh>

      {/* ── 中央大台阶（主层 → 下层） ── */}
      <group position={[-3.5, 0, 6.1]}>
        <NeonStairs steps={9} width={2.8} rise={0.15} run={0.36} down />
        <GlassRail length={3.3} height={0.9} position={[-1.5, -0.7, 1.6]} rotation={[0, Math.PI / 2, 0]} />
        <GlassRail length={3.3} height={0.9} position={[1.5, -0.7, 1.6]} rotation={[0, Math.PI / 2, 0]} />
      </group>

      {/* ── 背墙：招牌墙 + 幕墙窗 ── */}
      <SignWall />
      <WindowWall />

      {/* ── 悬浮招牌 ── */}
      <NeonSignPanel text="AI WORKFLOW" width={4.6} height={1.1} position={[1, 5, -12.4]} />
      <NeonSignPanel text="EXECUTIVE SUITE / B3" width={5.4} height={0.9} position={[12.5, 5.6, -12.55]} />
      {/* 高管区背墙数据屏 */}
      <group position={[10, 4.1, -12.65]}>
        <mesh>
          <boxGeometry args={[3.4, 1.6, 0.08]} />
          <meshStandardMaterial color="#26303F" roughness={0.35} metalness={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[3.2, 1.45]} />
          <meshBasicMaterial map={getHoloTexture('chart', 8)} color="#FFFFFF" transparent opacity={0.98} toneMapped={false} />
        </mesh>
      </group>

      {/* ── 地面蚀刻 ── */}
      <FloorText text="OPEN OFFICE" size={0.55} position={[-2.5, 0.006, 1.5]} rotation={[0, -0.15, 0]} opacity={0.8} />

      {/* ── AI EMPOWERING ENTERPRISE 发光块（下层甲板右） ── */}
      <AIEnterpriseBlock />

      {/* ── 地面拼板缝 ── */}
      <Instances limit={gridLines.length}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#B7BEC9" transparent opacity={0.4} />
        {gridLines.map((l, i) => (
          <Instance key={i} position={l.pos} scale={l.scl} />
        ))}
      </Instances>

      {/* ── 绿植点缀（参考图位置） ── */}
      <Plant height={1.4} position={[7.8, 0, -11.6]} />
      <Plant height={1.2} position={[16.2, 0, -3]} />
      <Plant height={1.3} position={[-16.2, 0, 3.8]} />
    </group>
  );
}
