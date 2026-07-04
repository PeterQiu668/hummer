import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import gsap from 'gsap';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import { ZONE_SPECS } from './ZonePlatform';
import { workstations } from '../../data/workstations';

// 从 Workstations.tsx 复制的简化映射（避免循环依赖）
const ZONE_2D_CENTERS: Record<string, { x: number; y: number }> = {
  boss: { x: 81, y: 19 },
  business: { x: 47, y: 45 },
  support: { x: 18, y: 42 },
  meeting: { x: 69, y: 61 },
  rest: { x: 88, y: 54 },
  learn: { x: 17, y: 21 },
  transit: { x: 55, y: 73 },
};

function getEmployeePos3D(employeeId: string): [number, number, number] | null {
  const ws = workstations.find((w) => w.employeeId === employeeId);
  if (!ws) return null;
  const c2d = ZONE_2D_CENTERS[ws.zone];
  const spec = ZONE_SPECS.find((s) => s.id === ws.zone);
  if (!spec || !c2d) return null;
  const dx = ws.x - c2d.x;
  const dy = ws.y - c2d.y;
  const scaleX = (spec.size[0] * 0.35) / 10;
  const scaleZ = (spec.size[1] * 0.35) / 8;
  return [spec.center[0] + dx * scaleX, spec.elevation + 1.0, spec.center[1] + dy * scaleZ];
}

const OVERVIEW = {
  pos: new THREE.Vector3(0, 22, 28),
  look: new THREE.Vector3(0, 0, 0),
  fov: 38,
};

export default function CameraRig3D() {
  const { activeZone, selectedEmployee } = useAppStore();
  const { camera, controls } = useThree() as any;
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  useEffect(() => {
    let target: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } = OVERVIEW;

    if (selectedEmployee) {
      const p = getEmployeePos3D(selectedEmployee.id);
      if (p) {
        const [ex, ey, ez] = p;
        target = {
          pos: new THREE.Vector3(ex + 2, ey + 1.2, ez + 2.5),
          look: new THREE.Vector3(ex, 1, ez),
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
      },
    );

    return () => {
      tweenRef.current?.kill();
    };
  }, [activeZone, selectedEmployee, camera, controls]);

  return null;
}
