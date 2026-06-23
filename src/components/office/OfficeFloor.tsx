import { useMemo } from 'react';
import * as THREE from 'three';

export default function OfficeFloor() {
  const gridTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#070a1a';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(0,255,255,0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 256; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,255,255,0.4)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i <= 256; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 6);
    return tex;
  }, []);

  return (
    <group>
      {/* Main floor */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 2]}>
        <planeGeometry args={[34, 22]} />
        <meshStandardMaterial map={gridTexture} color="#0a0e27" emissive="#0a0e27" emissiveIntensity={0.4} roughness={0.7} metalness={0.4} />
      </mesh>

      {/* Outer ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 2]}>
        <ringGeometry args={[16.5, 17, 64]} />
        <meshBasicMaterial color="#00ffff" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>

      {/* Central pillar of light */}
      <mesh position={[0, 6, 2]}>
        <cylinderGeometry args={[0.06, 0.06, 12, 16]} />
        <meshBasicMaterial color="#00ffff" />
      </mesh>
      <pointLight position={[0, 0.3, 2]} intensity={1.2} color="#00ffff" distance={6} />
    </group>
  );
}
