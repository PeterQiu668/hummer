/**
 * OfficeSVG · 高保真等距赛博朋克办公室全景
 * v1 静态版：严格按附件图风格复刻 — 6 区 + 12 个差异化 Agent 角色
 */
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import { ArrowLeft, Camera, MapPin } from 'lucide-react';

// --------- Reusable building blocks (raw SVG path/poly helpers) ---------

// Isometric cube: position (x,y) is the top-front-left vertex; w=width(right axis), d=depth(left axis), h=height
const IsoCube = ({
  x, y, w, d, h,
  fill = '#0a0e27', stroke = '#00ffff', strokeW = 1, glow = false, faceTopOpacity = 1, faceLeftOpacity = 0.75, faceRightOpacity = 0.6,
  topFill, leftFill, rightFill,
}: {
  x: number; y: number; w: number; d: number; h: number;
  fill?: string; stroke?: string; strokeW?: number; glow?: boolean;
  faceTopOpacity?: number; faceLeftOpacity?: number; faceRightOpacity?: number;
  topFill?: string; leftFill?: string; rightFill?: string;
}) => {
  // dimetric 2:1 projection — each unit on the iso axes -> (±1 horiz, ±0.5 vert)
  const top = `${x},${y} ${x + w},${y - w / 2} ${x + w - d},${y - w / 2 - d / 2} ${x - d},${y - d / 2}`;
  const left = `${x - d},${y - d / 2} ${x - d},${y - d / 2 + h} ${x},${y + h} ${x},${y}`;
  const right = `${x},${y} ${x},${y + h} ${x + w},${y + h - w / 2} ${x + w},${y - w / 2}`;
  return (
    <g filter={glow ? 'url(#glow-cyan)' : undefined}>
      <polygon points={top} fill={topFill || fill} stroke={stroke} strokeWidth={strokeW} opacity={faceTopOpacity} strokeLinejoin="round" />
      <polygon points={left} fill={leftFill || fill} stroke={stroke} strokeWidth={strokeW} opacity={faceLeftOpacity} strokeLinejoin="round" />
      <polygon points={right} fill={rightFill || fill} stroke={stroke} strokeWidth={strokeW} opacity={faceRightOpacity} strokeLinejoin="round" />
    </g>
  );
};

// Isometric flat tile (top only) used for floor pads
const IsoTile = ({
  x, y, w, d, fill, stroke = '#00ffff', strokeW = 1.2, opacity = 1,
}: { x: number; y: number; w: number; d: number; fill: string; stroke?: string; strokeW?: number; opacity?: number }) => (
  <polygon
    points={`${x},${y} ${x + w},${y - w / 2} ${x + w - d},${y - w / 2 - d / 2} ${x - d},${y - d / 2}`}
    fill={fill} stroke={stroke} strokeWidth={strokeW} opacity={opacity} strokeLinejoin="round"
  />
);

// Glass partition wall (iso slab, semi-transparent)
const GlassWall = ({
  x, y, len, h, axis = 'right', color = '#00ffff', opacity = 0.16,
}: { x: number; y: number; len: number; h: number; axis?: 'right' | 'left'; color?: string; opacity?: number }) => {
  const dx = axis === 'right' ? len : -len;
  const dy = axis === 'right' ? -len / 2 : -len / 2;
  return (
    <g>
      <polygon
        points={`${x},${y} ${x + dx},${y + dy} ${x + dx},${y + dy + h} ${x},${y + h}`}
        fill={color} opacity={opacity} stroke={color} strokeOpacity={0.55} strokeWidth={1.2} strokeLinejoin="round"
      />
      {/* top trim */}
      <line x1={x} y1={y} x2={x + dx} y2={y + dy} stroke={color} strokeWidth={2} opacity={0.85} />
      {/* bottom trim */}
      <line x1={x} y1={y + h} x2={x + dx} y2={y + dy + h} stroke={color} strokeWidth={1.5} opacity={0.55} />
      {/* mullions */}
      {Array.from({ length: Math.floor(len / 40) }).map((_, i) => {
        const t = (i + 1) / (Math.floor(len / 40) + 1);
        const mx = x + dx * t;
        const my = y + dy * t;
        return <line key={i} x1={mx} y1={my} x2={mx} y2={my + h} stroke={color} strokeWidth={0.8} opacity={0.45} />;
      })}
    </g>
  );
};

// --------- Furniture ---------

const Desk = ({ x, y, color = '#161c4a' }: { x: number; y: number; color?: string }) => (
  <g>
    {/* desk slab */}
    <IsoCube x={x} y={y} w={70} d={36} h={6} fill={color} stroke="#1f2a55" strokeW={1} topFill="#161c4a" leftFill="#0e1232" rightFill="#0a0e27" />
    {/* legs */}
    <line x1={x + 2} y1={y + 6} x2={x + 2} y2={y + 36} stroke="#0a0e27" strokeWidth={2.5} />
    <line x1={x + 68} y1={y - 33} x2={x + 68} y2={y - 3} stroke="#0a0e27" strokeWidth={2.5} />
    <line x1={x - 34} y1={y - 11} x2={x - 34} y2={y + 19} stroke="#0a0e27" strokeWidth={2.5} />
  </g>
);

const Monitor = ({ x, y, color = '#00ffff', screen = 'data' }: { x: number; y: number; color?: string; screen?: 'data' | 'red' | 'purple' | 'green' | 'magenta' }) => {
  const screenColor = screen === 'red' ? '#ff3860' : screen === 'purple' ? '#a855f7' : screen === 'green' ? '#00ff88' : screen === 'magenta' ? '#ff00aa' : color;
  return (
    <g>
      {/* stand */}
      <line x1={x} y1={y} x2={x} y2={y - 14} stroke="#0a0e27" strokeWidth={3} />
      {/* monitor back face */}
      <polygon points={`${x - 28},${y - 14} ${x - 28},${y - 46} ${x + 28},${y - 46 + 14} ${x + 28},${y - 32 + 14}`} fill="#070a1a" stroke="#1f2a55" strokeWidth={1} />
      {/* monitor screen */}
      <polygon
        points={`${x - 24},${y - 16} ${x - 24},${y - 42} ${x + 24},${y - 42 + 12} ${x + 24},${y - 30 + 12}`}
        fill={screenColor} opacity={0.85} stroke={screenColor} strokeWidth={0.6}
        filter="url(#glow-soft)"
      />
      {/* faux text lines on screen */}
      {Array.from({ length: 4 }).map((_, i) => (
        <line
          key={i}
          x1={x - 22} y1={y - 38 + i * 6}
          x2={x + 22 - i * 2} y2={y - 38 + i * 6 + (x + 22 - i * 2 - (x - 22)) * -0.18}
          stroke="#04060f" strokeWidth={1} opacity={0.55}
        />
      ))}
    </g>
  );
};

