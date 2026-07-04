/**
 * OfficeFloor v10（文件名保留 HexPlatform 以免改动引用）
 * 悬浮六边形 → 真实办公楼层：
 * 圆角楼板 + 地毯拼块网格 + 木纹主走道 + 三面玻璃幕墙（透出城市夜景）
 * + 线性吊灯 + 盆栽绿植 + 楼板边缘 LED 缝光
 */
import { useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';
import { getCarpetTexture, getWoodTexture } from './textures';
import { useAutoShadows } from './useAutoShadows';

const FLOOR_W = 33;
const FLOOR_D = 25.5;
const WALL_H = 4.4;
const FRAME = '#48536A';

function roundedRectGeo(w: number, d: number, depth: number, r = 1.2) {
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
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** 幕墙：竖梃 + 玻璃 + 上下横梁（正面 +z 开放，便于俯视观察） */
function CurtainWall() {
  const mullions = useMemo(() => {
    const arr: { pos: [number, number, number]; rotY: number }[] = [];
    const nBack = 7;
    for (let i = 0; i <= nBack; i++) {
      arr.push({ pos: [-FLOOR_W / 2 + (FLOOR_W / nBack) * i, WALL_H / 2, -FLOOR_D / 2], rotY: 0 });
    }
    const nSide = 5;
    for (let i = 0; i <= nSide; i++) {
      const z = -FLOOR_D / 2 + (FLOOR_D / nSide) * i;
      arr.push({ pos: [-FLOOR_W / 2, WALL_H / 2, z], rotY: Math.PI / 2 });
      arr.push({ pos: [FLOOR_W / 2, WALL_H / 2, z], rotY: Math.PI / 2 });
    }
    return arr;
  }, []);

  const glassMat = (
    <meshStandardMaterial
      color="#9FBEDF"
      transparent
      opacity={0.06}
      roughness={0.05}
      metalness={0.1}
      side={THREE.DoubleSide}
      depthWrite={false}
    />
  );

  return (
    <group>
      {/* 玻璃面 */}
      <mesh position={[0, WALL_H / 2, -FLOOR_D / 2]}>
        <boxGeometry args={[FLOOR_W, WALL_H, 0.04]} />
        {glassMat}
      </mesh>
      <mesh position={[-FLOOR_W / 2, WALL_H / 2, 0]}>
        <boxGeometry args={[0.04, WALL_H, FLOOR_D]} />
        {glassMat}
      </mesh>
      <mesh position={[FLOOR_W / 2, WALL_H / 2, 0]}>
        <boxGeometry args={[0.04, WALL_H, FLOOR_D]} />
        {glassMat}
      </mesh>
      {/* 竖梃（实例化） */}
      <Instances limit={mullions.length}>
        <boxGeometry args={[0.055, WALL_H, 0.055]} />
        <meshStandardMaterial color={FRAME} metalness={0.6} roughness={0.35} />
        {mullions.map((m, i) => (
          <Instance key={i} position={m.pos} rotation={[0, m.rotY, 0]} />
        ))}
      </Instances>
      {/* 上下横梁（背 + 两侧） */}
      {[
        { pos: [0, WALL_H, -FLOOR_D / 2] as [number, number, number], size: [FLOOR_W + 0.1, 0.12, 0.14] as [number, number, number] },
        { pos: [0, 0.05, -FLOOR_D / 2] as [number, number, number],   size: [FLOOR_W + 0.1, 0.1, 0.14] as [number, number, number] },
        { pos: [-FLOOR_W / 2, WALL_H, 0] as [number, number, number], size: [0.14, 0.12, FLOOR_D] as [number, number, number] },
        { pos: [-FLOOR_W / 2, 0.05, 0] as [number, number, number],   size: [0.14, 0.1, FLOOR_D] as [number, number, number] },
        { pos: [FLOOR_W / 2, WALL_H, 0] as [number, number, number],  size: [0.14, 0.12, FLOOR_D] as [number, number, number] },
        { pos: [FLOOR_W / 2, 0.05, 0] as [number, number, number],    size: [0.14, 0.1, FLOOR_D] as [number, number, number] },
      ].map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color={FRAME} metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

/** 线性吊灯：细吊索 + 发光灯管 */
function PendantLight({ position, length = 3.4 }: { position: [number, number, number]; length?: number }) {
  return (
    <group position={position}>
      <mesh position={[-length / 2 + 0.3, 0.45, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.9, 4]} />
        <meshStandardMaterial color="#454C5A" />
      </mesh>
      <mesh position={[length / 2 - 0.3, 0.45, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.9, 4]} />
        <meshStandardMaterial color="#454C5A" />
      </mesh>
      <mesh>
        <boxGeometry args={[length, 0.08, 0.2]} />
        <meshStandardMaterial color="#3A424F" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[length - 0.08, 0.035, 0.16]} />
        <meshBasicMaterial color="#FFF3DC" toneMapped={false} />
      </mesh>
    </group>
  );
}

/** 盆栽：陶盆 + 层叠球状绿植 */
function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.2, 0.26, 0.36, 10]} />
        <meshStandardMaterial color="#4A5262" roughness={0.7} /></mesh>
      <mesh position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshStandardMaterial color="#3E9463" roughness={1} />
      </mesh>
      <mesh position={[0.14, 0.78, 0.05]}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshStandardMaterial color="#4AAB74" roughness={1} />
      </mesh>
      <mesh position={[-0.13, 0.72, -0.08]}>
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshStandardMaterial color="#358355" roughness={1} />
      </mesh>
    </group>
  );
}

