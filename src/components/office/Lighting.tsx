import { ContactShadows } from '@react-three/drei';

/**
 * 灯光 v10 · 真实办公室：暖白主光（吊灯感）+ 冷色窗光补光 + 半球底光
 * 不依赖 Environment HDR（CDN 资源会卡住 Suspense）· ContactShadows frames={1} 烘焙一次
 */
export default function Lighting() {
  return (
    <>
      <ambientLight intensity={0.72} color="#D8E0EF" />
      <hemisphereLight args={['#C4D2EC', '#232833', 0.6]} />
      {/* 暖白主光：模拟室内吊灯 */}
      <directionalLight position={[6, 18, 8]} intensity={1.55} color="#FFEDD0" />
      {/* 辅助主光：填补另一侧 */}
      <directionalLight position={[-8, 14, 6]} intensity={0.55} color="#F2E6D0" />
      {/* 冷色窗光：来自幕墙方向的城市夜光 */}
      <directionalLight position={[-14, 8, -12]} intensity={0.45} color="#8FB0E8" />
      <ContactShadows
        position={[0, 0.02, 0]}
        opacity={0.32}
        scale={40}
        blur={2.6}
        far={5}
        color="#050A14"
        frames={1}
      />
    </>
  );
}
