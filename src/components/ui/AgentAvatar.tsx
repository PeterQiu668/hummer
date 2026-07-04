/**
 * AgentAvatar (简化版 · 紧急修复)
 * 之前的 CharSVG 在浏览器抛错导致整页空白。先回退到「彩色底 + 首字 + 状态环 + 上传头像支持」可靠版。
 * 后续手绘 chibi 形象单独抽进 ChibiSVG，确认稳定后再切回。
 */
import { useEffect, useState } from 'react';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
const SIZE_PX: Record<AvatarSize, number> = { xs: 20, sm: 28, md: 40, lg: 56, xl: 80 };

const SHIRT_DEFAULT = ['#0F70B7', '#0F766E', '#7E22CE', '#B07706', '#C13D3D', '#171717'];

function hashId(id: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function pickShirtColor(id: string, hint?: string): string {
  if (hint) return hint;
  return SHIRT_DEFAULT[hashId(id) % SHIRT_DEFAULT.length];
}

const STATUS_COLOR: Record<string, string> = {
  working: '#1E8F5C', meeting: '#7E22CE', blocked: '#C13D3D',
  training: '#0F766E', idle: '#A1A1A1',
};

interface Props {
  id: string;
  size?: AvatarSize | number;
  shirtColor?: string;
  status?: 'working' | 'meeting' | 'blocked' | 'training' | 'idle';
  ringWidth?: number;
  className?: string;
  /** 显示在头像上的字（默认从 id 取首字非英数前缀） */
  initial?: string;
}

function defaultInitial(id: string): string {
  // 从 id 取「emp-ceo」之类格式：截 emp- 后第一个非破折号字符
  const after = id.replace(/^[a-z]+-/, '');
  return (after[0] || id[0] || '·').toUpperCase();
}

export default function AgentAvatar({
  id, size = 'md', shirtColor, status, ringWidth, className = '', initial,
}: Props) {
  const px = typeof size === 'number' ? size : SIZE_PX[size];
  const [uploaded, setUploaded] = useState<string | null>(null);

  useEffect(() => {
    setUploaded(localStorage.getItem(`hummer-avatar-${id}`));
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === `hummer-avatar-${id}`) setUploaded(ev.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [id]);

  const shirt = pickShirtColor(id, shirtColor);
  const sColor = status ? STATUS_COLOR[status] : undefined;
  const letter = initial ?? defaultInitial(id);

  // 字号大致是头像的 40%
  const fontSize = Math.max(10, Math.round(px * 0.42));

  return (
    <div
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: px, height: px }}
    >
      <div
        className="absolute inset-0 rounded-full overflow-hidden flex items-center justify-center text-white font-semibold select-none"
        style={{
          background: uploaded
            ? `url(${uploaded}) center/cover`
            : `linear-gradient(135deg, ${shirt}, ${shadeColor(shirt, -24)})`,
          boxShadow: sColor ? `0 0 0 ${ringWidth ?? 2}px ${sColor}` : undefined,
          fontSize,
          lineHeight: 1,
        }}
        aria-label={uploaded ? undefined : letter}
      >
        {!uploaded && letter}
      </div>
      {sColor && (
        <span
          className="absolute rounded-full"
          style={{
            background: sColor,
            width: Math.max(6, px * 0.20),
            height: Math.max(6, px * 0.20),
            right: '-2%', bottom: '-2%',
            border: '2px solid white',
          }}
        />
      )}
    </div>
  );
}

function shadeColor(hex: string, amt: number) {
  const c = hex.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(c.slice(0, 2), 16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(c.slice(2, 4), 16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(c.slice(4, 6), 16) + amt));
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}
