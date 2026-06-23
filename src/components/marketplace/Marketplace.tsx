import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Star, X, Sparkles, BadgeCheck, Users, Zap, ShoppingCart } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { marketEmployees, marketCategories } from '../../data/marketplace';

export default function Marketplace() {
  const { setShowMarketplace } = useAppStore();
  const [cat, setCat] = useState('全部');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    return marketEmployees.filter((m) =>
      (cat === '全部' || m.category === cat) &&
      (q === '' || m.name.includes(q) || m.tags.some((t) => t.includes(q)) || m.expert.includes(q)),
    );
  }, [cat, q]);

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
        transition={{ duration: 0.4 }}
        className="m-6 flex-1 glass-strong rounded-sm relative hud-corner flex flex-col"
      >
        <div className="px-6 py-4 border-b border-neon-cyan/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-sm bg-gradient-to-br from-neon-amber/30 to-neon-magenta/30 border border-neon-amber/40 flex items-center justify-center text-xl">🛒</div>
          <div>
            <div className="font-display text-xl tracking-widest neon-text">员工市场</div>
            <div className="text-[11px] font-mono text-neon-cyan/60">EXPERT-CO-CREATED DIGITAL EMPLOYEES · {marketEmployees.length} 位上岗 · 持续进化</div>
          </div>
          <div className="flex-1" />
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2 text-neon-cyan/60" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="搜员工/技能/专家"
              className="pl-7 pr-3 py-1.5 bg-ink-900 border border-neon-cyan/20 rounded-sm text-xs font-mono w-64 focus:outline-none focus:border-neon-cyan/50"
            />
          </div>
          <button onClick={() => setShowMarketplace(false)} className="text-slate-400 hover:text-neon-cyan">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-neon-cyan/10 flex items-center gap-2 overflow-x-auto">
          {marketCategories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`px-3 py-1 rounded-sm text-[11px] font-mono uppercase tracking-wider transition whitespace-nowrap
                ${cat === c
                  ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40 shadow-neon-cyan'
                  : 'text-slate-400 border border-white/10 hover:text-neon-cyan'}`}
            >
              {c}
            </button>
          ))}
          <div className="flex-1" />
          <div className="text-[10px] font-mono text-neon-cyan/60">显示 {filtered.length} / {marketEmployees.length}</div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((m) => (
            <motion.div
              key={m.id}
              whileHover={{ y: -4 }}
              className="glass rounded-sm relative hud-corner border border-white/10 overflow-hidden group cursor-pointer"
              style={{ boxShadow: `0 0 0 1px ${m.color}22` }}
            >
              <div className="h-20 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${m.color}33, ${m.color}11)` }}>
                <div className="absolute inset-0 grid-bg opacity-40" />
                <div className="absolute -bottom-6 left-3 w-12 h-12 rounded-sm font-display font-black text-2xl flex items-center justify-center border-2"
                  style={{ background: m.color, color: '#04060f', borderColor: m.color }}>
                  {m.avatar}
                </div>
                {m.certified && (
                  <div className="absolute top-2 right-2 chip-magenta">
                    <BadgeCheck size={10} /> 专家认证
                  </div>
                )}
              </div>
              <div className="p-3 pt-7">
                <div className="font-display text-sm text-slate-100">{m.name}</div>
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">{m.category}</div>
                <div className="text-[11px] text-slate-300 mt-2 leading-snug">{m.tagline}</div>

                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  {m.tags.map((t) => (
                    <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-white/5 text-slate-300">{t}</span>
                  ))}
                </div>

                <div className="mt-3 pt-2 border-t border-white/5">
                  <div className="flex items-center gap-1 text-[10px] text-neon-magenta">
                    <Sparkles size={10} /> {m.expert}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{m.expertTitle}</div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
                    <span className="flex items-center gap-0.5"><Star size={10} className="text-neon-amber" /> {m.rating}</span>
                    <span className="flex items-center gap-0.5"><Users size={10} /> {m.hires}</span>
                  </div>
                  <button className="btn-neon-magenta" style={{ borderColor: `${m.color}88`, color: m.color }}>
                    <ShoppingCart size={11} /> 招聘
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-neon-cyan/15 flex items-center gap-4 bg-ink-900/60">
          <Zap size={14} className="text-neon-amber" />
          <div className="text-[11px] text-slate-300">
            招聘后将自动进入「学习进化充电区」训练，Hermes 沙箱评测通过即可上岗。
          </div>
          <div className="flex-1" />
          <button className="btn-neon">查看上岗流程</button>
          <button className="btn-neon-magenta">联系专家共创</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
