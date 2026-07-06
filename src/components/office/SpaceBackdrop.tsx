/**
 * SpaceBackdrop · 深空背景（v12：替代城市楼群 —— 楼群缩小时会闯进前景遮挡）
 * 星空 + 软辉光地台 + 地平线光晕，突出悬浮总部的未来感
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';

/** 生成径向渐变软光斑纹理（中心亮 → 边缘透明） */
function makeGlowTexture(inner: string, outer = 'rgba(0,0,0,0)') {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export default function SpaceBackdrop() {
  const wellTex = useMemo(() => makeGlowTexture('rgba(20,184,166,0.5)'), []);
  const hazeTex = useMemo(() => makeGlowTexture('rgba(59,130,246,0.22)'), []);
  const wellMat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    if (wellMat.current) wellMat.current.opacity = 0.5 + 0.14 * Math.sin(clock.elapsedTime * 0.5);
  });

  return (
    <>
      <color attach="background" args={['#05070f']} />
      <fog attach="fog" args={['#05070f', 50, 130]} />

      {/* 星幕 */}
      <Stars radius={95} depth={45} count={2600} factor={3.6} saturation={0.25} fade speed={0.6} />

      {/* 基座下方能量井辉光 */}
      <mesh position={[0, -16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[90, 90]} />
        <meshBasicMaterial ref={wellMat} map={wellTex} transparent opacity={0.55} toneMapped={false} depthWrite={false} />
      </mesh>

      {/* 远景冷色霾光（后方地平线，替代城市轮廓的纵深感） */}
      <mesh position={[0, 4, -85]}>
        <planeGeometry args={[240, 90]} />
        <meshBasicMaterial map={hazeTex} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[-70, 0, 40]} rotation={[0, Math.PI / 2.4, 0]}>
        <planeGeometry args={[160, 70]} />
        <meshBasicMaterial map={hazeTex} transparent opacity={0.3} toneMapped={false} depthWrite={false} />
      </mesh>
    </>
  );
}
