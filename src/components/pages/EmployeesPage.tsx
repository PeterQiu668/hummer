/**
 * 我的员工 — 组织架构（按部门 zone 分组）
 */
import { useMemo, useState, useEffect } from 'react';
import { Plus, Filter, Search, Pause, Play, Shield, ListFilter, Sparkles, BadgeCheck } from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import { employees } from '../../data/employees';
import { marketEmployees } from '../../data/marketplace';
import { useAppStore } from '../../store/useAppStore';
import type { ZoneId } from '../../lib/types';
import AgentAvatar from '../ui/AgentAvatar';

const ZONE_META: Record<ZoneId, { label: string; sub: string; color: string }> = {
  boss:     { label: '决策中心',       sub: 'Boss Office',        color: '#7E22CE' },
  business: { label: '业务办公区',     sub: 'Business Floor',     color: '#0F70B7' },
  support:  { label: '行政支持中心',   sub: 'Public Office Zone', color: '#0F766E' },
  meeting:  { label: '项目会议室',     sub: 'Conference Hub',     color: '#9333EA' },
  rest:     { label: '休息区',         sub: 'Lounge',             color: '#B07706' },
  learn:    { label: '进化训练区',     sub: 'Learning',           color: '#1E8F5C' },
};

const STATUS_META: Record<string, { label: string; chip: string }> = {
  working:  { label: '工作中',  chip: 'hum-chip is-brand' },
  blocked:  { label: '已阻断',  chip: 'hum-chip is-error' },
  meeting:  { label: '会议中',  chip: 'hum-chip is-warning' },
  training: { label: '训练中',  chip: 'hum-chip' },
  idle:     { label: '待命',    chip: 'hum-chip is-muted' },
};

