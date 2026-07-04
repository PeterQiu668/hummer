/**
 * AbilityCurve — 近 8 周能力分折线（纯 SVG，无图表库）
 * 标注 SOP/Skill 版本升级点（bump），供进化档案（全页 / Drawer 紧凑）复用。
 */
import type { AbilityPoint } from '../../data/evolution';

const W = 320;

type Props = {
  points: AbilityPoint[];
  height?: number;
  compact?: boolean;
};

export default function AbilityCurve({ points, height = 120, compact = false }: Props) {
  if (points.length < 2) return null;

  const scores = points.map((p) => p.score);
  const lo = Math.floor((Math.min(...scores) - 4) / 5) * 5;
  const hi = Math.ceil((Math.max(...scores) + 4) / 5) * 5;
  const padX = 14;
  const padTop = compact ? 14 : 18;
  const padBottom = compact ? 14 : 20;
  const plotW = W - padX * 2;
  const plotH = height - padTop - padBottom;

  const x = (i: number) => padX + (i / (points.length - 1)) * plotW;
  const y = (s: number) => padTop + (1 - (s - lo) / (hi - lo)) * plotH;

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const area = `${padX},${(padTop + plotH).toFixed(1)} ${line} ${(padX + plotW).toFixed(1)},${(padTop + plotH).toFixed(1)}`;
  const gridLines = [0, 0.5, 1].map((t) => padTop + t * plotH);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full block" style={{ height: 'auto' }}>
      {/* 网格 */}
      {gridLines.map((gy, i) => (
        <line key={i} x1={padX} x2={W - padX} y1={gy} y2={gy} stroke="var(--border-subtle)" strokeWidth="1" />
      ))}
      {/* 面积 + 折线 */}
      <polygon points={area} fill="rgba(15, 112, 183, 0.07)" />
      <polyline points={line} fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {/* 数据点 + 版本升级标注 */}
      {points.map((p, i) => {
        const isLast = i === points.length - 1;
        return (
          <g key={p.week}>
            {p.bump && (
              <>
                <line x1={x(i)} x2={x(i)} y1={y(p.score)} y2={padTop + plotH} stroke="rgba(126, 34, 206, 0.25)" strokeWidth="1" strokeDasharray="2 2" />
                <circle cx={x(i)} cy={y(p.score)} r={3.2} fill="#7E22CE" stroke="white" strokeWidth="1.2" />
                {!compact && (
                  <text x={x(i)} y={y(p.score) - 7} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#7E22CE">
                    {p.bump}
                  </text>
                )}
              </>
            )}
            {!p.bump && (
              <circle cx={x(i)} cy={y(p.score)} r={isLast ? 3 : 2} fill={isLast ? 'var(--brand)' : 'white'} stroke="var(--brand)" strokeWidth="1.2" />
            )}
            {isLast && (
              <text x={Math.min(x(i), W - padX)} y={y(p.score) - (p.bump ? 16 : 7)} textAnchor="end" fontSize="9.5" fontWeight="700" fill="var(--brand)">
                {p.score}
              </text>
            )}
            {/* X 轴周标签（紧凑模式隔一个显示） */}
            {(!compact || i % 2 === 1 || i === 0) && (
              <text x={x(i)} y={height - 4} textAnchor="middle" fontSize="7.5" fill="var(--text-faint)">
                {p.week}
              </text>
            )}
          </g>
        );
      })}
      {/* Y 轴上下界 */}
      <text x={2} y={padTop + 3} fontSize="7.5" fill="var(--text-faint)">{hi}</text>
      <text x={2} y={padTop + plotH + 3} fontSize="7.5" fill="var(--text-faint)">{lo}</text>
    </svg>
  );
}
