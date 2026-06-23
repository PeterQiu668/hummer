import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ZoneId } from '../../lib/types';
import { employees } from '../../data/employees';

interface Props {
  id: ZoneId;
  label: string;
  sub: string;
  pos: [number, number, number];
  size: [number, number];
  color: string;
  active: boolean;
  focused: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

export default function Zone({ id, label, sub, pos, size, color, active, focused, onClick, onDoubleClick }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);

  useFrame((_, dt) => {
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      const target = hover ? 0.7 : focused ? 0.55 : 0.32;
      mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, target, dt * 4);
    }
  });

  const count = employees.filter((e) => e.zone === id).length;
  const opacity = active ? 1 : 0.25;

  return (
    <group position={pos}>
      {/* Floor tile */}
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        receiveShadow
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = 'default'; }}
      >
        <planeGeometry args={[size[0], size[1]]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          transparent
          opacity={0.18 * opacity}
          roughness={0.5}
          metalness={0.3}
        />
      </mesh>

      {/* Border lines */}
      <BorderLines size={size} color={color} opacity={opacity} hover={hover || focused} />

      {/* Walls (low) */}
      <Walls size={size} color={color} opacity={opacity * 0.7} />

      {/* Label */}
      <Text
        position={[-size[0] / 2 + 0.4, 0.2, -size[1] / 2 + 0.6]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.4}
        color={color}
        anchorX="left"
        anchorY="middle"
        fillOpacity={opacity}
      >
        {label}
      </Text>
      <Text
        position={[-size[0] / 2 + 0.4, 0.2, -size[1] / 2 + 1.05]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.22}
        color={color}
        anchorX="left"
        anchorY="middle"
        fillOpacity={opacity * 0.6}
      >
        {sub} · {count} AGENTS
      </Text>

      {/* Floating holo label */}
      {(hover || focused) && (
        <Html position={[0, 2.6, 0]} center distanceFactor={10} occlude={false}>
          <div className="pointer-events-none px-2 py-1 rounded-sm glass-strong border" style={{ borderColor: `${color}88` }}>
            <div className="text-[10px] font-display tracking-widest" style={{ color }}>{label}</div>
            <div className="text-[9px] font-mono text-slate-400">{sub}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

function BorderLines({ size, color, opacity, hover }: { size: [number, number]; color: string; opacity: number; hover: boolean }) {
  const [w, h] = size;
  const corners: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  return (
    <group>
      {corners.map(([x, z], i) => {
        const [x2, z2] = corners[(i + 1) % corners.length];
        const mx = (x + x2) / 2;
        const mz = (z + z2) / 2;
        const len = Math.hypot(x2 - x, z2 - z);
        const rotY = Math.atan2(z2 - z, x2 - x);
        return (
          <mesh key={i} position={[mx, 0.04, mz]} rotation={[-Math.PI / 2, 0, -rotY]}>
            <planeGeometry args={[len, 0.06]} />
            <meshBasicMaterial color={color} transparent opacity={(hover ? 0.9 : 0.55) * opacity} />
          </mesh>
        );
      })}
      {/* Corner brackets */}
      {corners.map(([x, z], i) => (
        <group key={`c${i}`} position={[x, 0.06, z]}>
          <mesh>
            <boxGeometry args={[0.45, 0.04, 0.06]} />
            <meshBasicMaterial color={color} transparent opacity={opacity} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.06, 0.04, 0.45]} />
            <meshBasicMaterial color={color} transparent opacity={opacity} />
          </mesh>
          <mesh position={[0, 0.4, 0]}>
            <boxGeometry args={[0.05, 0.8, 0.05]} />
            <meshBasicMaterial color={color} transparent opacity={opacity * 0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Walls({ size, color, opacity }: { size: [number, number]; color: string; opacity: number }) {
  const [w, h] = size;
  return (
    <group position={[0, 0, 0]}>
      {[
        { p: [0, 0.5, -h / 2], r: [0, 0, 0], s: [w, 1, 0.05] },
        { p: [0, 0.5, h / 2], r: [0, 0, 0], s: [w, 1, 0.05] },
        { p: [-w / 2, 0.5, 0], r: [0, 0, 0], s: [0.05, 1, h] },
        { p: [w / 2, 0.5, 0], r: [0, 0, 0], s: [0.05, 1, h] },
      ].map((wall, i) => (
        <mesh key={i} position={wall.p as any}>
          <boxGeometry args={wall.s as any} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.3}
            transparent
            opacity={0.18 * opacity}
            metalness={0.6}
            roughness={0.4}
          />
        </mesh>
      ))}
    </group>
  );
}
