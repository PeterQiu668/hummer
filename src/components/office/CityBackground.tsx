import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * 深空蓝远景：8 片程序化城市剪影 + fog
 * 每片是若干 Box（楼栋），顶部随机点（emissive 窗口）
 */
function CitySilhouette({ position, scale = 1, seed = 1 }: { position: [number, number, number]; scale?: number; seed?: number }) {
  const buildings = useMemo(() => {
    const rng = (n: number) => {
      const x = Math.sin(seed * 9999 + n * 31.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const arr: { x: number; w: number; h: number; d: number; windows: { x: number; y: number }[] }[] = [];
    let x = -20;
    for (let i = 0; i < 14; i++) {
      const w = 1.5 + rng(i * 2) * 3;
      const h = 6 + rng(i * 2 + 1) * 18;
      const d = 1.2 + rng(i * 2 + 2) * 1.5;
      const windows: { x: number; y: number }[] = [];
      const rows = Math.floor(h / 1.2);
      const cols = Math.floor(w / 0.6);
      for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rng(i * 100 + r * 7 + c) > 0.6) {
            windows.push({ x: (c / cols - 0.5) * w, y: r * 1.1 - h / 2 });
          }
        }
      }
      arr.push({ x: x + w / 2, w, h, d, windows });
      x += w + 0.2;
    }
    return arr;
  }, [seed]);

  return (
    <group position={position} scale={scale}>
      {buildings.map((b, i) => (
        <group key={i} position={[b.x, b.h / 2, 0]}>
          <mesh>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color="#070b1a" roughness={1} metalness={0} />
          </mesh>
          {b.windows.map((w, j) => (
            <mesh key={j} position={[w.x, w.y, b.d / 2 + 0.01]}>
              <planeGeometry args={[0.18, 0.32]} />
              <meshBasicMaterial color={j % 5 === 0 ? '#A855F7' : '#3B82F6'} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

export default function CityBackground() {
  return (
    <>
      <color attach="background" args={['#0a0f1e']} />
      <fog attach="fog" args={['#0a0f1e', 35, 90]} />

      {/* 8 片城市剪影呈环形分布在远处 */}
      <CitySilhouette position={[-40, -2, -45]} scale={1.1} seed={1} />
      <CitySilhouette position={[0, -2, -55]} scale={1.3} seed={2} />
      <CitySilhouette position={[40, -2, -45]} scale={1.0} seed={3} />
      <CitySilhouette position={[55, -2, 0]} scale={0.9} seed={4} />
      <CitySilhouette position={[40, -2, 45]} scale={1.0} seed={5} />
      <CitySilhouette position={[-40, -2, 45]} scale={1.1} seed={6} />
      <CitySilhouette position={[-55, -2, 0]} scale={1.0} seed={7} />
      <CitySilhouette position={[0, -2, 55]} scale={0.9} seed={8} />

      {/* 远处地平线微光 */}
      <mesh position={[0, -3, -50]} rotation={[0, 0, 0]}>
        <planeGeometry args={[200, 0.6]} />
        <meshBasicMaterial color="#1e3a5f" transparent opacity={0.4} toneMapped={false} />
      </mesh>
    </>
  );
}
