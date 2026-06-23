import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, Environment, Stars, ContactShadows } from '@react-three/drei';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Camera, MapPin } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { ZoneId } from '../../lib/types';
import CameraRig from './CameraRig';
import Zone from './Zone';
import Workstation from './Workstation';
import OfficeFloor from './OfficeFloor';
import { employees } from '../../data/employees';
import FloatingParticles from './FloatingParticles';

export const ZONES: { id: ZoneId; label: string; pos: [number, number, number]; color: string; size: [number, number]; sub: string }[] = [
  { id: 'boss',     label: '老板办公室', pos: [-8, 0, -3.5], color: '#a855f7', size: [6, 5], sub: 'EXECUTIVE SUITE' },
  { id: 'business', label: '业务办公区', pos: [0.2, 0, 2.5], color: '#00ffff', size: [9, 6], sub: 'BUSINESS ZONE' },
  { id: 'support',  label: '行政支持中心', pos: [8, 0, 0.5], color: '#00ff88', size: [6, 4.5], sub: 'SUPPORT CENTER' },
  { id: 'meeting',  label: '会议室·青莲',  pos: [-7.8, 0, 4.5], color: '#ff00aa', size: [5, 4], sub: 'MEETING ROOM' },
  { id: 'rest',     label: '休息区',     pos: [9, 0, 5.5], color: '#ffb800', size: [5, 4], sub: 'LOUNGE' },
  { id: 'learn',    label: '学习进化充电区', pos: [-2, 0, 7.5], color: '#5b8cff', size: [7, 4], sub: 'EVOLUTION CHARGER' },
];

export default function Office3D() {
  const { activeZone, setActiveZone, setSelectedEmployee, setShowHermes, setShowMeeting } = useAppStore();
  const [hoverZone, setHoverZone] = useState<ZoneId | null>(null);

  const visibleEmployees = activeZone
    ? employees.filter((e) => e.zone === activeZone)
    : employees;

  return (
    <div className="relative h-full w-full">
      {/* Top-left zone label */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none">
        <div className="font-display text-xs tracking-widest neon-text">
          {activeZone ? '工区视角' : '办公室全景 · 巡场视角'}
        </div>
        <div className="text-[10px] font-mono text-neon-cyan/60 mt-0.5">
          {activeZone ? ZONES.find((z) => z.id === activeZone)?.sub : 'DRONE OVERVIEW · ISOMETRIC'}
        </div>
      </div>

      {/* Top-right camera hint */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        {activeZone && (
          <button
            onClick={() => setActiveZone(null)}
            className="btn-neon pointer-events-auto"
          >
            <ArrowLeft size={12} /> 返回巡场
          </button>
        )}
        <div className="flex items-center gap-1 px-2 py-1 glass rounded-sm text-[10px] font-mono text-neon-cyan/60">
          <Camera size={11} /> R3F · GSAP CINE CAM
        </div>
      </div>

      {/* Bottom-left minimap */}
      <div className="absolute bottom-3 left-3 z-10 glass rounded-sm p-2 relative hud-corner pointer-events-auto">
        <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/70 mb-1">
          <MapPin size={10} className="inline mr-1" /> MINIMAP
        </div>
        <div className="relative w-44 h-32 rounded-sm border border-neon-cyan/20 bg-ink-900/60 grid-bg">
          {ZONES.map((z) => {
            const x = ((z.pos[0] + 14) / 28) * 100;
            const y = ((z.pos[2] + 6) / 16) * 100;
            const w = (z.size[0] / 28) * 100;
            const h = (z.size[1] / 16) * 100;
            const active = activeZone === z.id;
            return (
              <button
                key={z.id}
                onClick={() => setActiveZone(z.id)}
                onMouseEnter={() => setHoverZone(z.id)}
                onMouseLeave={() => setHoverZone(null)}
                className="absolute rounded-[2px] border transition"
                style={{
                  left: `${x - w / 2}%`,
                  top: `${y - h / 2}%`,
                  width: `${w}%`,
                  height: `${h}%`,
                  borderColor: active ? z.color : `${z.color}55`,
                  background: active ? `${z.color}33` : `${z.color}11`,
                  boxShadow: active ? `0 0 8px ${z.color}aa` : 'none',
                }}
                title={z.label}
              />
            );
          })}
        </div>
      </div>

      {/* Bottom-right legend */}
      <AnimatePresence>
        {hoverZone && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-3 right-3 z-10 glass rounded-sm p-3 max-w-xs"
          >
            <div className="font-display text-sm neon-text">{ZONES.find((z) => z.id === hoverZone)?.label}</div>
            <div className="text-[10px] font-mono text-neon-cyan/60">{ZONES.find((z) => z.id === hoverZone)?.sub}</div>
            <div className="mt-2 text-[11px] text-slate-300">
              {employees.filter((e) => e.zone === hoverZone).length} 位数字员工在岗
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Canvas dpr={[1, 1.8]} shadows>
        <PerspectiveCamera makeDefault fov={42} position={[0, 18, 22]} />
        <CameraRig activeZone={activeZone} zones={ZONES} />

        <color attach="background" args={['#04060f']} />
        <fog attach="fog" args={['#04060f', 30, 60]} />

        {/* Lighting */}
        <ambientLight intensity={0.45} />
        <directionalLight position={[10, 20, 8]} intensity={0.9} color="#aaccff" castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <pointLight position={[-8, 8, -3]} intensity={1.4} color="#a855f7" distance={20} />
        <pointLight position={[8, 8, 0]} intensity={1.2} color="#00ff88" distance={20} />
        <pointLight position={[-8, 8, 5]} intensity={1.2} color="#ff00aa" distance={20} />
        <pointLight position={[9, 8, 6]} intensity={1.0} color="#ffb800" distance={20} />
        <pointLight position={[-2, 8, 8]} intensity={1.0} color="#00ffff" distance={20} />
        <pointLight position={[0, 12, 2]} intensity={0.6} color="#00ffff" distance={28} />

        <Suspense fallback={null}>
          <OfficeFloor />

          {ZONES.map((z) => (
            <Zone
              key={z.id}
              {...z}
              active={activeZone === z.id || activeZone === null}
              focused={activeZone === z.id}
              onClick={() => setActiveZone(z.id)}
              onDoubleClick={() => {
                if (z.id === 'learn') setShowHermes(true);
                if (z.id === 'meeting') setShowMeeting(true);
              }}
            />
          ))}

          {visibleEmployees.map((e) => (
            <Workstation
              key={e.id}
              employee={e}
              onClick={() => setSelectedEmployee(e)}
            />
          ))}

          <FloatingParticles count={140} />

          <ContactShadows position={[0, -0.02, 0]} opacity={0.55} scale={50} blur={2.4} far={10} />

          <Stars radius={80} depth={40} count={1600} factor={3.5} fade speed={1} />

          <Environment preset="night" />
        </Suspense>
      </Canvas>
    </div>
  );
}
