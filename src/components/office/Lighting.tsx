/**
 * 灯光 v16 · 明亮但有体积（浅色高端）
 * 关键教训：环境光过高 + 近白表面 = 白到看不见。降总光强，让投影和形体重新显现。
 */
export default function Lighting() {
  return (
    <>
      <ambientLight intensity={0.5} color="#EAF0FA" />
      {/* 冷天空 / 暖地面反弹 */}
      <hemisphereLight args={['#D6E4FB', '#E3DAC8', 0.65]} />
      {/* 暖调主光（正面打亮 · 柔和投影 · 提供体积对比） */}
      <directionalLight
        position={[8, 18, 10]}
        intensity={1.55}
        color="#FFF1DC"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-near={2}
        shadow-camera-far={64}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      {/* 冷补光（反向 · 柔化暗部但不抹平） */}
      <directionalLight position={[-9, 12, -6]} intensity={0.4} color="#C4D6EE" />
      {/* 高管台暖光台灯 */}
      <pointLight position={[12.7, 3.0, -8]} intensity={2} distance={5} decay={2} color="#F5C98A" />
    </>
  );
}
