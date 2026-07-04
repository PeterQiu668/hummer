import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import gsap from 'gsap';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import { ZONE_SPECS } from './ZonePlatform';
import { getEmployeePos3D } from './scenePositions';

const OVERVIEW = {
  pos: new THREE.Vector3(0, 22, 28),
  look: new THREE.Vector3(0, 0, 0),
  fov: 38,
};

export default function CameraRig3D() {
  const activeZone = useAppStore((s) => s.activeZone);
  const selectedEmployeeId = useAppStore((s) => s.selectedEmployee?.id ?? null);
  const { camera, controls } = useThree() as any;
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  useEffect(() => {
    let target: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } = OVERVIEW;

    if (selectedEmployeeId) {
      const p = getEmployeePos3D(selectedEmployeeId);
      if (p) {
        const [ex, ey, ez] = p;
        target = {
          pos: new THREE.Vector3(ex + 2, ey + 2.2, ez + 2.5),
          look: new THREE.Vector3(ex, ey + 1, ez),
          fov: 35,
        };
      }
    } else if (activeZone) {
      const spec = ZONE_SPECS.find((s) => s.id === activeZone);
      if (spec) {
        const zx = spec.center[0];
        const zz = spec.center[1];
        target = {
          pos: new THREE.Vector3(zx * 0.7, 9, zz + 10),
          look: new THREE.Vector3(zx, spec.elevation + 0.5, zz),
          fov: 42,
        };
      }
    }

    if (tweenRef.current) tweenRef.current.kill();
    if (controls) controls.enabled = false;

    const camPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const lookObj = controls
      ? { x: controls.target.x, y: controls.target.y, z: controls.target.z }
      : { x: 0, y: 0, z: 0 };
    const fovObj = { v: (camera as THREE.PerspectiveCamera).fov };

    tweenRef.current = gsap.to(
      { ...camPos, lx: lookObj.x, ly: lookObj.y, lz: lookObj.z, fv: fovObj.v },
      {
        x: target.pos.x,
        y: target.pos.y,
        z: target.pos.z,
        lx: target.look.x,
        ly: target.look.y,
        lz: target.look.z,
        fv: target.fov,
        duration: 1.4,
        ease: 'power3.inOut',
        onUpdate: function () {
          const t = this.targets()[0] as any;
          camera.position.set(t.x, t.y, t.z);
          if (controls) controls.target.set(t.lx, t.ly, t.lz);
          (camera as THREE.PerspectiveCamera).fov = t.fv;
          (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
          if (controls) controls.update();
        },
        onComplete: () => {
          if (controls) controls.enabled = true;
        },
        // kill() 不触发 onComplete —— 中断时兜底恢复交互，避免 OrbitControls 永久锁死
        onInterrupt: () => {
          if (controls) controls.enabled = true;
        },
      },
    );

    return () => {
      tweenRef.current?.kill();
      if (controls) controls.enabled = true;
    };
  }, [activeZone, selectedEmployeeId, camera, controls]);

  return null;
}
