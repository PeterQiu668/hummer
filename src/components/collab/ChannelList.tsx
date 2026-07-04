import { Hash, AlertOctagon, Megaphone, Users } from 'lucide-react';
import { channels, feishuMessages } from '../../data/feishu';

type ChannelKind = 'project' | 'department' | 'dm' | 'system' | 'incident';

const kindMeta: Record<ChannelKind, { dot: string; icon: React.ReactNode; label: string }> = {
  project:    { dot: 'bg-primary-500',  icon: <Hash size={11} />,        label: '项目群' },
  department: { dot: 'bg-secondary-500', icon: <Users size={11} />,      label: '部门群' },
  dm:         { dot: 'bg-neutral-400',   icon: <Users size={11} />,      label: '1v1' },
  system:     { dot: 'bg-tertiary-500',  icon: <Megaphone size={11} />,  label: '系统通告' },
  incident:   { dot: 'bg-error animate-pulse', icon: <AlertOctagon size={11} />, label: '风险阻断' },
};

const groups: { kind: ChannelKind; label: string }[] = [
  { kind: 'incident',   label: '风险阻断' },
  { kind: 'project',    label: '项目群' },
  { kind: 'department', label: '部门群' },
  { kind: 'system',     label: '系统通告' },
  { kind: 'dm',         label: '1v1' },
];

function latestSnippet(channelId: string) {
  const msgs = feishuMessages.filter((m) => m.channel === channelId);
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
  extraChannels?: { id: string; name: string; unread: number; type: string; members?: number }[];
}) {
  const all = [...channels, ...extraChannels];

  // Coerce data type to known kinds (fallback to project)
  const withKind = all.map((c) => ({
    ...c,
    kind: ((['project', 'department', 'dm', 'system', 'incident'] as const).includes(
      c.type as ChannelKind,
    )
      ? c.type
      : 'project') as ChannelKind,
  }));

  return (
    <div className="h-full w-full flex flex-col bg-white border-r border-neutral-200">
      <div className="px-3 py-2 border-b border-neutral-200 flex items-center justify-between">
        <span className="font-display text-xs font-semibold text-neutral-800">协作频道</span>
        <span className="text-[10px] font-mono text-neutral-400">{withKind.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {groups.map((g) => {
          const items = withKind.filter((c) => c.kind === g.kind);
          if (items.length === 0) return null;
          return (
            <div key={g.kind} className="mb-1">
              <div className="px-3 py-1 text-[9px] font-mono uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                {kindMeta[g.kind].icon}
                {g.label}
              </div>
              {items.map((c) => {
                const active = c.id === activeChannel;
                const meta = kindMeta[c.kind];
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
