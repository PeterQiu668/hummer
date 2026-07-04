/**
 * Toast 容器 — 全局反馈
 */
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Info, AlertTriangle, AlertCircle, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

const META = {
  success: { icon: CheckCircle2,  color: 'var(--success)', bg: 'var(--success-soft)' },
  info:    { icon: Info,           color: 'var(--brand)',   bg: 'var(--brand-soft)' },
  warning: { icon: AlertTriangle,  color: 'var(--warning)', bg: '#FBF2DF' },
  error:   { icon: AlertCircle,    color: 'var(--error)',   bg: 'var(--error-soft)' },
} as const;

export default function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  // Auto-dismiss after 4s
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 4000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  return (
    <div className="fixed top-16 right-4 z-[300] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => {
          const m = META[t.kind];
          const Icon = m.icon;
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 16, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 16, scale: 0.97 }}
              transition={{ duration: 0.16 }}
              className="hum-card hum-elev-3 pointer-events-auto flex items-start gap-2.5 px-3 py-2.5 min-w-[280px] max-w-[360px]"
              style={{ borderLeft: `3px solid ${m.color}` }}
            >
              <div style={{ color: m.color }} className="mt-0.5"><Icon size={14} /></div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium text-neutral-900">{t.title}</div>
                {t.detail && <div className="text-[11.5px] hum-muted mt-0.5">{t.detail}</div>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-neutral-400 hover:text-neutral-900 mt-0.5">
                <X size={12} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
