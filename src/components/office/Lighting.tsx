/**
 * 灯光 v11 · 写实渲染
 * - 主光实时阴影（PCFSoft，覆盖整个楼层）—— 立体感的核心
 * - 纯灯光方案：Environment portal 渲染在部分环境下会间歇性污染渲染目标（黑屏），不使用
 */
export default function Lighting() {
  return (
    <>
      <ambientLight intensity={0.68} color="#D8E0EF" />
      <hemisphereLight args={['#C4D2EC', '#232833', 0.62]} />
      {/* 暖白主光（投影） */}
      <directionalLight
        position={[9, 17, 11]}
        intensity={1.6}
        color="#FFEDD0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={2}
        shadow-camera-far={55}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      {/* 辅光（不投影，柔化暗部） */}
      <directionalLight position={[-8, 12, 5]} intensity={0.45} color="#F2E6D0" />
      {/* 冷色窗光 */}
      <directionalLight position={[-14, 8, -12]} intensity={0.4} color="#8FB0E8" />
      {/* 金属/玻璃高光补偿（无环境贴图时的点缀高光） */}
      <pointLight position={[0, 6, 2]} intensity={18} distance={26} decay={2} color="#FFEFD6" />
    </>
  );
}
