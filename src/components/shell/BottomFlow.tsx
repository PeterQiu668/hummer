import { useMemo, useState } from 'react';
import {
  AtSign,
  Send,
  AlertTriangle,
  Workflow,
  UserPlus,
  Sparkles,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { feishuMessages, hermesNotices, collabExtraMessages, channels } from '../../data/feishu';
import { collabTasks } from '../../data/tasks';
import { employees } from '../../data/employees';
import type { FeishuMessage, CollabTask } from '../../lib/types';
import ChannelList from '../collab/ChannelList';
import MessageStream from '../collab/MessageStream';
import MentionPicker from '../collab/MentionPicker';
import RiskAlertModal from '../collab/RiskAlertModal';
import TaskCard from '../collab/TaskCard';

type AnyMsg = FeishuMessage & {
  taskCard?: CollabTask;
  riskAlertId?: string;
  toolCall?: { tool: string; args: string };
};

const extraChannels = [
  { id: 'ch-dept-finance', name: '#部门·财务', unread: 0, type: 'department', members: 4 },
  { id: 'ch-dm-lin',       name: '林·决策官', unread: 1, type: 'dm',         members: 2 },
];

export default function BottomFlow() {
  const setShowMeeting = useAppStore((s) => s.setShowMeeting);
  const activeChannel = useAppStore((s) => s.activeChannel);
  const setActiveChannel = useAppStore((s) => s.setActiveChannel);
  const riskAlerts = useAppStore((s) => s.riskAlerts);
  const pendingApprovals = useAppStore((s) => s.pendingApprovals);
  const approveAlert = useAppStore((s) => s.approveAlert);
  const dismissAlert = useAppStore((s) => s.dismissAlert);
  const collabFeed = useAppStore((s) => s.collabFeed);
  const pushCollabMessage = useAppStore((s) => s.pushCollabMessage);

  const [draft, setDraft] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [openAlertId, setOpenAlertId] = useState<string | null>(null);

  // First pending alert auto-opens via the banner click; we also let user click banner.
  const firstPendingAlert = useMemo(
    () => riskAlerts.find((a) => a.status === 'pending') ?? null,
    [riskAlerts],
  );
  const openAlert = openAlertId
    ? riskAlerts.find((a) => a.id === openAlertId) ?? null
    : null;

  // Merge feishuMessages + hermesNotices + collab extras + dynamic store feed for active channel.
  const messages: AnyMsg[] = useMemo(() => {
    const base: AnyMsg[] = [
      ...feishuMessages,
      ...hermesNotices,
      ...collabExtraMessages,
      ...collabFeed.map((c) => ({
        id: c.id,
        ts: c.ts,
        channel: c.channel,
        sender: c.sender,
        senderRole: c.senderRole,
        avatar: c.avatar,
        content: c.content,
        type: c.type,
      })),
    ];
    // Wire alert messages to their RiskAlert id (heuristic match by channel + role + keyword).
    const enriched = base.map<AnyMsg>((m) => {
      if (m.type === 'alert' && m.senderRole === 'guardian') {
        const match = riskAlerts.find(
          (a) => a.channel === m.channel && a.status === 'pending',
        );
        if (match) return { ...m, riskAlertId: match.id };
      }
      // Attach a task card to msg about the BD task (m2) for richer demo
      if (m.id === 'm2') {
        return { ...m, taskCard: collabTasks.find((t) => t.id === 'tk-sales-q3') };
      }
      if (m.id === 'm9') {
        return { ...m, taskCard: collabTasks.find((t) => t.id === 'tk-legal-review') };
      }
      return m;
    });
    return enriched
      .filter((m) => m.channel === activeChannel)
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }, [activeChannel, collabFeed, riskAlerts]);

  // Channel meta for the header
  const allChannels = [...channels, ...extraChannels];
  const currentChannel = allChannels.find((c) => c.id === activeChannel) ?? channels[0];

  // Pick a sample of online members (visualization)
  const onlineMembers = employees.slice(0, 6);

  // Right-side task summary for active channel
  const channelTasks = collabTasks.filter((t) => t.channel === activeChannel);

  const handleInput = (v: string) => {
    setDraft(v);
    // detect last @ token
    const at = v.lastIndexOf('@');
    if (at >= 0) {
      const token = v.slice(at + 1);
      if (!token.includes(' ')) {
        setMentionOpen(true);
        setMentionQuery(token);
        return;
      }
    }
    setMentionOpen(false);
  };

  const pickMention = (handle: string) => {
    const at = draft.lastIndexOf('@');
    const next = (at >= 0 ? draft.slice(0, at) : draft) + handle + ' ';
    setDraft(next);
    setMentionOpen(false);
  };

  const send = () => {
    const v = draft.trim();
    if (!v) return;
    pushCollabMessage({
      id: `u-${Date.now()}`,
      ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5),
      channel: activeChannel,
      sender: '昆仑（您）',
      avatar: '昆',
      senderRole: 'human',
      content: v,
      type: v.includes('@') ? 'mention' : 'msg',
    });
    setDraft('');
  };

  return (
    <div className="absolute left-64 right-80 bottom-0 h-72 z-20 glass-strong border-t border-neutral-200 flex flex-col">
      {/* Banner */}
      {pendingApprovals > 0 && (
        <button
          onClick={() => firstPendingAlert && setOpenAlertId(firstPendingAlert.id)}
          className="w-full px-3 py-1.5 bg-error/10 border-b border-error/30 text-error flex items-center justify-center gap-2 text-[11px] font-medium hover:bg-error/15 transition group"
        >
          <AlertTriangle size={13} className="animate-pulse" />
          <span>
            注意 · {pendingApprovals} 个高危待审批
            {firstPendingAlert && ` · ${firstPendingAlert.agent} → ${firstPendingAlert.action}`}
          </span>
          <span className="opacity-60 group-hover:opacity-100 transition text-[10px] font-mono">
            点击审阅 →
          </span>
        </button>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Left: ChannelList */}
        <div className="w-[200px] shrink-0">
          <ChannelList
            activeChannel={activeChannel}
            onSelect={setActiveChannel}
            extraChannels={extraChannels}
          />
        </div>

        {/* Center: header + stream + reply */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-3 py-2 border-b border-neutral-200 flex items-center gap-2 bg-white">
            <span className="font-display text-sm font-semibold text-neutral-900">
              {currentChannel.name}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-neutral-200 text-neutral-600 bg-neutral-50">
              {currentChannel.members ?? 0} 成员
            </span>
            <div className="flex -space-x-1.5 ml-1">
              {onlineMembers.map((e) => (
                <span
                  key={e.id}
                  title={`${e.name} · 在线`}
                  className="w-5 h-5 rounded-full bg-primary-500 text-white text-[10px] font-display font-semibold flex items-center justify-center border-2 border-white"
                >
                  {e.avatar}
                </span>
              ))}
            </div>
            <div className="flex-1" />
            <button type="button" onClick={() => { setMentionOpen(true); setMentionQuery(''); setDraft((value) => `${value}${value && !value.endsWith(' ') ? ' ' : ''}@`); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-primary-200 text-primary-700 bg-white hover:bg-primary-50 text-[11px] transition">
              <UserPlus size={11} /> 拉人入群
            </button>
            <button
              onClick={() => setShowMeeting(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-secondary-200 text-secondary-700 bg-white hover:bg-secondary-50 text-[11px] transition"
            >
              <Workflow size={11} /> 拉入会议室
            </button>
          </div>

          {/* Stream */}
          <MessageStream messages={messages} onRiskClick={(id) => setOpenAlertId(id)} />

          {/* Reply */}
          <div className="relative px-3 py-2 border-t border-neutral-200 flex items-center gap-2 bg-white">
            <button
              onClick={() => {
                setMentionOpen(true);
                setMentionQuery('');
                setDraft((d) => (d.endsWith('@') ? d : d + '@'));
              }}
              className="text-neutral-500 hover:text-primary-600 transition"
            >
              <AtSign size={14} />
            </button>
            <input
              value={draft}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
                if (e.key === 'Escape') setMentionOpen(false);
              }}
              placeholder="给频道发消息  ·  输入 @ 召唤员工 · / 触发命令"
              className="flex-1 bg-neutral-50 border border-neutral-200 rounded-md px-3 py-1.5 text-[12px] text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-primary-400 focus:bg-white"
            />
            <button
              onClick={send}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary-500 text-white hover:bg-primary-600 text-[11px] font-medium transition"
            >
              <Send size={11} /> 发送
            </button>

            {mentionOpen && (
              <MentionPicker query={mentionQuery} onPick={pickMention} />
            )}
          </div>
        </div>

        {/* Right: task summary */}
        <div className="w-[240px] shrink-0 border-l border-neutral-200 bg-white flex flex-col">
          <div className="px-3 py-2 border-b border-neutral-200 flex items-center justify-between">
            <span className="font-display text-xs font-semibold text-neutral-800">频道任务</span>
            <span className="text-[10px] font-mono text-neutral-400">{channelTasks.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {channelTasks.length === 0 ? (
              <div className="px-2 py-4 text-center text-[11px] text-neutral-400 flex flex-col items-center gap-1">
                <Sparkles size={14} />
                <span>当前频道暂无任务</span>
              </div>
            ) : (
              channelTasks.map((t) => <TaskCard key={t.id} task={t} compact />)
            )}
          </div>
        </div>
      </div>

      {openAlert && (
        <RiskAlertModal
          alert={openAlert}
          onClose={() => setOpenAlertId(null)}
          onApprove={() => {
            approveAlert(openAlert.id, 'approve');
            setOpenAlertId(null);
          }}
          onReject={() => {
            approveAlert(openAlert.id, 'reject');
            setOpenAlertId(null);
          }}
          onSafer={() => {
            approveAlert(openAlert.id, 'reject', '改为更安全方式');
            setOpenAlertId(null);
          }}
        />
      )}

      {/* Suppress unused-variable lint for dismissAlert (kept on store contract) */}
      <span className="hidden">{dismissAlert.name}</span>
    </div>
  );
}
