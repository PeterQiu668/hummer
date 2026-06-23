import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { X, Mic, ScreenShare, FileText, Users2, Clock } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';

const initialNotes = [
  '【议程 1】销售：建议针对华东 23 家大客户做 BD + 高管拜访，预计转化 4-6 单',
  '【议程 2】运营：减少抖音泛流量 30%，增配视频号 + LinkedIn B2B，ROI 预估 1.4 → 1.9',
  '【议程 3】财务：原 138w 调拨流程改走审批单，预算上限上调至 200w',
  '【行动项】销售：本周内出 BD 邮件清单 + 报价单',
  '【行动项】运营：周一开始投放调整 + 数据回收',
];

export default function MeetingRoom() {
  const { setShowMeeting } = useAppStore();
  const attendees = employees.filter((e) =>
    ['emp-ceo', 'emp-sales-1', 'emp-ops', 'emp-finance', 'emp-meeting-1', 'emp-doc'].includes(e.id),
  );
  const [notes, setNotes] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (notes.length >= initialNotes.length) return;
    const t = setTimeout(() => setNotes((n) => [...n, initialNotes[n.length]]), 1100);
    return () => clearTimeout(t);
  }, [notes]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 bg-ink-900/85 backdrop-blur-md flex items-center justify-center"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="m-6 w-[1100px] max-w-[94vw] h-[680px] max-h-[88vh] glass-strong rounded-sm relative hud-corner flex flex-col overflow-hidden"
      >
        <div className="px-5 py-3 border-b border-neon-magenta/30 flex items-center gap-3 bg-gradient-to-r from-neon-magenta/10 to-transparent">
          <div className="w-9 h-9 rounded-sm bg-neon-magenta/15 border border-neon-magenta/50 flex items-center justify-center">
            <Users2 size={16} className="text-neon-magenta" />
          </div>
          <div>
            <div className="font-display text-lg neon-text-magenta">会议室 · 青莲</div>
            <div className="text-[11px] font-mono text-neon-magenta/70">Q3 增长策略评审会 · {attendees.length} 位 Agent 参会</div>
          </div>
          <div className="flex-1" />
          <span className="chip-magenta"><Clock size={10} /> {String(Math.floor(tick / 60)).padStart(2, '0')}:{String(tick % 60).padStart(2, '0')}</span>
          <button onClick={() => setShowMeeting(false)} className="text-slate-400 hover:text-neon-cyan">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
          {/* Attendee grid */}
          <div className="col-span-12 md:col-span-7 grid grid-cols-3 gap-2 content-start">
            {attendees.map((a, i) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
                className="aspect-video glass rounded-sm relative border border-neon-cyan/20 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900 grid-bg opacity-60" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div
                    animate={{ y: [0, -3, 0] }}
                    transition={{ duration: 2 + i * 0.2, repeat: Infinity }}
                    className="w-12 h-12 rounded-full bg-gradient-to-br from-neon-cyan/30 to-neon-magenta/30 border-2 border-neon-cyan/50 flex items-center justify-center font-display font-black text-lg neon-text"
                  >
                    {a.avatar}
                  </motion.div>
                </div>
                <div className="absolute top-1 left-1 chip-cyan">{a.name}</div>
                <div className="absolute bottom-1 left-1 right-1 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${i % 3 === 0 ? 'bg-neon-green animate-pulse' : 'bg-slate-500'}`} />
                  <span className="text-[9px] font-mono text-slate-300 flex-1">{a.role}</span>
                  {i % 3 === 0 && <Mic size={9} className="text-neon-green" />}
                </div>
              </motion.div>
            ))}

            {/* Empty seat */}
            <div className="aspect-video border-2 border-dashed border-neon-cyan/20 rounded-sm flex items-center justify-center text-[10px] font-mono text-neon-cyan/40">
              <span>+ 拉入员工</span>
            </div>
          </div>

          {/* Realtime minutes */}
          <div className="col-span-12 md:col-span-5 glass rounded-sm relative hud-corner flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-neon-cyan/10 flex items-center gap-2">
              <FileText size={12} className="text-neon-green" />
              <div className="text-[11px] font-display tracking-widest text-neon-cyan flex-1">实时纪要 · Agent 主持</div>
              <span className="text-[10px] font-mono text-neon-green animate-pulse">● 录制中</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {notes.map((n, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="glass rounded-sm p-2 text-xs text-slate-200 border-l-2 border-neon-cyan/40"
                >
                  {n}
                </motion.div>
              ))}
              <div className="text-[10px] font-mono text-neon-cyan/50 italic">▋ 持续记录中…</div>
            </div>
            <div className="px-3 py-2 border-t border-neon-cyan/10 flex items-center gap-2">
              <button className="btn-neon flex-1 justify-center"><ScreenShare size={11} /> 共享白板</button>
              <button className="btn-neon-magenta flex-1 justify-center"><FileText size={11} /> 发布纪要</button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
