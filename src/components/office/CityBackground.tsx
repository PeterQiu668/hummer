/**
 * 背景 v14 · 极简明亮夜空
 * 城市剪影在最终机位下几乎不可见却耗渲染 —— 已删除。
 * 保留：亮一档的夜空底色 + 匹配的线性雾 + 地平光晕带（窗外不空洞）。
 */
import { GlowPlane } from './neon';

export default function CityBackground() {
  return (
    <>
      <color attach="background" args={['#16213A']} />
      <fog attach="fog" args={['#16213A', 40, 120]} />
      {/* 地平光晕带（幕墙窗外的城市天光暗示） */}
      <GlowPlane size={[90, 14]} color="#4A6EA8" opacity={0.5} position={[0, 3, -34]} />
      <GlowPlane size={[70, 10]} color="#6E8FD6" opacity={0.3} position={[-6, 1.5, -33]} />
      <GlowPlane size={[60, 12]} color="#4A6EA8" opacity={0.35} position={[34, 2, -6]} rotation={[0, -Math.PI / 2, 0]} />
    </>
  );
}
