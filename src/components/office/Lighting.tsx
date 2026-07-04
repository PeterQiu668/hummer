import { ContactShadows, Environment } from '@react-three/drei';

/**
 * 灯光：1 directional + 1 ambient + Environment night preset
 * 不用 castShadow · 用 ContactShadows 替代
 */
export default function Lighting() {
  return (
    <>
      <ambientLight intensity={0.45} color="#b6c4e2" />
      <directionalLight position={[12, 22, 10]} intensity={0.85} color="#dbeafe" />
      <directionalLight position={[-10, 14, -8]} intensity={0.3} color="#A855F7" />
      <Environment preset="night" />
      {/* frames={1}：烘焙一次接触阴影，避免每帧全场景深度渲染（人物浮动幅度小，静态阴影视觉无差） */}
      <ContactShadows
        position={[0, 0.42, 0]}
        opacity={0.55}
        scale={36}
        blur={2.8}
        far={6}
        color="#000814"
        frames={1}
      />
    </>
  );
}
