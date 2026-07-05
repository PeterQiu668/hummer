/**
 * 深空蓝远景：8 片程序化城市剪影 + fog
 * v9：楼栋与窗口全部实例化 —— 此前 ~2000 个独立 mesh（全场景最大的 draw call 热点），
 * 现在合并为 2 个 InstancedMesh（楼栋 1 + 窗口 1）。
 */
import { useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';

interface SilhouetteSpec { position: [number, number, number]; scale: number; seed: number }

/** 中距离城市天际线：幕墙外可见，但不压迫总部 */
const SILHOUETTES: SilhouetteSpec[] = [
  { position: [-34, -6, -42], scale: 1.0,  seed: 1 },
  { position: [0, -6, -48],   scale: 1.15, seed: 2 },
  { position: [34, -6, -42],  scale: 0.95, seed: 3 },
  { position: [46, -6, -10],  scale: 0.85, seed: 4 },
  { position: [40, -6, 32],   scale: 0.9,  seed: 5 },
  { position: [-40, -6, 32],  scale: 0.95, seed: 6 },
  { position: [-46, -6, -10], scale: 0.9,  seed: 7 },
];

interface BuildingInst { pos: [number, number, number]; scl: [number, number, number] }
interface WindowInst { pos: [number, number, number]; scl: number; purple: boolean }

function buildCity() {
  const buildings: BuildingInst[] = [];
  const windows: WindowInst[] = [];
  for (const sil of SILHOUETTES) {
    const rng = (n: number) => {
      const x = Math.sin(sil.seed * 9999 + n * 31.7) * 43758.5453;
      return x - Math.floor(x);
    };
    let x = -20;
    for (let i = 0; i < 14; i++) {
      const w = 1.5 + rng(i * 2) * 3;
      const h = 6 + rng(i * 2 + 1) * 18;
      const d = 1.2 + rng(i * 2 + 2) * 1.5;
      const bx = x + w / 2;
      buildings.push({
        pos: [sil.position[0] + bx * sil.scale, sil.position[1] + (h / 2) * sil.scale, sil.position[2]],
        scl: [w * sil.scale, h * sil.scale, d * sil.scale],
      });
      const rows = Math.floor(h / 1.2);
      const cols = Math.floor(w / 0.6);
      let wi = 0;
      for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rng(i * 100 + r * 7 + c) > 0.62) {
            const wx = (c / cols - 0.5) * w;
            const wy = r * 1.1 - h / 2;
            windows.push({
              pos: [
                sil.position[0] + (bx + wx) * sil.scale,
                sil.position[1] + (h / 2 + wy) * sil.scale,
                sil.position[2] + (d / 2 + 0.01) * sil.scale,
              ],
              scl: sil.scale,
              purple: wi % 5 === 0,
            });
            wi++;
          }
        }
      }
      x += w + 0.2;
    }
  }
  return { buildings, windows };
}

export default function CityBackground() {
  const { buildings, windows } = useMemo(buildCity, []);

  return (
    <>
      <color attach="background" args={['#0A101E']} />
      {/* fog 拉远：室内不受影响，幕墙外城市夜景可见 */}
      <fog attach="fog" args={['#0A101E', 34, 110]} />

      {/* 楼栋 · 单位盒实例化（1 draw call） */}
      <Instances limit={buildings.length} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#0D1424" roughness={1} metalness={0} />
        {buildings.map((b, i) => (
          <Instance key={i} position={b.pos} scale={b.scl} />
        ))}
      </Instances>

      {/* 窗口 · 实例化 + 每实例颜色（1 draw call） */}
      <Instances limit={windows.length} frustumCulled={false}>
        <planeGeometry args={[0.18, 0.32]} />
        <meshBasicMaterial toneMapped={false} side={THREE.FrontSide} />
        {windows.map((w, i) => (
          <Instance
            key={i}
            position={w.pos}
            scale={[w.scl, w.scl, 1]}
            color={w.purple ? '#9B7FDB' : '#6E8FD6'}
          />
        ))}
      </Instances>

      {/* 远处地平线微光 */}
      <mesh position={[0, -3, -50]}>
        <planeGeometry args={[200, 0.6]} />
        <meshBasicMaterial color="#1e3a5f" transparent opacity={0.4} toneMapped={false} />
      </mesh>
    </>
  );
}