const Chair = ({ x, y, color = '#1f2a55' }: { x: number; y: number; color?: string }) => (
  <g>
    {/* seat */}
    <IsoCube x={x} y={y} w={20} d={20} h={4} fill={color} stroke="#04060f" strokeW={1} />
    {/* back */}
    <polygon points={`${x},${y} ${x},${y - 22} ${x + 20},${y - 22 - 10} ${x + 20},${y - 10}`} fill={color} stroke="#04060f" strokeWidth={1} opacity={0.9} />
  </g>
);

// --------- Chibi Character ---------

type CharOpts = {
  x: number; y: number;
  skin?: string;
  hair?: 'short' | 'pony' | 'bun' | 'bob' | 'side' | 'space-buns' | 'wavy' | 'bald-glasses' | 'beanie' | 'hood';
  hairColor?: string;
  outfit: string;
  outfitDark?: string;
  eyes?: 'normal' | 'glasses' | 'vr' | 'closed' | 'shock';
  accessory?: 'none' | 'coffee' | 'tablet' | 'clipboard' | 'briefcase' | 'headset' | 'papers' | 'gavel';
  status?: 'working' | 'idle' | 'blocked' | 'meeting' | 'training';
  glow?: string; // override glow color
};

function Character({ x, y, skin = '#f5d3b0', hair = 'short', hairColor = '#0a0e27', outfit, outfitDark, eyes = 'normal', accessory = 'none', status = 'working', glow }: CharOpts) {
  const aura = glow ?? (status === 'blocked' ? '#ff3860' : status === 'training' ? '#a855f7' : status === 'meeting' ? '#ff00aa' : status === 'idle' ? '#5b8cff' : '#00ffff');
  const dark = outfitDark ?? outfit;

  return (
    <g transform={`translate(${x} ${y})`}>
      {/* aura under feet */}
      <ellipse cx={0} cy={20} rx={26} ry={9} fill={aura} opacity={0.22} filter="url(#glow-soft)" />
      {status === 'blocked' && (
        <ellipse cx={0} cy={20} rx={32} ry={11} fill="none" stroke={aura} strokeWidth={1.5} opacity={0.85}>
          <animate attributeName="rx" values="26;38;26" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.85;0;0.85" dur="1.8s" repeatCount="indefinite" />
        </ellipse>
      )}
      {status === 'training' && (
        <circle cx={0} cy={20} r={20} fill="none" stroke={aura} strokeWidth={1} opacity={0.7} strokeDasharray="3 3">
          <animateTransform attributeName="transform" type="rotate" from="0 0 20" to="360 0 20" dur="6s" repeatCount="indefinite" />
        </circle>
      )}

      {/* body trapezoid (chibi torso) */}
      <path d="M -13 0 L 13 0 L 16 18 L -16 18 Z" fill={outfit} stroke="#04060f" strokeWidth={1.2} strokeLinejoin="round" />
      {/* shoulder shading */}
      <path d="M -13 0 L -16 18 L -10 18 L -8 2 Z" fill={dark} opacity={0.55} />
      {/* shirt collar/V */}
      <path d="M -5 0 L 0 6 L 5 0 Z" fill="#04060f" opacity={0.7} />

      {/* arms (slight) */}
      <ellipse cx={-15} cy={6} rx={3} ry={6} fill={outfit} stroke="#04060f" strokeWidth={0.8} />
      <ellipse cx={15} cy={6} rx={3} ry={6} fill={dark} stroke="#04060f" strokeWidth={0.8} />

      {/* head */}
      <circle cx={0} cy={-12} r={14} fill={skin} stroke="#04060f" strokeWidth={1.2} />

      {/* eyes */}
      {eyes === 'normal' && (
        <>
          <ellipse cx={-4.5} cy={-12} rx={1.4} ry={2.1} fill="#04060f" />
          <ellipse cx={4.5} cy={-12} rx={1.4} ry={2.1} fill="#04060f" />
        </>
      )}
      {eyes === 'closed' && (
        <>
          <path d="M -7 -12 Q -4 -10 -2 -12" stroke="#04060f" strokeWidth={1.2} fill="none" strokeLinecap="round" />
          <path d="M 2 -12 Q 4 -10 7 -12" stroke="#04060f" strokeWidth={1.2} fill="none" strokeLinecap="round" />
        </>
      )}
      {eyes === 'glasses' && (
        <>
          <ellipse cx={-4.5} cy={-12} rx={1.4} ry={1.8} fill="#04060f" />
          <ellipse cx={4.5} cy={-12} rx={1.4} ry={1.8} fill="#04060f" />
          <rect x={-9} y={-15} width={8} height={6} fill="none" stroke="#04060f" strokeWidth={1} rx={1.5} />
          <rect x={1} y={-15} width={8} height={6} fill="none" stroke="#04060f" strokeWidth={1} rx={1.5} />
          <line x1={-1} y1={-12} x2={1} y2={-12} stroke="#04060f" strokeWidth={1} />
        </>
      )}
      {eyes === 'vr' && (
        <>
          <rect x={-11} y={-17} width={22} height={8} fill="#04060f" stroke={aura} strokeWidth={1} rx={2} />
          <rect x={-9} y={-15.5} width={7} height={5} fill={aura} opacity={0.85} filter="url(#glow-soft)" />
          <rect x={2} y={-15.5} width={7} height={5} fill={aura} opacity={0.85} filter="url(#glow-soft)" />
          <line x1={-12} y1={-13} x2={-15} y2={-12} stroke="#04060f" strokeWidth={1} />
          <line x1={12} y1={-13} x2={15} y2={-12} stroke="#04060f" strokeWidth={1} />
        </>
      )}
      {eyes === 'shock' && (
        <>
          <circle cx={-4.5} cy={-12} r={2.2} fill="#fff" stroke="#04060f" strokeWidth={1} />
          <circle cx={4.5} cy={-12} r={2.2} fill="#fff" stroke="#04060f" strokeWidth={1} />
          <circle cx={-4.5} cy={-12} r={1} fill="#04060f" />
          <circle cx={4.5} cy={-12} r={1} fill="#04060f" />
        </>
      )}

      {/* mouth */}
      <path d="M -2 -7 Q 0 -5 2 -7" stroke="#04060f" strokeWidth={1.2} fill="none" strokeLinecap="round" />

      {/* hair */}
      {hair === 'short' && <path d="M -14 -14 Q -14 -28 0 -28 Q 14 -28 14 -14 Q 12 -19 6 -20 Q 0 -22 -8 -19 Q -12 -18 -14 -14 Z" fill={hairColor} stroke="#04060f" strokeWidth={1.2} strokeLinejoin="round" />}
      {hair === 'pony' && (
        <>
          <path d="M -14 -14 Q -14 -28 0 -28 Q 14 -28 14 -14 Q 14 -18 10 -22 Q 0 -28 -8 -24 Q -14 -22 -14 -14 Z" fill={hairColor} stroke="#04060f" strokeWidth={1.2} />
          <path d="M 10 -22 Q 22 -16 24 -2 Q 22 4 18 2 Q 16 -10 8 -18 Z" fill={hairColor} stroke="#04060f" strokeWidth={1.2} />
        </>
      )}
      {hair === 'bun' && (
        <>
          <path d="M -14 -14 Q -14 -28 0 -28 Q 14 -28 14 -14 Q 12 -22 0 -22 Q -12 -22 -14 -14 Z" fill={hairColor} stroke="#04060f" strokeWidth={1.2} />
          <circle cx={0} cy={-30} r={6} fill={hairColor} stroke="#04060f" strokeWidth={1.2} />
        </>
      )}
      {hair === 'bob' && <path d="M -16 -10 Q -16 -28 0 -28 Q 16 -28 16 -10 L 14 -8 Q 8 -10 0 -10 Q -8 -10 -14 -8 Z" fill={hairColor} stroke="#04060f" strokeWidth={1.2} strokeLinejoin="round" />}
      {hair === 'side' && <path d="M -14 -14 Q -14 -28 0 -28 Q 14 -28 14 -14 Q 8 -22 -4 -20 Q -10 -16 -14 -14 Z" fill={hairColor} stroke="#04060f" strokeWidth={1.2} strokeLinejoin="round" />}
      {hair === 'space-buns' && (
        <>
          <path d="M -14 -14 Q -14 -26 0 -26 Q 14 -26 14 -14 Q 12 -20 0 -20 Q -12 -20 -14 -14 Z" fill={hairColor} stroke="#04060f" strokeWidth={1.2} />
          <circle cx={-10} cy={-26} r={5} fill={hairColor} stroke="#04060f" strokeWidth={1.2} />
          <circle cx={10} cy={-26} r={5} fill={hairColor} stroke="#04060f" strokeWidth={1.2} />
        </>
      )}
      {hair === 'wavy' && <path d="M -16 -10 Q -16 -28 0 -28 Q 16 -28 16 -10 Q 14 -16 10 -12 Q 6 -16 0 -12 Q -6 -16 -10 -12 Q -14 -16 -16 -10 Z" fill={hairColor} stroke="#04060f" strokeWidth={1.2} strokeLinejoin="round" />}
      {hair === 'bald-glasses' && (
        <ellipse cx={0} cy={-20} rx={10} ry={3.5} fill={hairColor} stroke="#04060f" strokeWidth={1} opacity={0.6} />
      )}
      {hair === 'beanie' && (
        <>
          <path d="M -16 -16 Q -16 -28 0 -28 Q 16 -28 16 -16 L 14 -14 L -14 -14 Z" fill={hairColor} stroke="#04060f" strokeWidth={1.2} strokeLinejoin="round" />
          <rect x={-14} y={-15} width={28} height={3} fill={hairColor} stroke="#04060f" strokeWidth={1} opacity={0.7} />
          <circle cx={0} cy={-30} r={3.5} fill={hairColor} stroke="#04060f" strokeWidth={1} />
        </>
      )}
      {hair === 'hood' && (
        <path d="M -18 -14 Q -18 -30 0 -32 Q 18 -30 18 -14 L 16 -10 L 14 -14 Q 14 -22 0 -22 Q -14 -22 -14 -14 L -16 -10 Z" fill={hairColor} stroke="#04060f" strokeWidth={1.2} strokeLinejoin="round" />
      )}

      {/* headset for cs */}
      {accessory === 'headset' && (
        <>
          <path d="M -14 -16 Q 0 -34 14 -16" stroke={aura} strokeWidth={2.5} fill="none" strokeLinecap="round" />
          <ellipse cx={-14} cy={-13} rx={3.5} ry={4} fill={aura} stroke="#04060f" strokeWidth={1} />
          <ellipse cx={14} cy={-13} rx={3.5} ry={4} fill={aura} stroke="#04060f" strokeWidth={1} />
          <path d="M -10 -8 Q -5 -4 -2 -8" stroke={aura} strokeWidth={1.2} fill="none" />
        </>
      )}

      {/* accessories near hand */}
      {accessory === 'coffee' && (
        <g transform="translate(-22 10)">
          <rect x={-3} y={-4} width={6} height={6} fill="#0a0e27" stroke={aura} strokeWidth={1} />
          <path d="M 3 -2 L 5 -2 L 5 0 L 3 0" stroke={aura} strokeWidth={1} fill="none" />
          <line x1={-2} y1={-6} x2={-2} y2={-9} stroke={aura} strokeWidth={1} opacity={0.7} />
          <line x1={1} y1={-6} x2={1} y2={-9} stroke={aura} strokeWidth={1} opacity={0.7} />
        </g>
      )}
      {accessory === 'tablet' && (
        <g transform="translate(20 8)">
          <rect x={-4} y={-5} width={10} height={12} fill="#04060f" stroke={aura} strokeWidth={1.2} rx={1} />
          <rect x={-3} y={-4} width={8} height={9} fill={aura} opacity={0.7} />
        </g>
      )}
      {accessory === 'clipboard' && (
        <g transform="translate(20 8)">
          <rect x={-4} y={-6} width={10} height={12} fill="#f1f5ff" stroke="#04060f" strokeWidth={1} />
          <rect x={-2} y={-7} width={6} height={2} fill="#4b5563" />
          <line x1={-3} y1={-3} x2={4} y2={-3} stroke="#04060f" strokeWidth={0.8} />
          <line x1={-3} y1={0} x2={4} y2={0} stroke="#04060f" strokeWidth={0.8} />
          <line x1={-3} y1={3} x2={2} y2={3} stroke="#04060f" strokeWidth={0.8} />
        </g>
      )}
      {accessory === 'briefcase' && (
        <g transform="translate(-22 14)">
          <rect x={-6} y={-3} width={12} height={9} fill="#1a1a2e" stroke={aura} strokeWidth={1} />
          <line x1={-6} y1={-1} x2={6} y2={-1} stroke={aura} strokeWidth={0.6} />
          <rect x={-1} y={-5} width={2} height={2} fill="none" stroke={aura} strokeWidth={1} />
        </g>
      )}
      {accessory === 'papers' && (
        <g>
          <rect transform="rotate(-15)" x={-30} y={-30} width={12} height={16} fill="#fbf6e0" stroke="#ff3860" strokeWidth={1.2} />
          <rect transform="rotate(20)" x={6} y={-32} width={12} height={16} fill="#fbf6e0" stroke="#ff3860" strokeWidth={1.2} />
          <rect transform="rotate(10)" x={-18} y={-44} width={12} height={16} fill="#fbf6e0" stroke="#ff3860" strokeWidth={1.2} />
        </g>
      )}
      {accessory === 'gavel' && (
        <g transform="translate(22 6)">
          <rect x={-2} y={-3} width={10} height={4} fill="#a05a2c" stroke="#04060f" strokeWidth={1} />
          <rect x={-1} y={1} width={2} height={8} fill="#a05a2c" stroke="#04060f" strokeWidth={0.8} />
        </g>
      )}
    </g>
  );
}

