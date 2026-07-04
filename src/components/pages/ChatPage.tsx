/**
 * 对话流（全屏）— 团队 Agent 协作上下文
 * 比 BottomFlow 更完整：左频道列表 + 中消息流 + 右当前频道任务摘要
 */
import { useMemo, useEffect, useRef, useState } from 'react';
import { Send, Paperclip, AtSign, Sparkles, Workflow, AlertCircle, Lock, Users, Scale } from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import MemberPanel from '../collab/MemberPanel';
import { useAppStore, ROLE_ACTORS } from '../../store/useAppStore';
import {
  feishuMessages, hermesNotices, collabExtraMessages, channels,
  CHANNEL_GROUPS, ROLE_CHANNEL_ACCESS, deriveChannelMembers,
} from '../../data/feishu';
import { collabTasks } from '../../data/tasks';
import { employees } from '../../data/employees';

const ROLE_COLOR: Record<string, string> = {
  human:    '#171717',
  manager:  '#0F70B7',
  worker:   '#0F766E',
  hermes:   '#7E22CE',
  guardian: '#C13D3D',
  expert:   '#525252',
};

const channelById = new Map(channels.map((c) => [c.id, c]));

export default function ChatPage() {
  const activeChannel = useAppStore((s) => s.activeChannel);
  const setActiveChannel = useAppStore((s) => s.setActiveChannel);
  const collabFeed = useAppStore((s) => s.collabFeed);
  const pendingApprovals = useAppStore((s) => s.pendingApprovals);
  const currentRole = useAppStore((s) => s.currentRole);
  const pushCollabMessage = useAppStore((s) => s.pushCollabMessage);

  const access = ROLE_CHANNEL_ACCESS[currentRole] ?? {};
  const visibleGroups = useMemo(
    () =>
      CHANNEL_GROUPS
        .map((g) => ({
          title: g.title,
          items: g.ids
            .filter((id) => (ROLE_CHANNEL_ACCESS[currentRole] ?? {})[id])
            .map((id) => channelById.get(id))
            .filter((c): c is NonNullable<typeof c> => Boolean(c)),
        }))
        .filter((g) => g.items.length > 0),
    [currentRole],
  );
  const firstVisibleId = visibleGroups[0]?.items[0]?.id;

  // 当前频道对该角色不可见时，自动回退到第一个可见频道
  useEffect(() => {
    if (!access[activeChannel] && firstVisibleId) {
      setActiveChannel(firstVisibleId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole, activeChannel, firstVisibleId]);

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

  const actor = ROLE_ACTORS[currentRole];
  const currentAccess = access[activeChannel];
  const canWrite = Boolean(currentAccess?.write);
  const [draft, setDraft] = useState('');

  // v2 · 成员推导（Grill 02 #4）：群成员来自组织结构推导，点「N 位成员」查看及各自"为什么在这个群"
  const channelMembers = useMemo(() => deriveChannelMembers(activeChannel), [activeChannel]);
  const [showMembers, setShowMembers] = useState(false);
  useEffect(() => { setShowMembers(false); }, [activeChannel]);

  // v2 · 决策①：exec 在 ch-exec 的写权限收紧为 confirm/仲裁语义
  const isExecConfirmOnly = currentRole === 'exec' && activeChannel === 'ch-exec';

  const handleSend = () => {
    const content = draft.trim();
    if (!content || !canWrite) return;
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    pushCollabMessage({
      id: `cm-${Date.now()}`,
      ts,
      channel: activeChannel,
      sender: actor.name,
      avatar: actor.avatar,
      senderRole: actor.senderRole,
      content,
      type: 'msg',
    });
    setDraft('');
  };

  const visibleChannelCount = visibleGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <WorkspacePage
      title="对话流"
      sub={`${employees.length} 位 Agent 在 ${visibleChannelCount} 个频道里协作中`}
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
        {/* Left: channel list — CHANNEL_GROUPS 顺序（责任链群置顶）+ 角色权限过滤 */}
        <div className="overflow-y-auto py-3" style={{ borderRight: '1px solid var(--border-subtle)' }}>
          {visibleGroups.map((g) => (
            <div key={g.title} className="px-3 mb-3">
              <div className="hum-eyebrow mb-1.5">{g.title}</div>
              <div className="space-y-0.5">
                {g.items.map((c) => {
                  const isActive = c.id === activeChannel;
                  const acc = access[c.id];
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
                            c.type === 'dm' ? 'var(--warning)' :
                            c.type === 'boss' || c.type === 'exec' ? '#0F70B7' :
                            'var(--success)',
                        }}
                      />
                      <span className="flex-1 text-left truncate">{c.name}</span>
                      {acc && !acc.write && (
                        <span className="text-[9px] px-1 rounded bg-neutral-100 text-neutral-500 border border-neutral-200 shrink-0">
                          只读
                        </span>
                      )}
                      {c.unread > 0 && (
                        <span className="text-[10px] font-mono bg-primary-100 text-primary-700 px-1 rounded shrink-0">
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
          <div className="relative px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <span className="font-semibold text-[14px] text-neutral-900">{currentChannel?.name}</span>
            <button
              className={`hum-chip cursor-pointer transition ${showMembers ? 'is-brand' : 'is-muted hover:bg-neutral-100'}`}
              onClick={() => setShowMembers((v) => !v)}
              title="查看群成员及各自的权限来源"
            >
              <Users size={11} /> {channelMembers.length} 位成员
            </button>
            <div className="flex items-center -space-x-1 ml-1">
              {channelMembers.slice(0, 5).map((m) => (
                <div
                  key={m.name}
                  title={m.name}
                  className="w-5 h-5 rounded-full grid place-items-center text-[9px] font-semibold text-white border-2 border-white"
                  style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}
                >
                  {m.name.slice(0, 1)}
                </div>
              ))}
            </div>
            <div className="flex-1" />
            <button className="hum-btn is-sm"><AtSign size={11} /> 拉人入群</button>
            {showMembers && (
              <MemberPanel
                channelName={currentChannel?.name ?? ''}
                members={channelMembers}
                onClose={() => setShowMembers(false)}
              />
            )}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {allMessages.map((m) => (
              <MessageRow key={m.id} m={m} />
            ))}
          </div>

          {/* Compose */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
            {isExecConfirmOnly && (
              <div
                className="mx-4 mt-2 px-3 py-1.5 rounded-md text-[11px] flex items-center gap-1.5"
                style={{ background: 'var(--warning-soft)', border: '1px solid rgba(176, 119, 6, 0.22)', color: 'var(--warning)' }}
              >
                <Scale size={11} /> 此群为分身间 A2A 协调 · 您的发言仅限确认/仲裁
              </div>
            )}
            <div className="px-4 pt-2 flex items-center gap-1.5 text-[11px] hum-muted">
              <span
                className="w-[18px] h-[18px] rounded-full grid place-items-center text-white text-[9px] font-semibold"
                style={{ background: ROLE_COLOR[actor.senderRole] ?? '#171717' }}
              >
                {actor.avatar}
              </span>
              <span>以 <span className="font-medium text-neutral-800">{actor.name}（您）</span> 身份发言</span>
              {currentAccess?.note && currentAccess.note !== '只读' && (
                <span className="hum-chip is-muted">{currentAccess.note}</span>
              )}
              {!canWrite && (
                <span className="flex items-center gap-1 text-neutral-500">
                  <Lock size={10} /> 只读频道 · 无发言权限
                </span>
              )}
            </div>
            <div className="px-4 py-3 flex items-center gap-2">
              <button className="hum-btn is-sm is-ghost" disabled={!canWrite}><Paperclip size={12} /></button>
              <button className="hum-btn is-sm is-ghost" disabled={!canWrite}><AtSign size={12} /></button>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                disabled={!canWrite}
                placeholder={
                  !canWrite ? '只读频道 · 无发言权限'
                  : isExecConfirmOnly ? '输入确认 / 打回 / 仲裁意见（日常协调由分身完成）'
                  : '给项目群发消息  ·  @员工 调度  ·  / 命令'
                }
                className="hum-input flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <button
                className="hum-btn is-sm is-primary disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!canWrite || !draft.trim()}
                onClick={handleSend}
              >
                <Send size={12} /> {isExecConfirmOnly ? '发送确认/仲裁' : '发送'}
              </button>
            </div>
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
