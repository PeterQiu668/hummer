import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const LINES = [
  '> 启动 Lobster Factory · Enterprise Agent Team OS',
  '> 加载 OpenClaw Runtime ✓',
  '> 连接 A2A Protocol v1.0 ✓',
  '> 校验 MCP Hub · 23 个企业工具签名 ✓',
  '> 注册数字分身：昆仑 ✓',
  '> 同步 12 位数字员工 · 4 个团队 ✓',
  '> Hermes 进化引擎 · 待命',
  '> HiClaw 治理舱 · 在线',
  '> 安全沙箱 · Firecracker · 隔离已生效',
  '> 准备就绪，欢迎回来。',
];

export default function BootScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step < LINES.length) {
      const t = setTimeout(() => setStep((s) => s + 1), 180);
      return () => clearTimeout(t);
    }
    const t = setTimeout(onDone, 700);
    return () => clearTimeout(t);
  }, [step, onDone]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-900 grid-bg">
      <div className="scanline-overlay" />
      <div className="absolute inset-0 bg-radial-glow opacity-70" />
      <div className="relative h-full w-full flex flex-col items-center justify-center text-center px-8">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          className="relative"
        >
          <div className="font-display text-7xl md:text-9xl font-black tracking-widest neon-text">
            LOBSTER
          </div>
          <div className="font-display text-3xl md:text-5xl font-bold tracking-[0.5em] neon-text-magenta mt-2">
            F A C T O R Y
          </div>
          <motion.div
            className="absolute -inset-12 rounded-full border border-neon-cyan/30"
            animate={{ rotate: 360 }}
            transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
          />
          <motion.div
            className="absolute -inset-24 rounded-full border border-neon-magenta/20"
            animate={{ rotate: -360 }}
            transition={{ duration: 50, repeat: Infinity, ease: 'linear' }}
          />
        </motion.div>

        <div className="mt-12 font-mono text-xs text-neon-cyan/80 max-w-xl text-left w-full">
          <div className="text-neon-green/80 mb-2">[ SYSTEM BOOT · 2026.06.21 ]</div>
          {LINES.slice(0, step).map((l, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="leading-relaxed"
            >
              {l}
            </motion.div>
          ))}
          {step < LINES.length && (
            <span className="inline-block w-2 h-3 bg-neon-cyan ml-1 animate-pulse" />
          )}
        </div>

        <div className="absolute bottom-8 left-0 right-0 text-center text-[10px] font-mono tracking-widest text-neon-cyan/40">
          ENTERPRISE AGENT TEAM OS · OPENCLAW · HERMES · HICLAW · OPENHUMAN
        </div>
      </div>
    </div>
  );
}
