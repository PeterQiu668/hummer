import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import gsap from 'gsap';
import * as THREE from 'three';
import type { ZoneId } from '../../lib/types';

interface CamTarget {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

const OVERVIEW: CamTarget = {
  pos: new THREE.Vector3(0, 18, 22),
  look: new THREE.Vector3(0, 0, 2),
};

export default function CameraRig({
  activeZone,
  zones,
}: {
  activeZone: ZoneId | null;
  zones: { id: ZoneId; pos: [number, number, number]; size: [number, number] }[];
}) {
  const { camera } = useThree();
  const targetLook = useRef(new THREE.Vector3(0, 0, 2));
  const baseDriftRef = useRef({ t: 0, focused: false });

  useEffect(() => {
    let target = OVERVIEW;
    if (activeZone) {
      const z = zones.find((zz) => zz.id === activeZone);
      if (z) {
        target = {
          pos: new THREE.Vector3(z.pos[0] * 0.7, 7, z.pos[2] + 7),
          look: new THREE.Vector3(z.pos[0], 0.4, z.pos[2]),
        };
      }
    }
    baseDriftRef.current.focused = !!activeZone;

    const obj = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    gsap.to(obj, {
      x: target.pos.x,
      y: target.pos.y,
      z: target.pos.z,
      duration: 1.6,
      ease: 'power3.inOut',
      onUpdate: () => camera.position.set(obj.x, obj.y, obj.z),
    });
    const look = { x: targetLook.current.x, y: targetLook.current.y, z: targetLook.current.z };
    gsap.to(look, {
      x: target.look.x,
      y: target.look.y,
      z: target.look.z,
      duration: 1.6,
      ease: 'power3.inOut',
      onUpdate: () => {
        targetLook.current.set(look.x, look.y, look.z);
        camera.lookAt(targetLook.current);
      },
    });
  }, [activeZone, camera, zones]);

  useFrame((_, dt) => {
    baseDriftRef.current.t += dt;
    if (!baseDriftRef.current.focused) {
      const t = baseDriftRef.current.t;
      camera.position.x = OVERVIEW.pos.x + Math.sin(t * 0.18) * 1.4;
      camera.position.z = OVERVIEW.pos.z + Math.cos(t * 0.12) * 1.4;
      camera.lookAt(targetLook.current);
    }
  });

  return null;
}
