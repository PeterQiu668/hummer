/**
 * 专家门户 · 收入与分成 — 本月收入 / 分成明细 / 近 6 个月趋势 / 结算说明
 */
import { TrendingUp, Wallet, CalendarClock, BadgeCheck } from 'lucide-react';
import {
  revenueRows, rowRevenue, monthTotal, revenueHistory, SHARE_RATE,
} from '../../data/expertops';

const fmtYuan = (n: number) => `¥${n.toLocaleString('zh-CN')}`;

export default function RevenuePanel() {
  const total = monthTotal();
  const lastMonth = revenueHistory[revenueHistory.length - 2].amount;
  const growth = Math.round(((total - lastMonth) / lastMonth) * 1000) / 10;
  const maxHistory = Math.max(...revenueHistory.map((m) => m.amount));

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      {/* 本月大数字 + 趋势图 */}
      <div className="grid grid-cols-5 gap-3">
        <div className="hum-card p-5 col-span-2 hum-elev-1">
          <div className="flex items-center gap-1.5 hum-eyebrow"><Wallet size={12} /> 本月分成收入（7 月）</div>
          <div className="mt-2 text-[34px] font-semibold hum-tabular text-neutral-900 leading-none">{fmtYuan(total)}</div>
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-success font-medium">
            <TrendingUp size={13} /> 环比 +{growth}%
          </div>
          <div className="mt-3 pt-3 text-[11.5px] hum-muted leading-relaxed" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            来源：{revenueRows.length} 位共创数字员工 × 企业订阅额 × {Math.round(SHARE_RATE * 100)}% 分成（当前银牌费率）
          </div>
        </div>

        {/* 近 6 个月条形图（纯 div） */}
        <div className="hum-card p-5 col-span-3 hum-elev-1">
          <div className="hum-eyebrow">近 6 个月分成收入</div>
          <div className="mt-4 flex items-end gap-4 h-36">
            {revenueHistory.map((m, i) => {
              const isLast = i === revenueHistory.length - 1;
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <div className="text-[10.5px] hum-tabular font-medium" style={{ color: isLast ? 'var(--brand)' : 'var(--text-faint)' }}>
                    {Math.round(m.amount / 1000)}k
                  </div>
                  <div
                    className="w-full rounded-t-md transition-all"
                    style={{
                      height: `${Math.round((m.amount / maxHistory) * 100)}%`,
                      background: isLast ? 'var(--brand)' : 'var(--brand-soft)',
                      border: isLast ? 'none' : '1px solid rgba(15,112,183,0.14)',
                    }}
                  />
                  <div className={`text-[11px] ${isLast ? 'font-semibold text-neutral-900' : 'hum-faint'}`}>{m.month}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 分成明细表 */}
      <div className="hum-card hum-elev-1 overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="hum-h3">分成明细 · 我共创的数字员工</div>
          <span className="hum-chip is-muted ml-auto">结算月：2026-07</span>
        </div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left hum-faint" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th className="px-4 py-2 font-medium">数字员工</th>
              <th className="px-4 py-2 font-medium">类目</th>
              <th className="px-4 py-2 font-medium text-right">在雇企业</th>
              <th className="px-4 py-2 font-medium text-right">月订阅额</th>
              <th className="px-4 py-2 font-medium text-right">分成比例</th>
              <th className="px-4 py-2 font-medium text-right">本月分成</th>
            </tr>
          </thead>
          <tbody>
            {revenueRows.map((r) => (
              <tr key={r.agentName} className="hover:bg-neutral-50 transition" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-neutral-900 flex items-center gap-1.5">
                    {r.agentName} <BadgeCheck size={12} className="text-success" />
                  </span>
                </td>
                <td className="px-4 py-2.5 hum-muted">{r.category}</td>
                <td className="px-4 py-2.5 text-right hum-tabular">{r.hires}</td>
                <td className="px-4 py-2.5 text-right hum-tabular hum-muted">{fmtYuan(r.subscription)}</td>
                <td className="px-4 py-2.5 text-right hum-tabular hum-muted">{Math.round(SHARE_RATE * 100)}%</td>
                <td className="px-4 py-2.5 text-right hum-tabular font-semibold text-neutral-900">{fmtYuan(rowRevenue(r))}</td>
              </tr>
            ))}
            <tr style={{ background: 'var(--bg-canvas)' }}>
              <td className="px-4 py-2.5 font-semibold text-neutral-900" colSpan={5}>合计</td>
              <td className="px-4 py-2.5 text-right hum-tabular font-semibold" style={{ color: 'var(--brand)' }}>{fmtYuan(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 结算周期说明 */}
      <div className="hum-card-soft p-4 flex items-start gap-3">
        <CalendarClock size={16} className="hum-faint shrink-0 mt-0.5" />
        <div className="text-[12px] hum-muted leading-relaxed">
          <span className="font-semibold text-neutral-800">结算周期说明：</span>
          按自然月结算，次月 10 日出账、15 日打款至签约账户；企业退订按实际在雇天数折算，争议工单（bad case 判责期内）对应分成暂缓至判责完成。
          分成比例随声誉等级浮动（金牌 18% / 银牌 15% / 铜牌 12%），详见「声誉等级」页。
        </div>
      </div>
    </div>
  );
}
