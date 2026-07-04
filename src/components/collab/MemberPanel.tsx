/**
 * 群成员面板 — Grill 02 待实现清单 #4 + 决策③「静态透明、动态沉默」
 * 按 kind 分组列出 deriveChannelMembers 推导结果，每人展示身份徽标 + 「为什么我在这个群」。
 * 老板条目如实显示（谁有权看永远可查），但永不显示「正在查看/已读」等动态状态。
 */
import { X, BellOff, ShieldCheck } from 'lucide-react';
import type { ChannelMember } from '../../data/feishu';

const KIND_META: Record<ChannelMember['kind'], { label: string; color: string; order: number }> = {
  boss:         { label: '老板',     color: '#171717', order: 0 },
  'boss-twin':  { label: '老板分身', color: '#7E22CE', order: 1 },
  'exec-twin':  { label: '高管分身', color: '#0F70B7', order: 2 },
  'human-exec': { label: '真人高管', color: '#B07706', order: 3 },
  agent:        { label: '数字员工', color: '#0F766E', order: 4 },
  'human-staff':{ label: '一线真人', color: '#525252', order: 5 },
  guardian:     { label: '守护者',   color: '#C13D3D', order: 6 },
  hermes:       { label: '系统',     color: '#7E22CE', order: 7 },
  expert:       { label: '外部专家', color: '#525252', order: 8 },
};

export default function MemberPanel({
  channelName,
  members,
  onClose,
}: {
  channelName: string;
  members: ChannelMember[];
  onClose: () => void;
}) {
  const groups = Object.entries(
    members.reduce<Record<string, ChannelMember[]>>((acc, m) => {
      const next = { ...acc };
      next[m.kind] = [...(next[m.kind] ?? []), m];
      return next;
    }, {}),
  ).sort(([a], [b]) => KIND_META[a as ChannelMember['kind']].order - KIND_META[b as ChannelMember['kind']].order);

  return (
    <div
      className="absolute right-0 top-full mt-1.5 w-[320px] max-h-[440px] flex flex-col bg-white rounded-lg z-20 overflow-hidden"
      style={{ border: '1px solid var(--border-subtle)', boxShadow: '0 8px 28px rgba(0,0,0,0.10)' }}
    >
      <div className="px-3 py-2 flex items-center gap-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-[12px] font-semibold text-neutral-900 truncate">{channelName}</span>
        <span className="hum-chip is-muted">{members.length} 位成员</span>
        <div className="flex-1" />
        <button className="hum-btn is-sm is-ghost" onClick={onClose} aria-label="关闭成员面板">
          <X size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map(([kind, list]) => {
          const meta = KIND_META[kind as ChannelMember['kind']];
          return (
            <div key={kind} className="mb-2.5">
              <div className="hum-eyebrow mb-1">{meta.label}（{list.length}）</div>
              <div className="space-y-1.5">
                {list.map((m) => (
                  <div key={m.name} className="flex gap-2 items-start">
                    <span
                      className="w-6 h-6 rounded-full grid place-items-center text-white text-[10px] font-semibold shrink-0 mt-0.5"
                      style={{ background: meta.color }}
                    >
                      {m.name.slice(0, 1)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12px] font-medium text-neutral-900">{m.name}</span>
                        <span
                          className="text-[9px] px-1 rounded border shrink-0"
                          style={{ color: meta.color, borderColor: `${meta.color}44`, background: `${meta.color}0D` }}
                        >
                          {meta.label}
                        </span>
                        {m.muted && (
                          <span className="text-[9px] px-1 rounded bg-neutral-100 text-neutral-500 border border-neutral-200 inline-flex items-center gap-0.5 shrink-0">
                            <BellOff size={8} /> 免打扰 · 仅合规可见
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] hum-muted leading-snug mt-0.5">{m.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="px-3 py-1.5 text-[10px] hum-faint flex items-center gap-1 shrink-0"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <ShieldCheck size={10} />
        静态透明 · 动态沉默 — 成员名单永远可查，永不显示「正在查看 / 已读」
      </div>
    </div>
  );
}