export default function EmployeesPage() {
  const [q, setQ] = useState('');
  const [zoneFilter, setZoneFilter] = useState<ZoneId | 'all'>('all');
  const setSelectedEmployee = useAppStore((s) => s.setSelectedEmployee);
  const setShowMarketplace = useAppStore((s) => s.setShowMarketplace);
  const pushToast = useAppStore((s) => s.pushToast);

  // 招聘自市场的员工
  const [hiredIds, setHiredIds] = useState<string[]>([]);
  useEffect(() => {
    const map = JSON.parse(localStorage.getItem('hummer-marketplace-hires') ?? '{}');
    setHiredIds(Object.keys(map).filter((k) => map[k]));
    const onStorage = () => {
      const m = JSON.parse(localStorage.getItem('hummer-marketplace-hires') ?? '{}');
      setHiredIds(Object.keys(m).filter((k) => m[k]));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const hiredFromMarket = marketEmployees.filter((m) => hiredIds.includes(m.id));

  const filtered = useMemo(
    () =>
      employees.filter(
        (e) =>
          (zoneFilter === 'all' || e.zone === zoneFilter) &&
          (q === '' || e.name.includes(q) || e.role.includes(q) || (e.currentTask ?? '').includes(q)),
      ),
    [q, zoneFilter],
  );

  const grouped = useMemo(() => {
    const m: Partial<Record<ZoneId, typeof employees>> = {};
    for (const e of filtered) {
      (m[e.zone] ??= [] as any).push(e);
    }
    return m;
  }, [filtered]);

  return (
    <WorkspacePage
      title="我的员工"
      sub="数字员工组织架构 · 按部门展示在岗状态"
      actions={
        <>
          <button className="hum-btn is-sm">
            <ListFilter size={12} /> 分组视图
          </button>
          <button className="hum-btn is-sm">
            <Filter size={12} /> 筛选
          </button>
          <button onClick={() => setShowMarketplace(true)} className="hum-btn is-sm is-primary">
            <Plus size={12} /> 招聘新员工
          </button>
        </>
      }
      sticky={
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索员工姓名 / 岗位 / 任务关键词…"
              className="hum-input pl-7"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <ZoneFilterChip current={zoneFilter} value="all" onClick={setZoneFilter} label="全部" />
            {(Object.keys(ZONE_META) as ZoneId[]).map((z) => (
              <ZoneFilterChip
                key={z}
                current={zoneFilter}
                value={z}
                onClick={setZoneFilter}
                label={ZONE_META[z].label}
                color={ZONE_META[z].color}
              />
            ))}
          </div>
          <span className="hum-chip is-muted ml-auto">{filtered.length} / {employees.length}</span>
        </div>
      }
    >
      <div className="p-6 space-y-6">
        {/* 新招聘自市场（沙箱试岗中） */}
        {hiredFromMarket.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="hum-dot" style={{ background: '#F59E0B', width: 8, height: 8 }} />
              <h2 className="hum-h2">新招聘 · 沙箱试岗中</h2>
              <span className="hum-chip is-warning">{hiredFromMarket.length}</span>
              <span className="text-[11px] hum-faint font-mono uppercase tracking-wider">SANDBOX TRIAL · 7 天</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {hiredFromMarket.map((m) => (
                <button
                  key={m.id}
                  onClick={() => pushToast({ kind: 'info', title: `${m.name} 沙箱试岗中`, detail: '第 1/7 天 · 完成 5 任务 · 评分 88/100' })}
                  className="hum-card text-left p-3 hover:hum-elev-2 transition group"
                >
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <div
                        className="w-11 h-11 rounded-lg grid place-items-center text-white text-[15px] font-semibold"
                        style={{ background: m.color }}
                      >
                        {m.avatar}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white bg-warning hum-pulse" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="text-[13.5px] font-semibold text-neutral-900 truncate">{m.name}</div>
                        <span className="hum-chip is-warning" style={{ padding: '1px 6px', fontSize: 10 }}>试岗 1/7 天</span>
                      </div>
                      <div className="text-[11.5px] text-neutral-500 mt-0.5">{m.category}</div>
                      <div className="text-[11.5px] text-neutral-700 mt-1.5 line-clamp-2">{m.tagline}</div>
                    </div>
                  </div>
                  <div className="mt-3 pt-2.5 flex items-center gap-2 text-[11px] hum-muted" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <BadgeCheck size={11} className="text-secondary-600" />
                    <span>{m.expert} 兜底</span>
                    <span className="flex-1" />
                    <Sparkles size={11} className="text-warning" />
                    <span>Hermes 学习中</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {(Object.keys(ZONE_META) as ZoneId[]).map((zone) => {
          const list = grouped[zone] ?? [];
          if (list.length === 0 && zoneFilter !== 'all' && zoneFilter !== zone) return null;
          if (list.length === 0) return null;
          const meta = ZONE_META[zone];
          return (
            <section key={zone}>
              <div className="flex items-center gap-2 mb-3">
                <span className="hum-dot" style={{ background: meta.color, width: 8, height: 8 }} />
                <h2 className="hum-h2">{meta.label}</h2>
                <span className="hum-chip">{list.length}</span>
                <span className="text-[11px] hum-faint font-mono uppercase tracking-wider">{meta.sub}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {list.map((e) => (
                  <Card
                    key={e.id}
                    e={e}
                    onPick={() => setSelectedEmployee(e)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </WorkspacePage>
  );
}

function ZoneFilterChip({
  current, value, onClick, label, color,
}: {
  current: ZoneId | 'all';
  value: ZoneId | 'all';
  onClick: (v: any) => void;
  label: string;
  color?: string;
}) {
  const isActive = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition ${
        isActive ? 'bg-neutral-900 text-white' : 'hum-card-soft text-neutral-600 hover:text-neutral-900'
      }`}
      style={isActive ? { background: color ?? '#171717' } : undefined}
    >
      {label}
    </button>
  );
}

function Card({ e, onPick }: { e: any; onPick: () => void }) {
  const status = STATUS_META[e.status] ?? STATUS_META.idle;
  return (
    <button
      onClick={onPick}
      className="hum-card text-left p-3 hover:hum-elev-2 transition group"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar id={e.id} size={44} status={e.status} ringWidth={2} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="text-[13.5px] font-semibold text-neutral-900 truncate">{e.name}</div>
            <span className={status.chip} style={{ padding: '1px 6px', fontSize: 10 }}>{status.label}</span>
          </div>
          <div className="text-[11.5px] text-neutral-500 mt-0.5">{e.role}</div>
          <div className="text-[11.5px] text-neutral-700 mt-1.5 line-clamp-2">{e.currentTask}</div>
        </div>
      </div>

      {/* Footer metrics */}
      <div className="mt-3 pt-2.5 flex items-center gap-3 text-[11px] hum-muted hum-tabular" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <span title="今日 Token">{(e.tokensToday / 1000).toFixed(1)}K</span>
        <span title="今日成本">¥{e.costToday.toFixed(1)}</span>
        <span className="flex-1" />
        <span className="hum-chip is-muted" style={{ padding: '1px 6px', fontSize: 10 }}>
          {e.model.replace('Claude ', '')}
        </span>
      </div>

      {/* Quick actions (opacity hover) */}
      <div className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
        <button onClick={(ev) => { ev.stopPropagation(); }} className="hum-btn is-sm is-ghost">
          {e.status === 'idle' ? <Play size={11} /> : <Pause size={11} />}
        </button>
        <button onClick={(ev) => { ev.stopPropagation(); }} className="hum-btn is-sm is-ghost">
          <Shield size={11} />
        </button>
      </div>
    </button>
  );
}