// --------- Floating holographic sign ---------

const HoloSign = ({
  x, y, label, sub, color = '#00ffff', wide = 220, hi = 36, angle = 0,
}: { x: number; y: number; label: string; sub?: string; color?: string; wide?: number; hi?: number; angle?: number }) => (
  <g transform={`translate(${x} ${y}) rotate(${angle})`}>
    {/* tether */}
    <line x1={-wide / 2 + 6} y1={hi} x2={-wide / 2 + 6} y2={hi + 22} stroke={color} strokeWidth={1} opacity={0.5} strokeDasharray="2 3" />
    <line x1={wide / 2 - 6} y1={hi} x2={wide / 2 - 6} y2={hi + 22} stroke={color} strokeWidth={1} opacity={0.5} strokeDasharray="2 3" />
    {/* glow halo */}
    <rect x={-wide / 2 - 4} y={-4} width={wide + 8} height={hi + 8} rx={3} fill={color} opacity={0.1} filter="url(#glow-soft)" />
    {/* main sign */}
    <rect x={-wide / 2} y={0} width={wide} height={hi} fill="#04060f" opacity={0.78} stroke={color} strokeWidth={1.5} rx={1.5} />
    {/* top scan */}
    <rect x={-wide / 2} y={0} width={wide} height={2.5} fill={color} opacity={0.9} />
    {/* corner brackets */}
    {[[0, 0], [wide, 0], [0, hi], [wide, hi]].map(([cx, cy], i) => (
      <g key={i} transform={`translate(${-wide / 2 + cx} ${cy})`}>
        <rect x={-3} y={-3} width={6} height={1} fill={color} />
        <rect x={-3} y={-3} width={1} height={6} fill={color} />
      </g>
    ))}
    <text x={0} y={hi / 2 - (sub ? 0 : -4)} fontFamily="Orbitron, system-ui" fontWeight={700} fontSize={14} fill={color} textAnchor="middle" letterSpacing={1.4}>
      {label}
    </text>
    {sub && <text x={0} y={hi - 4} fontFamily="JetBrains Mono, monospace" fontSize={7.5} fill={color} opacity={0.7} textAnchor="middle" letterSpacing={1.6}>{sub}</text>}
  </g>
);

