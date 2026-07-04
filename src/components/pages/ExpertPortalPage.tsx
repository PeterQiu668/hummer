/**
 * 专家门户（林知远视角）— 薄壳挂 4 个 tab
 * 介入工单 / 共创工作台 / 收入与分成 / 声誉等级
 */
import { useState } from 'react';
import { LifeBuoy, Hammer, Wallet, Medal } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { experts } from '../../data/experts';
import TicketBoard from '../expert/TicketBoard';
import SopStudio from '../expert/SopStudio';
import RevenuePanel from '../expert/RevenuePanel';
import ReputationPanel from '../expert/ReputationPanel';

type Tab = 'tickets' | 'studio' | 'revenue' | 'reputation';

const TABS: { key: Tab; label: string; icon: typeof LifeBuoy }[] = [
  { key: 'tickets', label: '介入工单', icon: LifeBuoy },
  { key: 'studio', label: '共创工作台', icon: Hammer },
  { key: 'revenue', label: '收入与分成', icon: Wallet },
  { key: 'reputation', label: '声誉等级', icon: Medal },
];

const me = experts.find((e) => e.id === 'ex-lin') ?? experts[0];

export default function ExpertPortalPage() {
  const [tab, setTab] = useState<Tab>('tickets');
  const expertTickets = useAppStore((s) => s.expertTickets);
  const openCount = expertTickets.filter((t) => t.status !== 'resolved').length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 头部：专家身份 */}
      <div className="px-6 pt-5 pb-0 shrink-0 bg-white" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl grid place-items-center text-white text-[16px] font-semibold shrink-0"
            style={{ background: me.color }}
          >
            {me.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="hum-h1 text-[19px]">{me.name} · 专家门户</h1>
              <span className="hum-chip is-warning">银牌专家</span>
            </div>
            <p className="mt-0.5 text-[12.5px] hum-muted">
              {me.title} · 共创 {me.agentCount} 位数字员工 · 从业 {me.yearsActive} 年 · 保障协议 SLA 生效中
            </p>
          </div>
        </div>

        {/* Tabs（对齐 Marketplace 样式） */}
        <div className="mt-3 flex items-center gap-1">
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-[13px] font-medium flex items-center gap-1.5 transition border-b-2 -mb-px ${
                  active ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-900'
                }`}
              >
                <Icon size={13} />
                {t.label}
                {t.key === 'tickets' && openCount > 0 && (
                  <span className="text-[10.5px] font-mono" style={{ color: 'var(--error)' }}>({openCount})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'tickets' && <TicketBoard />}
        {tab === 'studio' && <SopStudio />}
        {tab === 'revenue' && <RevenuePanel />}
        {tab === 'reputation' && <ReputationPanel />}
      </div>
    </div>
  );
}
