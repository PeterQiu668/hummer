/**
 * 霓虹科幻渲染原语（SYBERNETIC 风格 · 零外部资源）
 * - GlowPlane：径向渐变加性辉光贴片（无后期管线的 bloom 替代）
 * - NeonBar：发光灯条（本体 + 辉光）
 * - NeonRectOutline：地面霓虹圆角框线（分区边界）
 * - NeonSignPanel：切角面板霓虹招牌（墙面/悬浮）
 * - FloorText：地面蚀刻发光文字
 * - HoloScreen：全息 UI 屏（Canvas 程序化 UI 纹理 + 加性混合）
 */
import { useMemo } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

export const NEON = '#3EE0FF';
export const NEON_DIM = '#1FB6E0';
export const NEON_TEXT = '#CFF6FF';
export const PANEL = '#1A2028';
export const PANEL_EDGE = '#2A333F';

/* ── 缓存纹理 ── */
const texCache = new Map<string, THREE.Texture>();

/** 径向渐变辉光纹理 */
export function getGlowTexture(): THREE.Texture {
  const hit = texCache.get('glow');
  if (hit) return hit;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  texCache.set('glow', tex);
  return tex;
}

/** 横向拉伸的灯管辉光纹理（两端衰减） */
export function getBarGlowTexture(): THREE.Texture {
  const hit = texCache.get('barglow');
  if (hit) return hit;
  const w = 256, h = 64;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const gy = ctx.createLinearGradient(0, 0, 0, h);
  gy.addColorStop(0, 'rgba(255,255,255,0)');
  gy.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  gy.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, w, h);
  // 两端衰减
  const gx = ctx.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, 'rgba(0,0,0,1)');
  gx.addColorStop(0.08, 'rgba(0,0,0,0)');
  gx.addColorStop(0.92, 'rgba(0,0,0,0)');
  gx.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  texCache.set('barglow', tex);
  return tex;
}

/** 全息 UI 纹理：同心圆环 / 数据条 / 网格，青色透明底 */
export function getHoloTexture(kind: 'rings' | 'dashboard' | 'map' | 'chart' = 'dashboard', seed = 1): THREE.Texture {
  const key = `holo:${kind}:${seed}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const w = 256, h = 192;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  let s = seed * 7 + 3;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  ctx.strokeStyle = 'rgba(102,224,255,0.9)';
  ctx.fillStyle = 'rgba(62,224,255,0.25)';
  ctx.lineWidth = 2;
  // 底面板
  ctx.fillStyle = 'rgba(30,120,170,0.22)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(102,224,255,0.8)';
  ctx.strokeRect(3, 3, w - 6, h - 6);
  if (kind === 'rings') {
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(102,224,255,${0.9 - i * 0.15})`;
      ctx.arc(w / 2, h / 2, i * 20, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(160,240,255,0.9)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'map') {
    // 抽象世界地图点阵
    ctx.fillStyle = 'rgba(102,224,255,0.75)';
    for (let i = 0; i < 380; i++) {
      const x = rnd() * w, y = rnd() * (h * 0.7) + h * 0.1;
      if (rnd() > 0.45) ctx.fillRect(x, y, 2, 2);
    }
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = 'rgba(102,224,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(rnd() * w, rnd() * h);
      ctx.quadraticCurveTo(rnd() * w, rnd() * h, rnd() * w, rnd() * h);
      ctx.stroke();
    }
  } else if (kind === 'chart') {
    ctx.strokeStyle = 'rgba(102,224,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(10, h - 20);
    for (let x = 10; x < w - 10; x += 12) {
      ctx.lineTo(x, h - 20 - rnd() * (h - 50));
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(62,224,255,0.35)';
    for (let i = 0; i < 6; i++) ctx.fillRect(12 + i * 16, h - 16, 10, -(rnd() * 30 + 6));
  } else {
    // dashboard：标题条 + 数据条 + 小圆环
    ctx.fillStyle = 'rgba(102,224,255,0.85)';
    ctx.fillRect(10, 10, w * 0.4, 8);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = 'rgba(102,224,255,0.5)';
      ctx.fillRect(10, 32 + i * 18, (0.3 + rnd() * 0.6) * (w - 90), 6);
    }
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(102,224,255,0.9)';
    ctx.lineWidth = 5;
    ctx.arc(w - 45, 55, 24, -Math.PI / 2, Math.PI * (rnd() * 1.2));
    ctx.stroke();
    ctx.fillStyle = 'rgba(102,224,255,0.6)';
    for (let i = 0; i < 3; i++) ctx.fillRect(w - 70, 100 + i * 16, 50, 5);
  }
  const tex = new THREE.CanvasTexture(c);
  texCache.set(key, tex);
  return tex;
}

/* ── 组件 ── */