// =========================================================================
//  Main panorama
// =========================================================================

export default function OfficeSVG() {
  const { activeZone, setActiveZone } = useAppStore();

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-900">
      {/* HUD overlays */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none">
        <div className="font-display text-xs tracking-widest neon-text">SYBERNETIC LOBSTER HQ · 巡场视角</div>
        <div className="text-[10px] font-mono text-neon-cyan/60 mt-0.5">ENTERPRISE AGENT TEAM OS · ISOMETRIC PANORAMA · v1 (静态预览)</div>
      </div>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        {activeZone && (
          <button onClick={() => setActiveZone(null)} className="btn-neon pointer-events-auto">
            <ArrowLeft size={12} /> 返回巡场
          </button>
        )}
        <div className="flex items-center gap-1 px-2 py-1 glass rounded-sm text-[10px] font-mono text-neon-cyan/60">
          <Camera size={11} /> SVG ISOMETRIC · v1
        </div>
      </div>
      <div className="absolute bottom-3 left-3 z-10 glass rounded-sm p-2 relative hud-corner pointer-events-auto">
        <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/70 mb-1">
          <MapPin size={10} className="inline mr-1" /> 6 ZONES · 12 AGENTS · 在线
        </div>
        <div className="text-[10px] font-mono text-neon-cyan/50">点击预览版仅展示视觉风格</div>
      </div>

      <svg viewBox="0 0 2400 1500" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* sky gradient */}
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b0f2e" />
            <stop offset="0.45" stopColor="#0a0e27" />
            <stop offset="1" stopColor="#04060f" />
          </linearGradient>
          {/* nebula glow */}
          <radialGradient id="nebula" cx="0.5" cy="0.55" r="0.6">
            <stop offset="0" stopColor="#a855f7" stopOpacity="0.35" />
            <stop offset="0.45" stopColor="#ff00aa" stopOpacity="0.15" />
            <stop offset="1" stopColor="#04060f" stopOpacity="0" />
          </radialGradient>
          {/* floor */}
          <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#10153a" />
            <stop offset="1" stopColor="#04060f" />
          </linearGradient>

          {/* zone tiles gradient (per color) */}
          {(['#a855f7', '#00ffff', '#00ff88', '#ff00aa', '#ffb800', '#5b8cff'] as string[]).map((c) => (
            <linearGradient key={c} id={`zone-${c.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={c} stopOpacity="0.5" />
              <stop offset="1" stopColor={c} stopOpacity="0.08" />
            </linearGradient>
          ))}

          {/* grid pattern */}
          <pattern id="iso-grid" patternUnits="userSpaceOnUse" width="80" height="40" patternTransform="skewX(-30) skewY(0)">
            <path d="M 0 0 L 80 0 M 0 0 L 0 40" stroke="#00ffff" strokeWidth="0.7" opacity="0.18" />
          </pattern>
          <pattern id="iso-grid-2" patternUnits="userSpaceOnUse" width="80" height="40" patternTransform="skewX(30) skewY(0)">
            <path d="M 0 0 L 80 0 M 0 0 L 0 40" stroke="#00ffff" strokeWidth="0.7" opacity="0.12" />
          </pattern>

          {/* glow filters */}
          <filter id="glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-soft" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
          <filter id="glow-strong" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* =========================================================== */}
        {/* SKY + NEBULA + CITY                                          */}
        {/* =========================================================== */}
        <rect x={0} y={0} width={2400} height={1500} fill="url(#sky)" />
        <ellipse cx={1200} cy={550} rx={1500} ry={500} fill="url(#nebula)" />
        {/* stars */}
        {Array.from({ length: 80 }).map((_, i) => {
          const sx = (i * 173) % 2400;
          const sy = (i * 91) % 480;
          const r = (i % 3) * 0.4 + 0.4;
          return <circle key={i} cx={sx} cy={sy} r={r} fill="#fff" opacity={0.55 + (i % 4) * 0.1} />;
        })}

        {/* moon-like sphere */}
        <circle cx={1900} cy={220} r={50} fill="#1a1f44" opacity={0.6} filter="url(#glow-soft)" />
        <circle cx={1900} cy={220} r={50} fill="none" stroke="#a855f7" strokeWidth={1.5} opacity={0.75} />
        <circle cx={1900} cy={220} r={62} fill="none" stroke="#a855f7" strokeWidth={0.6} opacity={0.4} strokeDasharray="4 4">
          <animateTransform attributeName="transform" type="rotate" from="0 1900 220" to="360 1900 220" dur="60s" repeatCount="indefinite" />
        </circle>

        {/* cyberpunk city silhouette */}
        <g opacity={0.85}>
          {[
            [50, 360, 70, 240, '#1a1f4a'], [120, 320, 60, 280, '#161c4a'], [180, 340, 90, 260, '#10153a'],
            [270, 280, 80, 320, '#1a1f4a'], [350, 310, 70, 290, '#161c4a'], [420, 350, 100, 250, '#0e1232'],
            [520, 260, 80, 340, '#1a1f4a'], [600, 320, 70, 280, '#161c4a'], [670, 290, 110, 310, '#10153a'],
            [780, 340, 70, 260, '#1a1f4a'], [850, 300, 80, 300, '#0e1232'], [930, 340, 90, 260, '#161c4a'],
            [1020, 270, 70, 330, '#1a1f4a'], [1090, 310, 100, 290, '#10153a'], [1190, 340, 80, 260, '#161c4a'],
            [1270, 290, 90, 310, '#1a1f4a'], [1360, 320, 70, 280, '#0e1232'], [1430, 280, 100, 320, '#10153a'],
            [1530, 340, 70, 260, '#161c4a'], [1600, 310, 90, 290, '#1a1f4a'], [1690, 340, 80, 260, '#0e1232'],
            [1770, 300, 100, 300, '#10153a'], [1870, 350, 70, 250, '#161c4a'], [1940, 320, 90, 280, '#1a1f4a'],
            [2030, 290, 110, 310, '#10153a'], [2140, 340, 80, 260, '#161c4a'], [2220, 310, 100, 290, '#1a1f4a'],
            [2320, 350, 80, 250, '#0e1232'],
          ].map(([x, y, w, h, fill], i) => (
            <g key={i}>
              <rect x={x as number} y={y as number} width={w as number} height={h as number} fill={fill as string} />
              {/* random lit windows */}
              {Array.from({ length: 12 }).map((_, j) => (
                <rect
                  key={j}
                  x={(x as number) + 6 + ((j * 11) % ((w as number) - 12))}
                  y={(y as number) + 10 + ((j * 17) % ((h as number) - 16))}
                  width={3} height={3}
                  fill={(j + i) % 5 === 0 ? '#ff00aa' : (j + i) % 4 === 0 ? '#00ffff' : '#ffb800'}
                  opacity={0.65}
                />
              ))}
            </g>
          ))}
        </g>

        {/* atmosphere haze */}
        <rect x={0} y={520} width={2400} height={140} fill="url(#sky)" opacity={0.4} />
        <line x1={0} y1={600} x2={2400} y2={600} stroke="#00ffff" strokeWidth={1} opacity={0.25} />

        {/* Title sign */}
        <g transform="translate(1200 130)">
          <rect x={-380} y={-50} width={760} height={70} fill="#04060f" opacity={0.8} stroke="#00ffff" strokeWidth={1.5} rx={2} />
          <rect x={-380} y={-50} width={760} height={4} fill="#00ffff" />
          <text x={0} y={-18} fontFamily="Orbitron, system-ui" fontWeight={900} fontSize={28} fill="#00ffff" textAnchor="middle" letterSpacing={5}>
            SYBERNETIC LOBSTER FACTORY
          </text>
          <text x={0} y={5} fontFamily="JetBrains Mono, monospace" fontSize={11} fill="#ff00aa" textAnchor="middle" letterSpacing={6}>
            ADVANCED DIGITAL OPERATIONS · ENTERPRISE AGENT TEAM HUB
          </text>
          <text x={0} y={22} fontFamily="HarmonyOS Sans, system-ui" fontSize={10} fill="#00ffff" opacity={0.6} textAnchor="middle" letterSpacing={4}>
            🦞 蓝血军团 · 总部 · B3
          </text>
        </g>

        {/* =========================================================== */}
        {/* MAIN FLOOR SLAB                                              */}
        {/* =========================================================== */}
        <g>
          {/* floor as iso parallelogram */}
          <polygon points="220,700 2200,700 1700,1400 -280,1400" fill="url(#floor)" />
          {/* grid overlays */}
          <polygon points="220,700 2200,700 1700,1400 -280,1400" fill="url(#iso-grid)" opacity={0.5} />
          <polygon points="220,700 2200,700 1700,1400 -280,1400" fill="url(#iso-grid-2)" opacity={0.4} />
          {/* edge highlight */}
          <polyline points="220,700 2200,700 1700,1400 -280,1400 220,700" fill="none" stroke="#00ffff" strokeWidth={1.5} opacity={0.55} />

          {/* big floor decals */}
          <g transform="translate(1200 980)" opacity={0.32}>
            <circle r={180} fill="none" stroke="#00ffff" strokeWidth={1.5} />
            <circle r={120} fill="none" stroke="#00ffff" strokeWidth={1} strokeDasharray="6 6">
              <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="40s" repeatCount="indefinite" />
            </circle>
            <circle r={60} fill="none" stroke="#ff00aa" strokeWidth={1} />
            <text x={0} y={5} fontFamily="Orbitron" fontSize={14} fill="#00ffff" textAnchor="middle" letterSpacing={4} opacity={0.6}>HQ</text>
          </g>
        </g>

        {/* =========================================================== */}
        {/* ZONE 1 — EXECUTIVE SUITE (raised platform, right back)        */}
        {/* =========================================================== */}
        <g>
          {/* raised base */}
          <IsoCube x={1600} y={420} w={520} d={260} h={70} fill="#10153a" stroke="#a855f7" strokeW={1.4} topFill="#161c4a" leftFill="#0a0e27" rightFill="#070a1a" />
          {/* purple inset tile */}
          <IsoTile x={1620} y={430} w={480} d={240} fill="url(#zone-a855f7)" stroke="#a855f7" strokeW={1.4} opacity={0.85} />
          {/* trim */}
          {[[1620, 430], [2100, 430 - 240], [1620 - 240, 430 - 120], [2100 - 240, 430 - 240 - 120]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={3.5} fill="#a855f7" filter="url(#glow-soft)" />
          ))}

          {/* glass walls back */}
          <GlassWall x={1620} y={430} len={480} h={140} axis="right" color="#a855f7" />
          <GlassWall x={1620 - 240} y={310} len={240} h={140} axis="right" color="#a855f7" opacity={0.1} />

          {/* CEO desk (large) + 屏幕 */}
          <Desk x={1820} y={490} color="#1a1f4a" />
          <Monitor x={1860} y={470} color="#a855f7" screen="purple" />
          <Monitor x={1900} y={460} color="#a855f7" screen="magenta" />

          {/* Chair behind */}
          <Chair x={1812} y={510} color="#0a0e27" />

          {/* CEO Character: 林·决策官 */}
          <Character x={1820} y={510} hair="short" hairColor="#0a0e27" outfit="#a855f7" outfitDark="#6b21a8" eyes="glasses" accessory="tablet" status="working" glow="#a855f7" />
          {/* name plate */}
          <NamePlate x={1820} y={555} label="林·决策官" sub="STRATEGY MGR · LV.7" color="#a855f7" />

          {/* Holo Sign */}
          <HoloSign x={1850} y={310} label="EXECUTIVE SUITE / B3" sub="决策中心 · 战略 Manager" color="#a855f7" wide={300} />
        </g>

        {/* =========================================================== */}
        {/* ZONE 2 — EVOLUTION CHARGER (back center)                     */}
        {/* =========================================================== */}
        <g>
          <IsoCube x={750} y={520} w={520} d={220} h={30} fill="#0e1232" stroke="#5b8cff" strokeW={1.2} topFill="#0e1232" />
          <IsoTile x={760} y={525} w={500} d={210} fill="url(#zone-5b8cff)" stroke="#5b8cff" strokeW={1.2} />

          {/* Charging pods (cylindrical capsules) */}
          {[
            [880, 510, '#5b8cff'],
            [1010, 470, '#a855f7'],
          ].map(([cx, cy, c], i) => (
            <g key={i}>
              {/* base */}
              <ellipse cx={cx as number} cy={cy as number + 70} rx={36} ry={12} fill="#04060f" stroke={c as string} strokeWidth={1.5} />
              {/* capsule */}
              <path d={`M ${(cx as number) - 32} ${(cy as number) + 70} Q ${(cx as number) - 32} ${(cy as number) - 30} ${cx} ${(cy as number) - 50} Q ${(cx as number) + 32} ${(cy as number) - 30} ${(cx as number) + 32} ${(cy as number) + 70}`} fill={c as string} opacity={0.22} stroke={c as string} strokeWidth={1.5} />
              {/* energy lines */}
              <line x1={cx as number} y1={(cy as number) - 50} x2={cx as number} y2={(cy as number) + 70} stroke={c as string} strokeWidth={0.6} strokeDasharray="3 4" opacity={0.6} />
              {/* glow */}
              <ellipse cx={cx as number} cy={cy as number + 25} rx={20} ry={6} fill={c as string} opacity={0.25} filter="url(#glow-soft)" />
            </g>
          ))}

          {/* Hermes Flywheel center */}
          <g transform="translate(1180 540)">
            <circle r={56} fill="none" stroke="#ff00aa" strokeWidth={1.5} opacity={0.7} />
            <circle r={42} fill="none" stroke="#00ffff" strokeWidth={1} strokeDasharray="5 5" opacity={0.6}>
              <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="14s" repeatCount="indefinite" />
            </circle>
            <circle r={28} fill="#04060f" stroke="#ff00aa" strokeWidth={1.5} opacity={0.85} />
            <text y={4} fontFamily="Orbitron" fontSize={22} fill="#ff00aa" textAnchor="middle" filter="url(#glow-soft)">⟁</text>
            <text y={28} fontFamily="JetBrains Mono" fontSize={6.5} fill="#ff00aa" textAnchor="middle" letterSpacing={2}>HERMES v0.9.3</text>
          </g>

          {/* 璇·数据官 in the left charging pod */}
          <Character x={1010} y={485} hair="space-buns" hairColor="#a855f7" outfit="#a855f7" outfitDark="#6b21a8" eyes="vr" accessory="none" status="training" glow="#a855f7" />
          <NamePlate x={1010} y={530} label="璇·数据官" sub="TRAINING · Lv.3" color="#a855f7" />

          <HoloSign x={1010} y={400} label="LEARNING & EVOLUTION" sub="充电区 · Hermes 自进化" color="#5b8cff" wide={280} />
        </g>

        {/* =========================================================== */}
        {/* ZONE 3 — OPEN OFFICE (center main)                           */}
        {/* =========================================================== */}
        <g>
          <IsoTile x={620} y={870} w={780} d={260} fill="url(#zone-00ffff)" stroke="#00ffff" strokeW={1.6} opacity={0.95} />
          {/* corner cyber brackets */}
          {[[620, 870], [1400, 870 - 390], [620 - 260, 870 - 130], [1400 - 260, 870 - 130 - 390]].map(([cx, cy], i) => (
            <g key={i} transform={`translate(${cx} ${cy})`}>
              <rect x={-6} y={-2} width={14} height={2} fill="#00ffff" />
              <rect x={-2} y={-6} width={2} height={14} fill="#00ffff" />
            </g>
          ))}

          {/* glass partition back of open office */}
          <GlassWall x={620} y={870} len={780} h={100} axis="right" color="#00ffff" />

          {/* desks 2x3 grid */}
          {/*  Row 1 (back): 雪 · 岚 · 砚 */}
          {/*  Row 2 (front): 炅 · 芸 · (empty) */}
          {/* — manual positions */}

          {/* 雪·销售官 (back-left) */}
          <g transform="translate(0 0)">
            <Desk x={780} y={840} />
            <Monitor x={810} y={822} color="#00ffff" screen="data" />
            <Chair x={772} y={860} />
            <Character x={780} y={862} hair="pony" hairColor="#0a0e27" outfit="#00ffff" outfitDark="#0e7490" eyes="normal" accessory="tablet" status="working" />
            <NamePlate x={780} y={905} label="雪·销售官" sub="SALES · LV.5" color="#00ffff" />
          </g>

          {/* 岚·运营官 (back-mid) */}
          <g>
            <Desk x={1000} y={870} />
            <Monitor x={1030} y={852} color="#00ff88" screen="green" />
            <Chair x={992} y={890} />
            <Character x={1000} y={892} hair="beanie" hairColor="#00ff88" outfit="#00ff88" outfitDark="#065f46" eyes="normal" accessory="coffee" status="working" glow="#00ff88" />
            <NamePlate x={1000} y={935} label="岚·运营官" sub="OPS · LV.4" color="#00ff88" />
          </g>

          {/* 砚·财务官 (back-right) - BLOCKED */}
          <g>
            <Desk x={1220} y={900} />
            <Monitor x={1250} y={882} color="#ffb800" screen="red" />
            <Chair x={1212} y={920} />
            <Character x={1220} y={922} hair="bun" hairColor="#5b2a86" outfit="#ffb800" outfitDark="#a16207" eyes="shock" accessory="papers" status="blocked" glow="#ff3860" />
            <NamePlate x={1220} y={965} label="砚·财务官 ⚠" sub="FIN · BLOCKED" color="#ff3860" />
          </g>

          {/* 炅·研发官 (front-left) */}
          <g>
            <Desk x={820} y={970} />
            <Monitor x={850} y={952} color="#5b8cff" screen="data" />
            <Chair x={812} y={990} />
            <Character x={820} y={992} hair="hood" hairColor="#1a1a2e" outfit="#5b8cff" outfitDark="#1e40af" eyes="normal" accessory="coffee" status="working" glow="#5b8cff" />
            <NamePlate x={820} y={1035} label="炅·研发官" sub="DEV · LV.5" color="#5b8cff" />
          </g>

          {/* 芸·文档官 (front-mid) - IDLE */}
          <g>
            <Desk x={1040} y={1000} />
            <Monitor x={1070} y={982} color="#5b8cff" screen="data" />
            <Chair x={1032} y={1020} />
            <Character x={1040} y={1022} hair="short" hairColor="#6b7280" outfit="#9ca3af" outfitDark="#4b5563" eyes="closed" accessory="none" status="idle" glow="#5b8cff" />
            <NamePlate x={1040} y={1065} label="芸·文档官" sub="DOC · IDLE" color="#9ca3af" />
          </g>

          {/* "Z" sleep above 芸 */}
          <g transform="translate(1060 985)" opacity={0.7}>
            <text x={0} y={0} fontSize={10} fill="#5b8cff" fontFamily="Orbitron">z</text>
            <text x={6} y={-8} fontSize={14} fill="#5b8cff" fontFamily="Orbitron">z</text>
            <text x={14} y={-18} fontSize={18} fill="#5b8cff" fontFamily="Orbitron">Z</text>
          </g>

          {/* central data ring decoration */}
          <g transform="translate(1280 1020)" opacity={0.5}>
            <ellipse rx={40} ry={14} fill="none" stroke="#00ffff" strokeWidth={1} strokeDasharray="3 3">
              <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="20s" repeatCount="indefinite" />
            </ellipse>
          </g>

          <HoloSign x={1010} y={680} label="OPEN OFFICE" sub="业务办公区 · AI WORKFLOW" color="#00ffff" wide={300} />
        </g>

        {/* =========================================================== */}
        {/* ZONE 4 — PUBLIC OFFICE ZONE (front left = 行政支持中心)         */}
        {/* =========================================================== */}
        <g>
          <IsoTile x={170} y={1010} w={620} d={250} fill="url(#zone-00ff88)" stroke="#00ff88" strokeW={1.4} />
          {/* counter (reception bar) */}
          <IsoCube x={220} y={1020} w={120} d={40} h={18} fill="#0a0e27" stroke="#00ff88" strokeW={1.2} />

          {/* 荷·人事官 (HR) */}
          <g>
            <Desk x={310} y={1080} />
            <Monitor x={340} y={1062} color="#ff00aa" screen="magenta" />
            <Chair x={302} y={1100} />
            <Character x={310} y={1102} hair="bob" hairColor="#0a0e27" outfit="#ff00aa" outfitDark="#9d174d" eyes="normal" accessory="clipboard" status="working" glow="#ff00aa" skin="#fde2c6" />
            <NamePlate x={310} y={1145} label="荷·人事官" sub="HR · LV.4" color="#ff00aa" />
          </g>

          {/* 律·法务官 (Legal) */}
          <g>
            <Desk x={490} y={1120} />
            <Monitor x={520} y={1102} color="#ffb800" screen="data" />
            <Chair x={482} y={1140} />
            <Character x={490} y={1142} hair="side" hairColor="#0a0e27" outfit="#1f2937" outfitDark="#0a0e27" eyes="glasses" accessory="briefcase" status="working" glow="#ffb800" />
            <NamePlate x={490} y={1185} label="律·法务官" sub="LEGAL · LV.5" color="#ffb800" />
          </g>

          {/* 苓·客服官 (Customer Service) */}
          <g>
            <Desk x={650} y={1170} />
            <Monitor x={680} y={1152} color="#00ff88" screen="green" />
            <Chair x={642} y={1190} />
            <Character x={650} y={1192} hair="pony" hairColor="#92400e" outfit="#00ff88" outfitDark="#14532d" eyes="normal" accessory="headset" status="working" glow="#00ff88" />
            <NamePlate x={650} y={1235} label="苓·客服官" sub="CS · LV.6" color="#00ff88" />
          </g>

          <HoloSign x={420} y={920} label="PUBLIC OFFICE ZONE" sub="行政支持中心 · HR / LEGAL / CS" color="#00ff88" wide={300} />
        </g>

        {/* =========================================================== */}
        {/* ZONE 5 — CONFERENCE HUB (right middle, glass dome)            */}
        {/* =========================================================== */}
        <g>
          <IsoTile x={1620} y={920} w={460} d={220} fill="url(#zone-ff00aa)" stroke="#ff00aa" strokeW={1.6} opacity={0.95} />

          {/* Glass dome (semi-transparent) */}
          <g opacity={0.65}>
            {/* dome ellipse */}
            <ellipse cx={1750} cy={870} rx={210} ry={70} fill="#ff00aa" opacity={0.06} stroke="#ff00aa" strokeWidth={1.5} />
            <path d={`M 1540 870 Q 1750 740 1960 870`} fill="#ff00aa" fillOpacity={0.06} stroke="#ff00aa" strokeWidth={1.5} />
            {/* dome ribs */}
            <line x1={1750} y1={740} x2={1750} y2={870} stroke="#ff00aa" strokeWidth={0.9} opacity={0.6} />
            <path d={`M 1640 800 Q 1750 760 1860 800`} stroke="#ff00aa" strokeWidth={0.7} opacity={0.6} fill="none" />
          </g>

          {/* Round table */}
          <ellipse cx={1750} cy={1000} rx={120} ry={40} fill="#0a0e27" stroke="#ff00aa" strokeWidth={1.5} />
          <ellipse cx={1750} cy={1000} rx={80} ry={26} fill="#ff00aa" opacity={0.15} stroke="#ff00aa" strokeWidth={1} />
          {/* central holo */}
          <g transform="translate(1750 990)" opacity={0.9}>
            <ellipse rx={40} ry={6} fill="#ff00aa" opacity={0.3} filter="url(#glow-soft)" />
            <text y={-2} fontSize={9} fill="#ff00aa" fontFamily="Orbitron" textAnchor="middle" letterSpacing={3}>Q3 STRATEGY</text>
          </g>

          {/* Manager·会议主持 at the head of the table */}
          <Character x={1750} y={970} hair="bald-glasses" hairColor="#0a0e27" outfit="#ff00aa" outfitDark="#9d174d" eyes="glasses" accessory="gavel" status="meeting" glow="#ff00aa" />
          <NamePlate x={1750} y={1015} label="Manager·会议主持" sub="MEETING HOST · LV.6" color="#ff00aa" />

          {/* 6 empty chairs around table */}
          {[0, 60, 120, 180, 240, 300].map((deg) => {
            const r = (deg * Math.PI) / 180;
            const cx = 1750 + Math.cos(r) * 130;
            const cy = 1000 + Math.sin(r) * 40;
            return <ellipse key={deg} cx={cx} cy={cy} rx={12} ry={5} fill="#04060f" stroke="#ff00aa" strokeWidth={1} opacity={0.6} />;
          })}

          <HoloSign x={1750} y={830} label="CONFERENCE HUB · 青莲" sub="会议室 · Q3 增长策略评审" color="#ff00aa" wide={310} />
        </g>

        {/* =========================================================== */}
        {/* ZONE 6 — RELAXATION LOUNGE (front right)                     */}
        {/* =========================================================== */}
        <g>
          <IsoTile x={1740} y={1200} w={500} d={220} fill="url(#zone-ffb800)" stroke="#ffb800" strokeW={1.4} />

          {/* Sofa */}
          <IsoCube x={1820} y={1240} w={160} d={48} h={26} fill="#1a1a2e" stroke="#ffb800" strokeW={1} />
          {/* Sofa back */}
          <IsoCube x={1820} y={1240} w={160} d={14} h={40} fill="#1a1a2e" stroke="#ffb800" strokeW={1} faceTopOpacity={0.9} />
          {/* Coffee table */}
          <IsoCube x={2000} y={1290} w={56} d={28} h={8} fill="#0a0e27" stroke="#ffb800" strokeW={1} />
          {/* cup on coffee table */}
          <ellipse cx={2024} cy={1278} rx={6} ry={2.5} fill="#ffb800" stroke="#04060f" strokeWidth={0.8} />
          {/* steam */}
          <path d="M 2024 1278 Q 2022 1265 2026 1255 Q 2030 1245 2024 1235" stroke="#ffb800" strokeWidth={1} fill="none" opacity={0.55} strokeDasharray="2 2" />

          {/* Plant pot */}
          <g transform="translate(2160 1280)">
            <ellipse cx={0} cy={20} rx={14} ry={4} fill="#0a0e27" />
            <path d="M -10 18 L -8 -2 L 8 -2 L 10 18 Z" fill="#0a0e27" stroke="#00ff88" strokeWidth={1} />
            <path d="M 0 -2 Q -8 -16 -4 -28 M 0 -2 Q 8 -16 4 -28 M 0 -2 Q 0 -22 0 -32" stroke="#00ff88" strokeWidth={2} fill="none" />
            <circle cx={0} cy={-32} r={5} fill="#00ff88" opacity={0.6} />
          </g>

          {/* 默·营销官 lounging on sofa */}
          <Character x={1880} y={1255} hair="wavy" hairColor="#92400e" outfit="#ffb800" outfitDark="#a16207" eyes="closed" accessory="coffee" status="idle" glow="#ffb800" />
          <NamePlate x={1880} y={1300} label="默·营销官" sub="MKT · IDLE · 节能" color="#ffb800" />

          <HoloSign x={1990} y={1120} label="RELAXATION LOUNGE · 休息区" sub="休假规划 · 闲置 Agent 节能区" color="#ffb800" wide={320} />
        </g>

        {/* =========================================================== */}
        {/* Floating data particles                                       */}
        {/* =========================================================== */}
        <g opacity={0.7}>
          {Array.from({ length: 26 }).map((_, i) => {
            const px = (i * 211) % 2200 + 100;
            const py = 620 + ((i * 67) % 580);
            const c = ['#00ffff', '#ff00aa', '#00ff88', '#a855f7'][i % 4];
            return (
              <circle key={i} cx={px} cy={py} r={1.6} fill={c} filter="url(#glow-soft)">
                <animate attributeName="cy" values={`${py};${py - 80};${py}`} dur={`${6 + (i % 5)}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.3;1;0.3" dur={`${4 + (i % 4)}s`} repeatCount="indefinite" />
              </circle>
            );
          })}
        </g>

        {/* foreground neon trim accent */}
        <line x1={-280} y1={1400} x2={1700} y2={1400} stroke="#00ffff" strokeWidth={1.6} opacity={0.65} />
      </svg>

      {/* employees data accessor reference (kept to ensure consistency at compile time) */}
      <div className="hidden">{employees.length}</div>
    </div>
  );
}

// --------- Name plate component ---------
function NamePlate({ x, y, label, sub, color }: { x: number; y: number; label: string; sub: string; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-50} y={-10} width={100} height={22} fill="#04060f" opacity={0.85} stroke={color} strokeWidth={0.8} rx={1} />
      <rect x={-50} y={-10} width={100} height={1.5} fill={color} />
      <text x={0} y={0} fontFamily="HarmonyOS Sans, system-ui" fontWeight={700} fontSize={8} fill={color} textAnchor="middle">{label}</text>
      <text x={0} y={9} fontFamily="JetBrains Mono, monospace" fontSize={5.5} fill={color} opacity={0.7} textAnchor="middle" letterSpacing={1}>{sub}</text>
    </g>
  );
}
