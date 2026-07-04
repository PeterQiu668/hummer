import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Network, Filter } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { kgNodes, kgEdges, kgTypeColors, type KGNode, type KGNodeType } from '../../data/kg';

interface SimNode extends KGNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

const WIDTH = 900;
const HEIGHT = 600;
const ALL_TYPES: KGNodeType[] = ['客户', '项目', '合同', '员工', 'SOP', '决策', '部门'];

export default function KnowledgeGraph() {
  const { setShowKG } = useAppStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<KGNodeType>>(new Set(ALL_TYPES));
  const draggingRef = useRef<string | null>(null);

  // Initialize node positions (deterministic seeded layout in a circle, broken by type)
  const nodesRef = useRef<SimNode[]>(
    kgNodes.map((n, i) => {
      const angle = (i / kgNodes.length) * Math.PI * 2;
      const typeIdx = ALL_TYPES.indexOf(n.type);
      const r = 140 + typeIdx * 18;
      return {
        ...n,
        x: WIDTH / 2 + Math.cos(angle) * r,
        y: HEIGHT / 2 + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      };
    }),
  );

  // Force-directed simulation loop (hand-written, no deps)
  useEffect(() => {
    let raf = 0;
    let step = 0;
    const REPULSION = 6500;
    const SPRING = 0.012;
    const SPRING_LEN = 120;
    const CENTER = 0.002;
    const DAMP = 0.86;
    const MAX_STEPS = 600;

    const tickSim = () => {
      const nodes = nodesRef.current;
      // Pairwise repulsion
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (a.fx != null && a.fy != null) {
          a.x = a.fx;
          a.y = a.fy;
          a.vx = 0;
          a.vy = 0;
          continue;
        }
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist2 = dx * dx + dy * dy + 0.01;
          const dist = Math.sqrt(dist2);
          const f = REPULSION / dist2;
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
        // Center pull
        a.vx += (WIDTH / 2 - a.x) * CENTER;
        a.vy += (HEIGHT / 2 - a.y) * CENTER;
      }
      // Spring along edges
      for (const e of kgEdges) {
        const s = nodes.find((n) => n.id === e.source);
        const t = nodes.find((n) => n.id === e.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const diff = dist - SPRING_LEN;
        const fx = (dx / dist) * diff * SPRING;
        const fy = (dy / dist) * diff * SPRING;
        if (s.fx == null) {
          s.vx += fx;
          s.vy += fy;
        }
        if (t.fx == null) {
          t.vx -= fx;
          t.vy -= fy;
        }
      }
      // Integrate
      for (const n of nodes) {
        if (n.fx != null && n.fy != null) continue;
        n.vx *= DAMP;
        n.vy *= DAMP;
        n.x += n.vx;
        n.y += n.vy;
        // Boundary clamp
        n.x = Math.max(30, Math.min(WIDTH - 30, n.x));
        n.y = Math.max(30, Math.min(HEIGHT - 30, n.y));
      }
      step++;
      setTick((v) => (v + 1) % 100000);
      if (step < MAX_STEPS) raf = requestAnimationFrame(tickSim);
    };
    raf = requestAnimationFrame(tickSim);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Drag handlers
  const onPointerDown = (id: string, e: React.PointerEvent) => {
    draggingRef.current = id;
    (e.target as Element).setPointerCapture(e.pointerId);
    const node = nodesRef.current.find((n) => n.id === id)!;
    node.fx = node.x;
    node.fy = node.y;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const id = draggingRef.current;
    if (!id) return;
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    const node = nodesRef.current.find((n) => n.id === id)!;
    node.fx = p.x;
    node.fy = p.y;
    setTick((v) => v + 1);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const id = draggingRef.current;
    if (id) {
      const node = nodesRef.current.find((n) => n.id === id)!;
      node.fx = null;
      node.fy = null;
    }
    draggingRef.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  // Filtered view
  const visibleNodes = useMemo(() => {
    return nodesRef.current.filter(
      (n) =>
        typeFilter.has(n.type) &&
        (query === '' || n.label.includes(query) || n.type.includes(query)),
    );
    // tick triggers re-render on sim updates
  }, [tick, typeFilter, query]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => kgEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [visibleIds],
  );

  // Neighbor set for highlighting
  const focus = selected ?? hover;
  const neighborIds = useMemo(() => {
    if (!focus) return new Set<string>();
    const set = new Set<string>([focus]);
    for (const e of kgEdges) {
      if (e.source === focus) set.add(e.target);
      if (e.target === focus) set.add(e.source);
    }
    return set;
  }, [focus]);

  const selectedNode = selected ? nodesRef.current.find((n) => n.id === selected) : null;

  const toggleType = (t: KGNodeType) => {
    const next = new Set(typeFilter);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setTypeFilter(next);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 bg-ink-900/85 backdrop-blur-md flex"
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.35 }}
        className="m-6 flex-1 glass-strong rounded-sm relative hud-corner flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-neon-cyan/20 flex items-center gap-3 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-[#3B82F6]/10 to-transparent pointer-events-none" />
          <Network size={22} className="relative" style={{ color: '#3B82F6' }} />
          <div className="relative">
            <div className="font-display text-xl tracking-widest" style={{ color: '#3B82F6' }}>
              企业知识图谱
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              ENTERPRISE KNOWLEDGE GRAPH · {kgNodes.length} 节点 · {kgEdges.length} 关系 · force-directed
            </div>
          </div>
          <div className="flex-1" />
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜节点/类型"
              className="pl-7 pr-3 py-1.5 bg-ink-900 border border-white/10 rounded-sm text-xs font-mono w-56 focus:outline-none focus:border-[#3B82F6]/60"
            />
          </div>
          <button onClick={() => setShowKG(false)} className="text-slate-400 hover:text-[#3B82F6]">
            <X size={20} />
          </button>
        </div>

        {/* Toolbar: type filter */}
        <div className="px-6 py-2.5 border-b border-white/5 flex items-center gap-2 overflow-x-auto">
          <Filter size={12} className="text-slate-500" />
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">类型筛选</span>
          {ALL_TYPES.map((t) => {
            const active = typeFilter.has(t);
            const color = kgTypeColors[t];
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className="px-2.5 py-1 rounded-sm text-[11px] font-mono transition whitespace-nowrap border"
                style={{
                  borderColor: active ? color : 'rgba(255,255,255,0.08)',
                  background: active ? `${color}22` : 'transparent',
                  color: active ? color : '#94a3b8',
                }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                  style={{ background: color }}
                />
                {t}
              </button>
            );
          })}
          <div className="flex-1" />
          <span className="text-[10px] font-mono text-slate-500">
            {visibleNodes.length} / {kgNodes.length} 节点 · {visibleEdges.length} 边
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Graph canvas */}
          <div className="flex-1 relative overflow-hidden" style={{ background: '#0a0e1a' }}>
            <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />
            <svg
              ref={svgRef}
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="xMidYMid meet"
              className="absolute inset-0 w-full h-full"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onClick={() => setSelected(null)}
            >
              {/* Edges */}
              <g>
                {visibleEdges.map((e) => {
                  const s = nodesRef.current.find((n) => n.id === e.source);
                  const t = nodesRef.current.find((n) => n.id === e.target);
                  if (!s || !t) return null;
                  const highlight = focus && (e.source === focus || e.target === focus);
                  const dim = focus && !highlight;
                  return (
                    <g key={e.id} opacity={dim ? 0.12 : 1}>
                      <line
                        x1={s.x}
                        y1={s.y}
                        x2={t.x}
                        y2={t.y}
                        stroke={highlight ? '#3B82F6' : '#475569'}
                        strokeWidth={highlight ? 1.6 : 0.8}
                        strokeOpacity={highlight ? 0.9 : 0.55}
                      />
                      {highlight && (
                        <text
                          x={(s.x + t.x) / 2}
                          y={(s.y + t.y) / 2 - 4}
                          fill="#94a3b8"
                          fontSize="9"
                          fontFamily="JetBrains Mono, monospace"
                          textAnchor="middle"
                        >
                          {e.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
              {/* Nodes */}
              <g>
                {visibleNodes.map((n) => {
                  const color = kgTypeColors[n.type];
                  const isFocus = focus === n.id;
                  const inNeighbor = focus ? neighborIds.has(n.id) : true;
                  const r = isFocus ? 14 : 10;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      opacity={inNeighbor ? 1 : 0.25}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={(e) => onPointerDown(n.id, e)}
                      onMouseEnter={() => setHover(n.id)}
                      onMouseLeave={() => setHover(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(n.id === selected ? null : n.id);
                      }}
                    >
                      {/* Outer glow */}
                      {isFocus && (
                        <circle r={r + 6} fill={color} opacity={0.18} />
                      )}
                      <circle
                        r={r}
                        fill={color}
                        fillOpacity={0.85}
                        stroke="#0a0e1a"
                        strokeWidth={2}
                      />
                      <text
                        y={r + 11}
                        fill="#e2e8f0"
                        fontSize="10"
                        fontFamily="Inter, sans-serif"
                        textAnchor="middle"
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        {n.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Hover tooltip */}
            {hover && !selected && (() => {
              const n = nodesRef.current.find((x) => x.id === hover);
              if (!n) return null;
              return (
                <div
                  className="absolute glass-strong rounded-sm border border-white/10 p-2 text-[10px] font-mono pointer-events-none"
                  style={{
                    left: `${(n.x / WIDTH) * 100}%`,
                    top: `${(n.y / HEIGHT) * 100}%`,
                    transform: 'translate(16px, 16px)',
                  }}
                >
                  <div className="font-display text-xs" style={{ color: kgTypeColors[n.type] }}>
                    {n.label}
                  </div>
                  <div className="text-slate-500 mt-0.5">{n.type}</div>
                  {Object.entries(n.props).map(([k, v]) => (
                    <div key={k} className="text-slate-300">
                      <span className="text-slate-500">{k}:</span> {v}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Right detail panel */}
          <div className="w-72 border-l border-white/5 bg-ink-900/40 flex flex-col">
            <div className="px-3 py-2 border-b border-white/5 text-[11px] font-display tracking-widest text-slate-300">
              节点详情
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {selectedNode ? (
                <>
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ background: kgTypeColors[selectedNode.type] }}
                      />
                      <div
                        className="font-display text-base"
                        style={{ color: kgTypeColors[selectedNode.type] }}
                      >
                        {selectedNode.label}
                      </div>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      {selectedNode.type} · {selectedNode.id}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {Object.entries(selectedNode.props).map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-center justify-between text-[11px] glass rounded-sm px-2 py-1.5 border border-white/5"
                      >
                        <span className="text-slate-500 font-mono">{k}</span>
                        <span className="text-slate-200">{v}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
                      邻居 ({neighborIds.size - 1})
                    </div>
                    <div className="space-y-1">
                      {Array.from(neighborIds)
                        .filter((id) => id !== selected)
                        .map((id) => {
                          const nb = nodesRef.current.find((x) => x.id === id);
                          if (!nb) return null;
                          const edge = kgEdges.find(
                            (e) =>
                              (e.source === selected && e.target === id) ||
                              (e.target === selected && e.source === id),
                          );
                          return (
                            <button
                              key={id}
                              onClick={() => setSelected(id)}
                              className="w-full flex items-center gap-2 px-2 py-1 glass rounded-sm border border-white/5 hover:border-[#3B82F6]/50 text-left"
                            >
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ background: kgTypeColors[nb.type] }}
                              />
                              <span className="text-[11px] text-slate-200 flex-1 truncate">
                                {nb.label}
                              </span>
                              <span className="text-[9px] font-mono text-slate-500">
                                {edge?.label}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  点击节点查看属性、邻居与关系。<br />
                  拖动节点可重新布局。<br />
                  hover 显示节点属性 tooltip。
                </div>
              )}
            </div>
            <div className="px-3 py-2 border-t border-white/5 text-[9px] font-mono text-slate-500 leading-relaxed">
              KG-CYPHER · sqlite + 图视图<br />
              MCP: kg.enterprise · 9.6k nodes (full)
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