/** 加性辉光贴片（billboard 用 sprite 亦可，此处固定朝向） */
export function GlowPlane({ size = [1, 1] as [number, number], color = NEON, opacity = 0.5, ...props }: {
  size?: [number, number]; color?: string; opacity?: number;
} & JSX.IntrinsicElements['mesh']) {
  return (
    <mesh {...props}>
      <planeGeometry args={size} />
      <meshBasicMaterial
        map={getBarGlowTexture()}
        color={color}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** 霓虹灯条：发光柱体 + 双面辉光 */
export function NeonBar({ length = 2, thickness = 0.045, color = NEON, glow = 1, vertical = false, ...props }: {
  length?: number; thickness?: number; color?: string; glow?: number; vertical?: boolean;
} & JSX.IntrinsicElements['group']) {
  const rot: [number, number, number] = vertical ? [0, 0, Math.PI / 2] : [0, 0, 0];
  return (
    <group {...props}>
      <group rotation={rot}>
        <mesh>
          <boxGeometry args={[length, thickness, thickness]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        {glow > 0 && (
          <GlowPlane size={[length * 1.15, thickness * 9 * glow]} color={color} opacity={0.4 * glow} />
        )}
      </group>
    </group>
  );
}

/** 地面霓虹圆角框线：4 直条 + 4 角弧 + 辉光地衬 */
export function NeonRectOutline({ w, d, r = 0.6, color = NEON, lineW = 0.05, opacity = 0.85, y = 0.012, ...props }: {
  w: number; d: number; r?: number; color?: string; lineW?: number; opacity?: number; y?: number;
} & JSX.IntrinsicElements['group']) {
  const mat = (
    <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} depthWrite={false} />
  );
  const arc = (cx: number, cz: number, start: number) => (
    <mesh key={`${cx}:${cz}`} position={[cx, 0, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r - lineW / 2, r + lineW / 2, 12, 1, start, Math.PI / 2]} />
      {mat}
    </mesh>
  );
  return (
    <group {...props} position-y={y}>
      {/* 直边 */}
      <mesh position={[0, 0, -d / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w - 2 * r, lineW]} />
        {mat}
      </mesh>
      <mesh position={[0, 0, d / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w - 2 * r, lineW]} />
        {mat}
      </mesh>
      <mesh position={[-w / 2, 0, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <planeGeometry args={[d - 2 * r, lineW]} />
        {mat}
      </mesh>
      <mesh position={[w / 2, 0, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <planeGeometry args={[d - 2 * r, lineW]} />
        {mat}
      </mesh>
      {/* 圆角弧 */}
      {arc(w / 2 - r, -d / 2 + r, 0)}
      {arc(-w / 2 + r, -d / 2 + r, Math.PI / 2)}
      {arc(-w / 2 + r, d / 2 - r, Math.PI)}
      {arc(w / 2 - r, d / 2 - r, -Math.PI / 2)}
    </group>
  );
}

/** 切角面板形状（左右 45° 切角的六边形横幅） */
export function chamferPanelGeo(w: number, h: number, cut = 0.25, depth = 0.08): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + cut, -h / 2);
  s.lineTo(w / 2 - cut, -h / 2);
  s.lineTo(w / 2, -h / 2 + cut);
  s.lineTo(w / 2, h / 2 - cut);
  s.lineTo(w / 2 - cut, h / 2);
  s.lineTo(-w / 2 + cut, h / 2);
  s.lineTo(-w / 2, h / 2 - cut);
  s.lineTo(-w / 2, -h / 2 + cut);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

/** 霓虹招牌：切角暗面板 + 霓虹描边 + 发光文字（含辉光衬底） */
export function NeonSignPanel({
  text, sub, width = 4, height = 1.1, color = NEON, textColor = NEON_TEXT, fontSize, ...props
}: {
  text: string; sub?: string; width?: number; height?: number; color?: string; textColor?: string; fontSize?: number;
} & JSX.IntrinsicElements['group']) {
  const geo = useMemo(() => chamferPanelGeo(width, height, Math.min(0.28, height * 0.3)), [width, height]);
  const frameGeo = useMemo(() => chamferPanelGeo(width + 0.12, height + 0.12, Math.min(0.33, height * 0.33), 0.04), [width, height]);
  const fs = fontSize ?? height * (sub ? 0.34 : 0.42);
  return (
    <group {...props}>
      {/* 霓虹外框 */}
      <mesh geometry={frameGeo} position={[0, 0, -0.03]}>
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* 暗面板 */}
      <mesh geometry={geo} position={[0, 0, 0]}>
        <meshStandardMaterial color={PANEL} roughness={0.5} metalness={0.4} />
      </mesh>
      {/* 辉光 */}
      <GlowPlane size={[width * 1.35, height * 2.6]} color={color} opacity={0.32} position={[0, 0, 0.02]} />
      <Text
        position={[0, sub ? height * 0.12 : 0, 0.1]}
        fontSize={fs}
        color={textColor}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.08}
        outlineWidth={fs * 0.06}
        outlineColor={color}
        outlineOpacity={0.65}
      >
        {text}
      </Text>
      {sub && (
        <Text position={[0, -height * 0.24, 0.1]} fontSize={height * 0.17} color={color} anchorX="center" anchorY="middle" letterSpacing={0.2}>
          {sub}
        </Text>
      )}
    </group>
  );
}

/** 地面蚀刻发光文字 */
export function FloorText({ text, size = 0.4, color = NEON, opacity = 0.85, ...props }: {
  text: string; size?: number; color?: string; opacity?: number;
} & JSX.IntrinsicElements['group']) {
  return (
    <group {...props}>
      <Text
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={size}
        color={color}
        fillOpacity={opacity}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.14}
      >
        {text}
      </Text>
    </group>
  );
}

/** 全息屏：斜立的半透明 UI 面板（加性发光） */
export function HoloScreen({
  w = 0.5, h = 0.36, kind = 'dashboard', seed = 1, tilt = -0.18, ...props
}: {
  w?: number; h?: number; kind?: 'rings' | 'dashboard' | 'map' | 'chart'; seed?: number; tilt?: number;
} & JSX.IntrinsicElements['group']) {
  return (
    <group {...props}>
      <mesh rotation={[tilt, 0, 0]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial
          map={getHoloTexture(kind, seed)}
          color="#9FE8FF"
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
