import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * 挂载后遍历子树自动标记阴影：
 * 不透明网格投射 + 接收阴影；发光/透明网格（LED、光圈、玻璃）只接收不投射
 */
export function useAutoShadows(deps: unknown[] = []) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    ref.current?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as (THREE.Material & { toneMapped?: boolean }) | undefined;
      const isGlow = !mat || mat.transparent || mat.toneMapped === false;
      mesh.castShadow = !isGlow;
      mesh.receiveShadow = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
