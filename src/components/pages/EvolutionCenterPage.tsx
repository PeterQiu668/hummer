/**
 * 进化中心（grills/01-growth-loop.md）— 三层视图
 * Tab1 组织层总览 / Tab2 个体进化档案（核心：因果链）/ Tab3 机制层飞轮
 * 合并「成长闭环」×「质量飞轮」：进化中心是 SOP/技能版本迭代的唯一机制来源。
 */
import { useState } from 'react';
import { Building2, UserRound, Workflow, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import AgentAvatar from '../ui/AgentAvatar';
import OrgOverviewTab from '../evolution/OrgOverviewTab';
import MechanismTab from '../evolution/MechanismTab';
import EvolutionProfile from '../evolution/EvolutionProfile';
import { employees } from '../../data/employees';
import { consumeFocusEmployeeId, getAbilityProfile, causalChains } from '../../data/evolution';

type Tab = 'org' | 'profiles' | 'mechanism';

export default function EvolutionCenterPage() {
  // 挂载时消费跨页定位（EmployeeDrawer「查看完整因果链」跳转）
  const [initial] = useState(() => {
    const focus = consumeFocusEmployeeId();
    return {
      tab: (focus ? 'profiles' : 'org') as Tab,
      employeeId: focus ?? 'emp-sales-1',
    };
  });
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [selectedId, setSelectedId] = useState(initial.employeeId);

  return (
    <WorkspacePage
      title="进化中心"
      sub="组织层总览 · 个体进化档案 · 机制层飞轮 — 数字员工自我进化的唯一机制来源"
      sticky={
        <div className="flex items-center gap-2">
          <TabBtn active={tab === 'org'} onClick={() => setTab('org')} icon={<Building2 size={12} />} label="组织层总览" />
          <TabBtn active={tab === 'profiles'} onClick={() => setTab('profiles')} icon={<UserRound size={12} />} label="个体进化档案" />
          <TabBtn active={tab === 'mechanism'} onClick={() => setTab('mechanism')} icon={<Workflow size={12} />} label="机制层飞轮" />
        </div>
      }
    >
      {tab === 'org' && <OrgOverviewTab />}
      {tab === 'profiles' && <ProfilesTab selectedId={selectedId} onSelect={setSelectedId} />}
      {tab === 'mechanism' && <MechanismTab />}
    </WorkspacePage>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition ${
        active ? 'bg-neutral-900 text-white' : 'hum-card-soft text-neutral-600 hover:text-neutral-900'
      }`}
    >
      {icon} {label}
    </button>
  );
}

// ── Tab2 个体进化档案：左员工列表 + 右档案 ─────────────────────────
function ProfilesTab({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const chainIds = causalChains.map((c) => c.employeeId);
  const sorted = [...employees].sort(
    (a, b) => (getAbilityProfile(b.id)?.currentScore ?? 0) - (getAbilityProfile(a.id)?.currentScore ?? 0),
  );

  return (
    <div className="flex h-full min-h-0">
      {/* 左：员工列表（当前能力分） */}
      <div className="w-60 shrink-0 overflow-y-auto py-3 px-2.5 bg-white" style={{ borderRight: '1px solid var(--border-subtle)' }}>
        <div className="hum-eyebrow px-1.5 mb-2">数字员工 · {employees.length}</div>
        <div className="space-y-0.5">
          {sorted.map((e) => {
            const p = getAbilityProfile(e.id);
            const active = e.id === selectedId;
            const delta = p?.weekDelta ?? 0;
            const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
            return (
              <button
                key={e.id}
                onClick={() => onSelect(e.id)}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition ${
                  active ? 'bg-primary-50' : 'hover:bg-neutral-50'
                }`}
              >
                <AgentAvatar id={e.id} size={28} status={e.status} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[12px] truncate ${active ? 'font-semibold text-primary-700' : 'font-medium text-neutral-900'}`}>
                    {e.name}
                    {chainIds.includes(e.id) && (
                      <span className="ml-1 hum-chip is-brand" style={{ padding: '0 4px', fontSize: 8.5 }}>因果链</span>
                    )}
                  </div>
                  <div className="text-[10px] hum-faint truncate">{e.role}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[13px] font-semibold hum-tabular text-neutral-900">{p?.currentScore ?? '—'}</div>
                  <div
                    className="text-[9.5px] hum-tabular flex items-center gap-0.5 justify-end"
                    style={{ color: delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--error)' : 'var(--text-faint)' }}
                  >
                    <DeltaIcon size={8.5} /> {delta > 0 ? `+${delta}` : delta}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 右：选中员工的进化档案 */}
      <div className="flex-1 min-w-0 overflow-y-auto p-6">
        <div className="max-w-3xl">
          <EvolutionProfile employeeId={selectedId} />
        </div>
      </div>
    </div>
  );
}
