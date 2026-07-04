import { useMemo } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';

/**
 * 六边形悬浮平台：ExtrudeGeometry · 半径 16 · 高 0.8
 * 底部加体积光 cylinder（additive blending）
 */
export default function HexPlatform() {
  const geometry = useMemo(() => {
    const radius = 16;
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      if (i === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.8,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 0);
    return geo;
  }, []);

  return (
    <group>
      {/* 主平台 */}
      <mesh geometry={geometry} position={[0, -0.4, 0]} receiveShadow>
        <meshStandardMaterial
          color="#121a2e"
          roughness={0.55}
          metalness={0.4}
          emissive="#0a0f1e"
          emissiveIntensity={0.4}
        />
        <Edges color="#3B82F6" threshold={15} />
      </mesh>

      {/* 平台顶面网格纹 */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[8, 15.5, 6, 1]} />
        <meshBasicMaterial color="#3B82F6" transparent opacity={0.08} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* 底部体积光 · 3 根 cylinder additive */}
      {[0, 1, 2].map((i) => {
        const a = (Math.PI * 2 * i) / 3;
        return (
          <mesh key={i} position={[Math.cos(a) * 6, -6, Math.sin(a) * 6]}>
            <cylinderGeometry args={[0.8, 2.4, 11, 16, 1, true]} />
            <meshBasicMaterial
              color={i === 1 ? '#A855F7' : '#3B82F6'}
              transparent
              opacity={0.12}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        );
      })}

      {/* 中心光晕 */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3, 32]} />
        <meshBasicMaterial color="#3B82F6" transparent opacity={0.18} toneMapped={false} />
      </mesh>
    </group>
  );
}
