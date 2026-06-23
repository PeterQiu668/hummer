import { useEffect, useRef } from 'react';
import { AtSign, Paperclip, Send, AlertTriangle, Sparkles, Workflow, FileText } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { feishuMessages, channels } from '../../data/feishu';

export default function BottomFlow() {
  const { setShowMeeting } = useAppStore();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, []);

  return (
    <div className="absolute left-64 right-80 bottom-0 h-72 z-20 glass-strong border-t border-neon-cyan/20 flex">
      <div className="w-44 border-r border-neon-cyan/10 p-2 space-y-0.5">
        <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/50 px-2 pb-1">协作群</div>
        {channels.map((c, i) => (
          <button
            key={c.id}
            className={`w-full text-left px-2 py-1 rounded-sm text-[11px] flex items-center gap-2 transition
              ${i === 0 ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-slate-300 hover:bg-white/5'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full
              ${c.type === 'incident' ? 'bg-neon-red animate-pulse'
                : c.type === 'system' ? 'bg-neon-magenta'
                : 'bg-neon-green'}`} />
            <span className="flex-1 truncate">{c.name}</span>
            {c.unread > 0 && <span className="text-[9px] font-mono text-neon-magenta">{c.unread}</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col">
        <div className="px-3 py-2 border-b border-neon-cyan/10 flex items-center gap-2">
          <span className="font-display text-sm neon-text">#Q3增长策略</span>
          <span className="chip-cyan">6 成员 · 2 Manager · 4 Worker</span>
          <div className="flex-1" />
          <button onClick={() => setShowMeeting(true)} className="btn-neon">
            <Workflow size={12} /> 拉入会议室
          </button>
        </div>

        <div ref={scroller} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {feishuMessages.map((m) => (
            <MessageRow key={m.id} m={m} />
          ))}
        </div>

        <div className="px-3 py-2 border-t border-neon-cyan/10 flex items-center gap-2">
          <button className="text-slate-400 hover:text-neon-cyan"><AtSign size={14} /></button>
          <button className="text-slate-400 hover:text-neon-cyan"><Paperclip size={14} /></button>
          <input
            placeholder="给项目群发消息  ·  @员工调度 · /命令"
            className="flex-1 bg-white/5 border border-neon-cyan/15 rounded-sm px-3 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-neon-cyan/40"
          />
          <button className="btn-neon"><Send size={12} /> 发送</button>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ m }: { m: ReturnType<typeof channels.find> extends infer _ ? any : never }) {
  const roleColor: Record<string, string> = {
    human: 'from-neon-purple to-neon-magenta text-white',
    manager: 'from-neon-cyan to-neon-purple text-white',
    worker: 'from-neon-green to-neon-cyan text-ink-900',
    hermes: 'from-neon-magenta to-neon-amber text-ink-900',
    guardian: 'from-neon-red to-neon-amber text-ink-900',
  };
  const typeIcon: Record<string, React.ReactNode> = {
    alert: <AlertTriangle size={12} className="text-neon-red" />,
    evolution: <Sparkles size={12} className="text-neon-magenta" />,
    task: <Workflow size={12} className="text-neon-cyan" />,
    approval: <FileText size={12} className="text-neon-amber" />,
    mention: <AtSign size={12} className="text-neon-cyan" />,
    msg: null,
  };
  return (
    <div className="flex gap-2 group">
      <div className={`shrink-0 w-7 h-7 rounded-sm bg-gradient-to-br ${roleColor[m.senderRole]} flex items-center justify-center font-display font-bold text-xs shadow-neon-cyan`}>
        {m.avatar}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-display text-slate-200">{m.sender}</span>
          <span className="text-[9px] font-mono text-slate-500">{m.ts}</span>
          {typeIcon[m.type]}
          {m.senderRole === 'guardian' && <span className="chip-red">EXEC-GUARDIAN</span>}
          {m.senderRole === 'hermes' && <span className="chip-magenta">HERMES</span>}
        </div>
        <div className={`mt-0.5 text-[12px] leading-relaxed
          ${m.type === 'alert' ? 'text-neon-red' : m.type === 'evolution' ? 'text-neon-magenta/90' : 'text-slate-200'}`}>
          {m.content}
        </div>
        {m.attachments && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.attachments.map((a: any) => (
              <span key={a.name} className="chip-cyan"><FileText size={10} /> {a.name}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
