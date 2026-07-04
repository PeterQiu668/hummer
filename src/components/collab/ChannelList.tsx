import type { ReactNode } from 'react';
import { Hash, AlertOctagon, Megaphone, Crown, MessagesSquare } from 'lucide-react';
import { channels, feishuMessages, collabExtraMessages, CHANNEL_GROUPS } from '../../data/feishu';

type ChannelItem = { id: string; name: string; unread: number; type: string; members?: number };

// 分组视觉：责任链群用皇冠区分，分身管理用 dm 图标，其余沿用原有小圆点/图标风格
const GROUP_META: Record<string, { dot: string; icon: ReactNode }> = {
  '责任链群':   { dot: 'bg-secondary-500',        icon: <Crown size={11} /> },
  '分身管理':   { dot: 'bg-warning',              icon: <MessagesSquare size={11} /> },
  '业务作战群': { dot: 'bg-primary-500',          icon: <Hash size={11} /> },
  '风险通道':   { dot: 'bg-error animate-pulse',  icon: <AlertOctagon size={11} /> },
  '系统通告':   { dot: 'bg-tertiary-500',         icon: <Megaphone size={11} /> },
};
const FALLBACK_META = { dot: 'bg-neutral-400', icon: <Hash size={11} /> };

function latestSnippet(channelId: string) {
  const msgs = [...feishuMessages, ...collabExtraMessages].filter((m) => m.channel === channelId);
  const last = msgs[msgs.length - 1];
  return last ? last.content.slice(0, 26) : '暂无消息';
}

export default function ChannelList({
  activeChannel,
  onSelect,
  extraChannels = [],
}: {
  activeChannel: string;
  onSelect: (id: string) => void;
  extraChannels?: ChannelItem[];
}) {
  const byId = new Map<string, ChannelItem>(channels.map((c) => [c.id, c]));
  const groupedIds = new Set(CHANNEL_GROUPS.flatMap((g) => g.ids));

  // 按 CHANNEL_GROUPS 渲染；extraChannels（未在任何分组中的）归入「业务作战群」尾部
  const groups = CHANNEL_GROUPS.map((g) => {
    const items = g.ids
      .map((id) => byId.get(id))
      .filter((c): c is ChannelItem => Boolean(c));
    if (g.title === '业务作战群') {
      items.push(...extraChannels.filter((c) => !groupedIds.has(c.id)));
    }
    return { title: g.title, items };
  }).filter((g) => g.items.length > 0);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="h-full w-full flex flex-col bg-white border-r border-neutral-200">
      <div className="px-3 py-2 border-b border-neutral-200 flex items-center justify-between">
        <span className="font-display text-xs font-semibold text-neutral-800">协作频道</span>
        <span className="text-[10px] font-mono text-neutral-400">{total}</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {groups.map((g) => {
          const meta = GROUP_META[g.title] ?? FALLBACK_META;
          return (
            <div key={g.title} className="mb-1">
              <div className="px-3 py-1 text-[9px] font-mono uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                {meta.icon}
                {g.title}
              </div>
              {g.items.map((c) => {
                const active = c.id === activeChannel;
                return (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c.id)}
                    className={`w-full text-left px-3 py-1.5 flex items-start gap-2 transition border-l-2 ${
                      active
                        ? 'bg-primary-50 border-primary-500'
                        : 'border-transparent hover:bg-neutral-50'
                    }`}
                  >
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[12px] font-medium truncate ${
                            active ? 'text-primary-700' : 'text-neutral-800'
                          }`}
                        >
                          {c.name}
                        </span>
                        {c.unread > 0 && (
                          <span className="text-[9px] font-mono px-1 rounded bg-error text-white shrink-0">
                            {c.unread}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-neutral-500 truncate">
                        {latestSnippet(c.id)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
