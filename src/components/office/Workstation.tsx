import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { Employee } from '../../lib/types';

const statusColor: Record<string, string> = {
  working: '#00ffff',
  idle: '#5b8cff',
  blocked: '#ff3860',
  meeting: '#ff00aa',
  training: '#a855f7',
};

export default function Workstation({ employee, onClick }: { employee: Employee; onClick: () => void }) {
  const figureRef = useRef<THREE.Mesh>(null);
  const screenRef = useRef<THREE.Mesh>(null);
  const auraRef = useRef<THREE.Mesh>(null);
  const ribbonRef = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);

  const c = statusColor[employee.status];

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    // Avatar gentle bob (typing)
    if (figureRef.current) {
      if (employee.status === 'working' || employee.status === 'meeting') {
        figureRef.current.position.y = 0.55 + Math.sin(t * 4 + employee.position[0]) * 0.02;
      }
    }
    // Aura pulse for risk
    if (auraRef.current) {
      const mat = auraRef.current.material as THREE.MeshBasicMaterial;
      if (employee.status === 'blocked') {
        mat.opacity = 0.35 + Math.sin(t * 6) * 0.25;
      } else if (employee.status === 'training') {
        mat.opacity = 0.25 + Math.sin(t * 3) * 0.18;
      } else {
        const target = hover ? 0.32 : 0.16;
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, target, dt * 4);
      }
    }
    // Screen flicker
    if (screenRef.current) {
      const mat = screenRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.7 + Math.sin(t * 9 + employee.position[2]) * 0.12;
    }
    // Twin ribbon shimmer
    if (ribbonRef.current) {
      const mat = ribbonRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.35 + Math.sin(t * 2 + employee.position[0]) * 0.2;
    }
  });

  return (
    <group
      position={employee.position}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = 'default'; }}
    >
      {/* Aura ring */}
      <mesh ref={auraRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.3]}>
        <ringGeometry args={[0.7, 0.95, 32]} />
        <meshBasicMaterial color={c} transparent opacity={0.2} side={THREE.DoubleSide} />
      </mesh>

      {/* Desk */}
      <mesh position={[0, 0.32, 0.7]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.06, 0.7]} />
        <meshStandardMaterial color="#0a0e27" metalness={0.8} roughness={0.3} emissive="#00ffff" emissiveIntensity={0.04} />
      </mesh>
      {/* Desk legs */}
      <mesh position={[-0.55, 0.16, 0.7]}>
        <boxGeometry args={[0.05, 0.32, 0.05]} />
        <meshStandardMaterial color="#161c4a" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0.55, 0.16, 0.7]}>
        <boxGeometry args={[0.05, 0.32, 0.05]} />
        <meshStandardMaterial color="#161c4a" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Monitor */}
      <mesh ref={screenRef} position={[0, 0.78, 0.95]} rotation={[-Math.PI / 16, 0, 0]}>
        <boxGeometry args={[1.0, 0.6, 0.04]} />
        <meshStandardMaterial color="#04060f" emissive={c} emissiveIntensity={0.8} metalness={0.4} roughness={0.3} />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0, 0.45, 0.95]}>
        <boxGeometry args={[0.08, 0.2, 0.05]} />
        <meshStandardMaterial color="#161c4a" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Avatar (capsule = body + sphere head) */}
      <mesh ref={figureRef} position={[0, 0.55, 0.05]} castShadow>
        <capsuleGeometry args={[0.18, 0.4, 6, 12]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.5} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.95, 0.05]} castShadow>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial color="#04060f" emissive={c} emissiveIntensity={0.6} metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Name label on desk */}
      <Text
        position={[0, 0.36, 0.3]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.13}
        color={c}
        anchorX="center"
        anchorY="middle"
      >
        {employee.name}
      </Text>

      {/* Twin ribbon upward */}
      <mesh ref={ribbonRef} position={[0, 2.0, 0.05]}>
        <cylinderGeometry args={[0.012, 0.012, 2.8, 6]} />
        <meshBasicMaterial color={employee.status === 'blocked' ? '#ff3860' : '#ff00aa'} transparent opacity={0.4} />
      </mesh>

      {/* HTML floating card on hover */}
      {hover && (
        <Html position={[0, 1.8, 0]} center distanceFactor={9}>
          <div className="pointer-events-none glass-strong rounded-sm p-2 min-w-[180px] border" style={{ borderColor: `${c}88` }}>
            <div className="flex items-center gap-2">
              <span className="font-display text-sm" style={{ color: c }}>{employee.name}</span>
              <span className="text-[10px] font-mono text-slate-400">{employee.role}</span>
            </div>
            <div className="text-[10px] font-mono mt-1" style={{ color: `${c}cc` }}>
              {employee.status === 'working' && '● 工作中'}
              {employee.status === 'blocked' && '● 守护者阻断'}
              {employee.status === 'meeting' && '● 会议中'}
              {employee.status === 'training' && '● 进化训练'}
              {employee.status === 'idle' && '● 待命'}
            </div>
            <div className="text-[10px] text-slate-300 mt-1 max-w-[220px] truncate">{employee.currentTask}</div>
          </div>
        </Html>
      )}
    </group>
  );
}
