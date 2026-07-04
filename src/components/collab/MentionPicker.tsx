import { useMemo } from 'react';
import { AtSign } from 'lucide-react';
import { employees } from '../../data/employees';
import type { ZoneId } from '../../lib/types';

const zoneLabel: Record<ZoneId, string> = {
  boss: '决策中心',
  business: '业务办公区',
  support: '支撑办公区',
  meeting: '会议室',
  rest: '休息区',
  learn: '学习区',
};

export default function MentionPicker({
  query,
  onPick,
}: {
  query: string;
  onPick: (handle: string) => void;
}) {
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = employees.filter(
      (e) =>
        !q ||
        e.name.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        e.avatar.toLowerCase().includes(q),
    );
    const map = new Map<ZoneId, typeof employees>();
    for (const e of filtered) {
      const arr = map.get(e.zone) || [];
      arr.push(e);
      map.set(e.zone, arr);
    }
    return [...map.entries()];
  }, [query]);

  return (
    <div className="absolute bottom-full left-2 mb-1 w-72 max-h-72 overflow-y-auto bg-white border border-neutral-200 rounded-md shadow-medium z-30">
      <div className="px-3 py-1.5 border-b border-neutral-100 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
        <AtSign size={11} /> 提及员工 · {query ? `搜索「${query}」` : '按 zone 分组'}
      </div>
      {grouped.length === 0 && (
        <div className="px-3 py-4 text-center text-[11px] text-neutral-400">无匹配员工</div>
      )}
      {grouped.map(([zone, list]) => (
        <div key={zone}>
          <div className="px-3 py-1 text-[9px] font-mono uppercase tracking-wider text-neutral-400 bg-neutral-50">
            {zoneLabel[zone]}
          </div>
          {list.map((e) => (
            <button
              key={e.id}
              onClick={() => onPick(`@${e.name}`)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-primary-50 transition text-left"
            >
              <span className="w-6 h-6 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 text-white text-[11px] font-display font-semibold flex items-center justify-center">
                {e.avatar}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-neutral-800 truncate">{e.name}</div>
                <div className="text-[10px] text-neutral-500 truncate">{e.role}</div>
              </div>
              <span className="text-[9px] font-mono text-neutral-400">{e.id}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
