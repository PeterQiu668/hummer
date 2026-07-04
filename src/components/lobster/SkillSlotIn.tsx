/**
 * 黑客帝国式技能插盘动画 — 视频① 上岗机制
 * 全屏 overlay · 矩阵雨数据流 · 3 秒后自动关闭
 */
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export default function SkillSlotIn() {
  const slotIn = useAppStore((s) => s.slotIn);
  const clearSlotIn = useAppStore((s) => s.clearSlotIn);

  useEffect(() => {
    if (!slotIn) return;
    const t = setTimeout(() => clearSlotIn(), 3200);
    return () => clearTimeout(t);
  }, [slotIn, clearSlotIn]);

  return (
    <AnimatePresence>
      {slotIn && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[60] bg-neutral-900/90 backdrop-blur-md flex items-center justify-center"
        >
          <MatrixRain />
          {/* Center card */}
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 180 }}
            className="relative z-10 max-w-md w-full mx-6"
          >
            <div className="bg-neutral-900 border-2 border-tertiary-400 rounded-2xl p-8 shadow-large relative overflow-hidden">
              {/* Scan line */}
              <motion.div
                className="absolute left-0 right-0 h-px bg-tertiary-300"
                style={{ boxShadow: '0 0 12px #14B8A6' }}
                initial={{ top: '0%' }}
                animate={{ top: '100%' }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
              />

              <div className="text-center">
                <motion.div
                  className="inline-flex w-16 h-16 rounded-full bg-tertiary-400/10 items-center justify-center mb-4 border-2 border-tertiary-400"
                  animate={{ rotate: [0, 360] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                >
                  <Zap size={28} className="text-tertiary-300" />
                </motion.div>
                <div className="text-tertiary-300 text-xs font-mono tracking-widest mb-2">
                  SKILL SLOT-IN · LOADING
                </div>
                <div className="font-display text-2xl text-white font-bold mb-2">
                  {slotIn.skillName}
                </div>
                <div className="text-neutral-400 text-xs mb-1">
                  来源 · {slotIn.skillSource}
                </div>
                <div className="text-neutral-500 text-xs mb-6">
                  目标员工 · {slotIn.agentName}
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden mb-4">
                  <motion.div
                    className="h-full bg-tertiary-400"
                    style={{ boxShadow: '0 0 8px #14B8A6' }}
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 2.6, ease: 'easeOut' }}
                  />
                </div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 2.8 }}
                  className="flex items-center justify-center gap-2 text-success font-mono text-xs"
                >
                  <CheckCircle2 size={14} /> 上岗完成
                </motion.div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────────────────── Matrix Rain Background ─────────────────────

function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = window.innerWidth * dpr;
    cv.height = window.innerHeight * dpr;
    cv.style.width = `${window.innerWidth}px`;
    cv.style.height = `${window.innerHeight}px`;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const W = window.innerWidth;
    const H = window.innerHeight;
    const fontSize = 16;
    const cols = Math.floor(W / fontSize);
    const drops = new Array(cols).fill(0).map(() => Math.random() * H);
    const chars = 'アァカサタナハマヤラワ0123456789ABCDEF{}[]<>/\\|+=-*';

    let raf = 0;
    const draw = () => {
      ctx.fillStyle = 'rgba(8, 12, 20, 0.18)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#14B8A6';
      ctx.font = `${fontSize}px JetBrains Mono, monospace`;

      for (let i = 0; i < drops.length; i++) {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        ctx.fillStyle = Math.random() > 0.96 ? '#5EEAD4' : 'rgba(20, 184, 166, 0.62)';
        ctx.fillText(ch, x, y);

        if (y > H && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 0.8;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: 0.55 }}
    />
  );
}
