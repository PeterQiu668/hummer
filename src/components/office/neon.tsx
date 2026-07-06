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

// 浅色高端：强调线改用饱和青蓝（在浅底上清晰可读，不像近白青那样发糊）
export const NEON = '#1683D8';       // 主强调线
export const NEON_DIM = '#0E6BB8';
export const NEON_TEXT = '#FFFFFF';
export const INK = '#1E2A3A';        // 浅底深字
export const PANEL = '#F2F5FA';      // 招牌浅面板
export const PANEL_EDGE = '#BFC8D6';

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

/** 全息 UI 纹理 v2：明亮显示器风格（浅面板 + 饱和蓝/青数据 · 落在深色屏框上，真实设备感） */
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
  const BG = '#F5F8FC', WHITE = '#FFFFFF', GRID = '#D8E2EF', BLUE = '#1683D8', TEAL = '#0E9488', INK2 = '#1B2A3A', SUB = '#8494A8';
  // 浅面板 + 描边 + 顶部标题条
  ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = WHITE; ctx.fillRect(6, 6, w - 12, h - 12);
  ctx.strokeStyle = GRID; ctx.lineWidth = 2; ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = BLUE; ctx.fillRect(6, 6, w - 12, 15);
  ctx.fillStyle = WHITE; ctx.fillRect(14, 10, 56, 6);
  if (kind === 'rings') {
    ctx.lineWidth = 3;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.strokeStyle = i % 2 ? BLUE : TEAL;
      ctx.globalAlpha = 0.88 - i * 0.12;
      ctx.arc(w / 2, h / 2 + 8, i * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = BLUE;
    ctx.beginPath(); ctx.arc(w / 2, h / 2 + 8, 6, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'map') {
    ctx.fillStyle = '#BFD2E8';
    for (let i = 0; i < 380; i++) {
      const x = rnd() * w, y = rnd() * (h * 0.6) + h * 0.22;
      if (rnd() > 0.45) ctx.fillRect(x, y, 2, 2);
    }
    ctx.strokeStyle = BLUE; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(rnd() * w, rnd() * h);
      ctx.quadraticCurveTo(rnd() * w, rnd() * h, rnd() * w, rnd() * h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'chart') {
    ctx.strokeStyle = BLUE; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(14, h - 22);
    for (let x = 14; x < w - 10; x += 12) ctx.lineTo(x, h - 22 - rnd() * (h - 70));
    ctx.stroke();
    ctx.lineTo(w - 10, h - 22); ctx.lineTo(14, h - 22); ctx.closePath();
    ctx.fillStyle = 'rgba(22,131,216,0.14)'; ctx.fill();
    ctx.fillStyle = TEAL;
    for (let i = 0; i < 6; i++) ctx.fillRect(16 + i * 17, h - 22, 11, -(rnd() * 30 + 6));
  } else {
    ctx.fillStyle = INK2; ctx.fillRect(16, 30, 72, 7);
    ctx.fillStyle = SUB; ctx.fillRect(16, 42, 44, 5);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = GRID; ctx.fillRect(16, 60 + i * 17, w - 100, 7);
      ctx.fillStyle = i % 2 ? BLUE : TEAL; ctx.fillRect(16, 60 + i * 17, (0.3 + rnd() * 0.6) * (w - 100), 7);
    }
    ctx.beginPath(); ctx.strokeStyle = GRID; ctx.lineWidth = 6; ctx.arc(w - 46, 52, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.strokeStyle = BLUE; ctx.lineWidth = 6; ctx.arc(w - 46, 52, 22, -Math.PI / 2, Math.PI * (rnd() * 1.2)); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  texCache.set(key, tex);
  return tex;
}

/* ── 组件 ── */

/** 柔和色晕贴片 v2：浅底上加性辉光不可见，改用普通混合的柔色晕（不发光，仅柔化点缀） */
export function GlowPlane({ size = [1, 1] as [number, number], color = NEON, opacity = 0.25, ...props }: {
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
        depthWrite={false}
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
          <GlowPlane size={[length * 1.15, thickness * 9 * glow]} color={color} opacity={0.55 * glow} />
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

/** 招牌 v2 · 浅色高端：实心强调色填充 或 白面板 + 清脆文字 + 细强调下划线（无加性辉光） */
export function NeonSignPanel({
  text, sub, width = 4, height = 1.1, color = NEON, textColor, fill = 'accent', fontSize, ...props
}: {
  text: string; sub?: string; width?: number; height?: number; color?: string; textColor?: string;
  fill?: 'accent' | 'white'; fontSize?: number;
} & JSX.IntrinsicElements['group']) {
  const geo = useMemo(() => chamferPanelGeo(width, height, Math.min(0.28, height * 0.3)), [width, height]);
  const frameGeo = useMemo(() => chamferPanelGeo(width + 0.1, height + 0.1, Math.min(0.31, height * 0.33), 0.03), [width, height]);
  const fs = fontSize ?? height * (sub ? 0.34 : 0.42);
  const onAccent = fill === 'accent';
  const ink = textColor ?? (onAccent ? '#FFFFFF' : INK);
  return (
    <group {...props}>
      {/* 细强调描边 */}
      <mesh geometry={frameGeo} position={[0, 0, -0.02]}>
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* 面板本体 */}
      <mesh geometry={geo}>
        <meshStandardMaterial
          color={onAccent ? color : '#FFFFFF'}
          roughness={0.55}
          metalness={0.06}
          emissive={onAccent ? color : '#FFFFFF'}
          emissiveIntensity={onAccent ? 0.18 : 0.08}
        />
      </mesh>
      {/* 清脆文字（无发光描边） */}
      <Text position={[0, sub ? height * 0.13 : 0, 0.08]} fontSize={fs} color={ink} anchorX="center" anchorY="middle" letterSpacing={0.06}>
        {text}
      </Text>
      {/* 细强调下划线 */}
      <mesh position={[0, sub ? -height * 0.04 : -height * 0.24, 0.08]}>
        <boxGeometry args={[width * 0.5, height * 0.03, 0.01]} />
        <meshBasicMaterial color={onAccent ? '#FFFFFF' : color} toneMapped={false} />
      </mesh>
      {sub && (
        <Text position={[0, -height * 0.26, 0.08]} fontSize={height * 0.16} color={onAccent ? '#EAF2FF' : color} anchorX="center" anchorY="middle" letterSpacing={0.2}>
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

/** 显示器屏 v2：深色屏框 + 明亮 UI 面板（普通混合，真实设备感） */
export function HoloScreen({
  w = 0.5, h = 0.36, kind = 'dashboard', seed = 1, tilt = -0.18, ...props
}: {
  w?: number; h?: number; kind?: 'rings' | 'dashboard' | 'map' | 'chart'; seed?: number; tilt?: number;
} & JSX.IntrinsicElements['group']) {
  return (
    <group {...props}>
      <group rotation={[tilt, 0, 0]}>
        {/* 深色屏框（唯一保留的深色元素 · 让浅 UI 有依托） */}
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[w * 1.08, h * 1.12]} />
          <meshStandardMaterial color="#26303F" roughness={0.4} metalness={0.3} />
        </mesh>
        <mesh>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            map={getHoloTexture(kind, seed)}
            color="#FFFFFF"
            transparent
            opacity={0.98}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
