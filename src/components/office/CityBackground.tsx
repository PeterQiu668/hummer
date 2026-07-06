/**
 * 背景 v15 · 明亮渐变天幕（浅色高端风格）
 * 大型内翻球体 + 竖向渐变 CanvasTexture：顶部柔和天蓝 → 底部近白。
 * 不再是黑色虚空；配轻雾（浅色，几乎不可见）柔化远景边缘。
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { BACKDROP_TOP, BACKDROP_BOT, FOG_COLOR } from './palette';

function makeGradientTexture(top: string, bottom: string): THREE.CanvasTexture {
  const h = 256;
  const c = document.createElement('canvas');
  c.width = 4; c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(0.55, bottom);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function CityBackground() {
  const tex = useMemo(() => makeGradientTexture(BACKDROP_TOP, BACKDROP_BOT), []);
  return (
    <>
      <fog attach="fog" args={[FOG_COLOR, 55, 150]} />
      {/* 内翻球天幕 */}
      <mesh scale={[-1, 1, 1]}>
        <sphereGeometry args={[120, 32, 16]} />
        <meshBasicMaterial map={tex} side={THREE.BackSide} toneMapped={false} depthWrite={false} fog={false} />
      </mesh>
    </>
  );
}