export default function HexPlatform() {
  const floorGeo = useMemo(() => roundedRectGeo(FLOOR_W, FLOOR_D, 0.16), []);
  const rootRef = useAutoShadows();
  const carpetTex = useMemo(() => getCarpetTexture('#333D50'), []);
  const walkwayTex = useMemo(() => getWoodTexture('#7E6044', '#5C4630', 'walkway'), []);

  // 地毯拼块网格线（实例化细条）
  const gridLines = useMemo(() => {
    const lines: { pos: [number, number, number]; scl: [number, number, number] }[] = [];
    for (let x = -15; x <= 15; x += 2.5) {
      lines.push({ pos: [x, 0.005, 0], scl: [0.02, 0.002, FLOOR_D - 2] });
    }
    for (let z = -11; z <= 11; z += 2.5) {
      lines.push({ pos: [0, 0.005, z], scl: [FLOOR_W - 2, 0.002, 0.02] });
    }
    return lines;
  }, []);

  return (
    <group ref={rootRef}>
      {/* 楼板（地毯面 · 程序化地毯纹理） */}
      <mesh geometry={floorGeo} position={[0, 0, 0]}>
        <meshStandardMaterial map={carpetTex} color="#B9C4DA" roughness={0.92} metalness={0.02} />
      </mesh>
      {/* 楼板侧沿 LED 缝光 */}
      <mesh position={[0, -0.17, 0]}>
        <boxGeometry args={[FLOOR_W - 0.6, 0.03, FLOOR_D - 0.6]} />
        <meshBasicMaterial color="#3B82F6" transparent opacity={0.28} toneMapped={false} />
      </mesh>

      {/* 地毯拼块网格 */}
      <Instances limit={gridLines.length}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#2A3242" transparent opacity={0.5} />
        {gridLines.map((l, i) => (
          <Instance key={i} position={l.pos} scale={l.scl} />
        ))}
      </Instances>

      {/* 木纹主走道（横贯业务区与休闲区之间） */}
      <mesh position={[0.5, 0.012, 2.65]}>
        <boxGeometry args={[25, 0.02, 1.5]} />
        <meshStandardMaterial map={walkwayTex} color="#D8C0A0" roughness={0.7} metalness={0.05} />
      </mesh>
      {/* 走道拼板缝 */}
      <Instances limit={17}>
        <boxGeometry args={[0.015, 0.005, 1.5]} />
        <meshBasicMaterial color="#57422C" />
        {Array.from({ length: 17 }, (_, i) => (
          <Instance key={i} position={[0.5 - 12 + i * 1.5, 0.024, 2.65]} />
        ))}
      </Instances>

      {/* 幕墙 */}
      <CurtainWall />

      {/* 线性吊灯 */}
      <PendantLight position={[0, 4.1, -2.9]} length={7} />
      <PendantLight position={[0, 4.1, -0.2]} length={7} />
      <PendantLight position={[-9, 4.0, -3]} length={4} />
      <PendantLight position={[9.5, 4.2, -7.5]} length={4.4} />
      <PendantLight position={[-6, 4.0, 5.5]} length={4.4} />
      <PendantLight position={[7.8, 4.0, 5.6]} length={3.6} />

      {/* 绿植点缀 */}
      <Plant position={[-14, 0.02, -10.5]} scale={1.4} />
      <Plant position={[14.6, 0.02, -3.6]} scale={1.2} />
      <Plant position={[-14.2, 0.02, 7.8]} scale={1.3} />
      <Plant position={[3.6, 0.02, -9.8]} scale={1.1} />
      <Plant position={[-2.4, 0.02, 8.6]} scale={1.0} />
      <Plant position={[13.2, 0.02, 3.4]} scale={1.0} />
    </group>
  );
}
