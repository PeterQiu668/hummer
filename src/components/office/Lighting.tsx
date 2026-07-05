/**
 * 灯光 v13 · SYBERNETIC 夜景室内
 * 冷色窗光主光（投影）+ 半球底光 + 霓虹青色点光溢光（假 GI）
 */
export default function Lighting() {
  return (
    <>
      <ambientLight intensity={0.52} color="#3D4E6C" />
      <hemisphereLight args={['#3D4E6C', '#10141C', 0.7]} />
      {/* 冷色主光：来自幕墙方向（投影） */}
      <directionalLight
        position={[4, 14, -11]}
        intensity={1.15}
        color="#AFC8E8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-camera-near={2}
        shadow-camera-far={60}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      {/* 正面补光（镜头方向，柔化人物面部） */}
      <directionalLight position={[-4, 10, 16]} intensity={0.42} color="#7FA8D8" />
      {/* 霓虹溢光点光（假 GI · 让青色打在附近表面上） */}
      <pointLight position={[3.5, 2.8, 3.5]} intensity={4} distance={7} decay={2} color="#35C7F0" />
      <pointLight position={[-11.5, 4.5, -11.5]} intensity={5} distance={9} decay={2} color="#35C7F0" />
      <pointLight position={[1, 4.5, -11.8]} intensity={3} distance={6} decay={2} color="#35C7F0" />
      <pointLight position={[12.8, 0.2, 8]} intensity={3.5} distance={6} decay={2} color="#35C7F0" />
      <pointLight position={[14, 2, 1.5]} intensity={2.5} distance={6} decay={2} color="#58E6D9" />
      <pointLight position={[-14.5, -0.4, 8]} intensity={2} distance={5} decay={2} color="#46C68A" />
    </>
  );
}
