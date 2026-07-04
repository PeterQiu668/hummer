/**
 * 对话流（全屏）— 团队 Agent 协作上下文
 * 比 BottomFlow 更完整：左频道列表 + 中消息流 + 右当前频道任务摘要
 */
import { useMemo, useEffect, useRef } from 'react';
import { Send, Paperclip, AtSign, Sparkles, Workflow, AlertCircle } from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import { useAppStore } from '../../store/useAppStore';
import { feishuMessages, hermesNotices, collabExtraMessages, channels } from '../../data/feishu';
import { collabTasks } from '../../data/tasks';
import { employees } from '../../data/employees';

const ROLE_COLOR: Record<string, string> = {
  human:    '#171717',
  manager:  '#0F70B7',
  worker:   '#0F766E',
  hermes:   '#7E22CE',
  guardian: '#C13D3D',
};

export default function ChatPage() {
  const activeChannel = useAppStore((s) => s.activeChannel);
  const setActiveChannel = useAppStore((s) => s.setActiveChannel);
  const collabFeed = useAppStore((s) => s.collabFeed);
  const pendingApprovals = useAppStore((s) => s.pendingApprovals);

  const allMessages = useMemo(() => {
    const base = [
      ...feishuMessages,
      ...hermesNotices,
      ...collabExtraMessages,
      ...collabFeed,
    ] as any[];
    return base
      .filter((m) => m.channel === activeChannel)
      .sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));
  }, [activeChannel, collabFeed]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [allMessages.length]);

  const currentChannel = channels.find((c) => c.id === activeChannel);
  const channelTasks = collabTasks.filter((t) => t.channel === activeChannel);

  return (
    <WorkspacePage
      title="对话流"
      sub={`${employees.length} 位 Agent 在 ${channels.length} 个频道里协作中`}
      actions={
        <>
          {pendingApprovals > 0 && (
            <span className="hum-chip is-error hum-pulse">
              <AlertCircle size={11} /> {pendingApprovals} 个高危待审批
            </span>
          )}
        </>
      }
    >
      <div className="h-full grid grid-cols-[220px_1fr_280px] bg-white">
        {/* Left: channel list */}
        <div className="overflow-y-auto py-3" style={{ borderRight: '1px solid var(--border-subtle)' }}>
          {[
            { title: '项目群', kinds: ['project'] },
            { title: '系统通告', kinds: ['system'] },
            { title: '风险通道', kinds: ['incident'] },
          ].map((sec) => (
            <div key={sec.title} className="px-3 mb-3">
              <div className="hum-eyebrow mb-1.5">{sec.title}</div>
              <div className="space-y-0.5">
                {channels.filter((c) => sec.kinds.includes(c.type)).map((c) => {
                  const isActive = c.id === activeChannel;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveChannel(c.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] transition ${
                        isActive ? 'bg-neutral-100 text-neutral-900 font-medium' : 'text-neutral-600 hover:bg-neutral-50'
                      }`}
                    >
                      <span
                        className="hum-dot"
                        style={{
                          background:
                            c.type === 'incident' ? 'var(--error)' :
                            c.type === 'system' ? '#7E22CE' :
                            'var(--success)',
                        }}
                      />
                      <span className="flex-1 text-left truncate">{c.name}</span>
                      {c.unread > 0 && (
                        <span className="text-[10px] font-mono bg-primary-100 text-primary-700 px-1 rounded">
                          {c.unread}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Center: messages */}
        <div className="flex flex-col min-w-0">
          {/* Header */}
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <span className="font-semibold text-[14px] text-neutral-900">{currentChannel?.name}</span>
            <span className="hum-chip is-muted">{currentChannel?.members ?? 0} 成员</span>
            <div className="flex items-center -space-x-1 ml-1">
              {employees.slice(0, 5).map((e) => (
                <div
                  key={e.id}
                  title={e.name}
                  className="w-5 h-5 rounded-full grid place-items-center text-[9px] font-semibold text-white border-2 border-white"
                  style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}
                >
                  {e.avatar}
                </div>
              ))}
            </div>
            <div className="flex-1" />
            <button className="hum-btn is-sm"><AtSign size={11} /> 拉人入群</button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {allMessages.map((m) => (
              <MessageRow key={m.id} m={m} />
            ))}
          </div>

          {/* Compose */}
          <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <button className="hum-btn is-sm is-ghost"><Paperclip size={12} /></button>
            <button className="hum-btn is-sm is-ghost"><AtSign size={12} /></button>
            <input
              placeholder="给项目群发消息  ·  @员工 调度  ·  / 命令"
              className="hum-input flex-1"
            />
            <button className="hum-btn is-sm is-primary"><Send size={12} /> 发送</button>
          </div>
        </div>

        {/* Right: tasks of this channel */}
        <div className="overflow-y-auto p-3" style={{ borderLeft: '1px solid var(--border-subtle)' }}>
          <div className="hum-eyebrow mb-2">本频道任务（{channelTasks.length}）</div>
          <div className="space-y-2">
            {channelTasks.map((t) => (
              <div key={t.id} className="hum-card-soft p-2.5">
                <div className="text-[12.5px] font-medium text-neutral-900 leading-snug">{t.title}</div>
                <div className="text-[11px] hum-muted mt-1 line-clamp-2">{t.goal}</div>
                <div className="mt-2 h-1 rounded-full bg-neutral-100 overflow-hidden">
                  <div className="h-full bg-primary-500 rounded-full" style={{ width: `${t.progress}%` }} />
                </div>
              </div>
            ))}
            {channelTasks.length === 0 && (
              <div className="text-[11px] hum-faint text-center py-4 italic">本频道暂无任务</div>
            )}
          </div>
        </div>
      </div>
    </WorkspacePage>
  );
}

function MessageRow({ m }: { m: any }) {
  const color = ROLE_COLOR[m.senderRole] ?? '#6B6B65';
  const typeIcon =
    m.type === 'alert' ? <AlertCircle size={11} className="text-error" /> :
    m.type === 'evolution' ? <Sparkles size={11} className="text-secondary-600" /> :
    m.type === 'task' ? <Workflow size={11} className="text-primary-600" /> :
    null;
  return (
    <div className="flex gap-2.5">
      <div
        className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-semibold shrink-0"
        style={{ background: color }}
      >
        {m.avatar}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-semibold text-neutral-900">{m.sender}</span>
          <span className="text-[10px] hum-faint font-mono">{m.ts}</span>
          {typeIcon}
        </div>
        <div
          className={`mt-0.5 text-[12.5px] leading-relaxed ${
            m.type === 'alert' ? 'text-error' :
            m.type === 'evolution' ? 'text-secondary-700' :
            'text-neutral-700'
          }`}
        >
          {m.content}
        </div>
        {m.attachments && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.attachments.map((a: any) => (
              <span key={a.name} className="hum-chip">{a.name}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
