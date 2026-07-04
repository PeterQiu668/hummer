/**
 * ROI 经营报告 + 账单中心（Phase 0）
 * tab1 经营 ROI 月报：完成任务 / 验收通过 / 等效人时节省 / 专家介入 + 部门 ROI 卡 + 月度趋势 + 人力成本对比
 * tab2 账单中心：部门 → 员工 → 任务 三级归因 + 预算硬顶进度条 + 失败任务不计费
 */
import { useState } from 'react';
import {
  TrendingUp, Receipt, CheckCircle2, PackageCheck, Clock3, UserCheck,
  ChevronDown, ChevronRight, Download, ShieldOff, BadgePercent, Cpu,
} from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import { useAppStore } from '../../store/useAppStore';
import {
  roiSummary, deptRoiCards, monthlyTrend, humanCompare,
  billingDepts, billingTotal, waivedTotal, fmtYuan, fmtTokens,
  type BillingEmployee, type BudgetStatus,
} from '../../data/roi';

type Tab = 'roi' | 'billing';

const BUDGET_META: Record<BudgetStatus, { label: string; color: string; soft: string }> = {
  ok:       { label: '预算内',   color: 'var(--success)', soft: 'var(--success-soft)' },
  near:     { label: '接近上限', color: 'var(--warning)', soft: 'var(--warning-soft)' },
  exceeded: { label: '已超限',   color: 'var(--error)',   soft: 'var(--error-soft)' },
};

export default function RoiPage() {
  const pushToast = useAppStore((s) => s.pushToast);
  const [tab, setTab] = useState<Tab>('roi');

  return (
    <WorkspacePage
      title="经营 ROI 与账单"
      sub={`${roiSummary.monthLabel}经营月报 · 部门/员工/任务三级成本归因 · 预算硬顶与熔断`}
      actions={
        <button
          className="hum-btn is-sm is-primary"
          onClick={() => pushToast({ kind: 'success', title: '月报已导出', detail: `${roiSummary.monthLabel}经营 ROI 月报.pdf 已生成` })}
        >
          <Download size={12} /> 导出月报
        </button>
      }
      sticky={
        <div className="flex items-center gap-2">
          <TabBtn active={tab === 'roi'} onClick={() => setTab('roi')} icon={<TrendingUp size={12} />} label="经营 ROI 月报" />
          <TabBtn active={tab === 'billing'} onClick={() => setTab('billing')} icon={<Receipt size={12} />} label="账单中心" />
        </div>
      }
    >
      {tab === 'roi' ? <RoiReport /> : <BillingCenter />}
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

// ── tab1 经营 ROI 月报 ────────────────────────────────────────────

function RoiReport() {
  const maxTasks = Math.max(...monthlyTrend.map((m) => m.tasks));
  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* 顶部 4 指标 */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={<CheckCircle2 size={14} />} label="本月完成任务" value={roiSummary.tasksDone.toLocaleString()} sub="较上月 +14.6%" color="var(--brand)" />
        <StatCard icon={<PackageCheck size={14} />} label="验收通过交付物" value={roiSummary.deliverablesAccepted.toString()} sub="一次通过率 87%" color="var(--success)" />
        <StatCard
          icon={<Clock3 size={14} />} label="等效人时节省"
          value={`${roiSummary.savedHours} 人时`}
          sub={`≈ ${fmtYuan(roiSummary.savedValue)} 人力成本`}
          color="#7E22CE"
        />
        <StatCard icon={<UserCheck size={14} />} label="专家介入次数" value={roiSummary.expertInterventions.toString()} sub="平均响应 1.8h" color="var(--warning)" />
      </div>

      {/* ROI 总览横幅 */}
      <div className="hum-card p-4 flex items-center gap-4">
        <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
          <BadgePercent size={17} />
        </div>
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-neutral-900">
            本月 AI 团队总投入 {fmtYuan(billingTotal)}，等效产出 {fmtYuan(roiSummary.savedValue)}
          </div>
          <div className="text-[11.5px] hum-muted mt-0.5">
            节省 {roiSummary.savedHours} 人时 ≈ {fmtYuan(roiSummary.savedValue)}，投入产出比约 {(roiSummary.savedValue / billingTotal).toFixed(1)}x
          </div>
        </div>
        <span className="hum-chip is-success" style={{ fontSize: 12, padding: '3px 10px' }}>
          ROI {(roiSummary.savedValue / billingTotal).toFixed(1)}x
        </span>
      </div>

      {/* 部门 ROI 卡片 */}
      <section>
        <div className="hum-eyebrow mb-2">按部门 ROI</div>
        <div className="grid grid-cols-5 gap-3">
          {deptRoiCards.map((d) => (
            <div key={d.dept} className="hum-card p-3">
              <div className="text-[12px] font-semibold text-neutral-900 truncate">{d.dept}</div>
              <div className="text-[18px] font-semibold hum-tabular mt-1" style={{ color: 'var(--brand)' }}>{d.roiX}x</div>
              <div className="hum-divider my-2" />
              <div className="space-y-1 text-[11px] hum-muted hum-tabular">
                <div className="flex justify-between"><span>完成任务</span><span className="text-neutral-800">{d.tasksDone}</span></div>
                <div className="flex justify-between"><span>节省人时</span><span className="text-neutral-800">{d.savedHours}h</span></div>
                <div className="flex justify-between"><span>AI 成本</span><span className="text-neutral-800">{fmtYuan(d.aiCost)}</span></div>
                <div className="flex justify-between"><span>人力等效</span><span className="text-neutral-800">{fmtYuan(d.humanCost)}</span></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 月度趋势条形图（纯 div） */}
      <section className="hum-card p-4">
        <div className="flex items-baseline justify-between mb-4">
          <div className="hum-eyebrow">月度完成任务趋势</div>
          <div className="text-[10.5px] hum-faint">条内数字为完成任务数 · 下方为节省人时</div>
        </div>
        <div className="flex items-end gap-4 h-36 px-2">
          {monthlyTrend.map((m, i) => {
            const isLast = i === monthlyTrend.length - 1;
            return (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                <span className="text-[10.5px] hum-tabular font-medium" style={{ color: isLast ? 'var(--brand)' : 'var(--text-muted)' }}>
                  {m.tasks.toLocaleString()}
                </span>
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${Math.max((m.tasks / maxTasks) * 100, 6)}%`,
                    background: isLast ? 'var(--brand)' : 'rgba(15, 112, 183, 0.22)',
                  }}
                />
                <span className="text-[10.5px] hum-muted">{m.month}</span>
                <span className="text-[10px] hum-faint hum-tabular">{m.savedHours}h</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* 对比同岗位人力成本 */}
      <section className="hum-card overflow-hidden">
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="hum-eyebrow">对比同岗位人力成本</span>
        </div>
        <table className="w-full text-[12.5px]">
          <thead style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <tr className="text-[10.5px] uppercase tracking-wider text-neutral-500">
              <th className="text-left px-4 py-2 font-semibold">同岗位（人力）</th>
              <th className="text-left px-4 py-2 font-semibold">AI 员工</th>
              <th className="text-right px-4 py-2 font-semibold">人力月成本</th>
              <th className="text-right px-4 py-2 font-semibold">AI 月成本</th>
              <th className="text-right px-4 py-2 font-semibold">节省</th>
            </tr>
          </thead>
          <tbody>
            {humanCompare.map((r, i) => (
              <tr key={r.position} style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
                <td className="px-4 py-2.5 text-neutral-800">{r.position}</td>
                <td className="px-4 py-2.5 text-neutral-700">{r.agentName}</td>
                <td className="px-4 py-2.5 text-right hum-tabular text-neutral-700">{fmtYuan(r.humanCost)}</td>
                <td className="px-4 py-2.5 text-right hum-tabular font-medium" style={{ color: 'var(--brand)' }}>{fmtYuan(r.agentCost)}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}>
                    -{Math.round((1 - r.agentCost / r.humanCost) * 100)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ── tab2 账单中心 ─────────────────────────────────────────────────

function BillingCenter() {
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>(
    () => Object.fromEntries(billingDepts.map((d) => [d.dept, true])),
  );
  const [openEmp, setOpenEmp] = useState<string | null>(null);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      {/* 账单总额 + 免计费横幅 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="hum-card p-4">
          <div className="hum-eyebrow">本月账单总额</div>
          <div className="text-[26px] font-semibold hum-tabular text-neutral-900 mt-1">{fmtYuan(billingTotal)}</div>
          <div className="text-[11px] hum-muted mt-0.5">{billingDepts.length} 个部门 · {billingDepts.reduce((s, d) => s + d.employees.length, 0)} 位 AI 员工</div>
        </div>
        <div className="hum-card p-4 col-span-2 flex items-center gap-3" style={{ borderColor: 'rgba(30, 143, 92, 0.3)', background: 'var(--success-soft)' }}>
          <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-white" style={{ color: 'var(--success)' }}>
            <ShieldOff size={16} />
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold" style={{ color: 'var(--success)' }}>失败任务不计费</div>
            <div className="text-[11.5px] text-neutral-700 mt-0.5">
              被阻断 / 验收不通过 / 异常终止的任务，其 token 消耗全额免除，不进入账单。
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[18px] font-semibold hum-tabular" style={{ color: 'var(--success)' }}>{fmtYuan(waivedTotal)}</div>
            <div className="text-[10.5px] hum-muted">本月已免计费</div>
          </div>
        </div>
      </div>

      {/* 三级归因表 */}
      <div className="hum-card overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="hum-eyebrow">成本归因 · 部门 → 员工 → 任务</span>
          <span className="text-[10.5px] hum-faint">点击行展开下一级</span>
        </div>
        {billingDepts.map((dept) => (
          <div key={dept.dept} style={{ borderTop: '1px solid var(--border-subtle)' }}>
            {/* 部门行 */}
            <button
              onClick={() => setOpenDepts((s) => ({ ...s, [dept.dept]: !s[dept.dept] }))}
              className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-neutral-25 transition text-left"
            >
              {openDepts[dept.dept] ? <ChevronDown size={13} className="text-neutral-400" /> : <ChevronRight size={13} className="text-neutral-400" />}
              <span className="text-[13px] font-semibold text-neutral-900 flex-1">{dept.dept}</span>
              <span className="hum-chip is-muted" style={{ padding: '1px 6px', fontSize: 10 }}>{dept.employees.length} 人</span>
              <span className="text-[13px] font-semibold hum-tabular text-neutral-900 w-24 text-right">{fmtYuan(dept.monthCost)}</span>
            </button>
            {/* 员工行 */}
            {openDepts[dept.dept] && dept.employees.map((emp) => (
              <EmployeeBillingRow
                key={emp.id}
                emp={emp}
                open={openEmp === emp.id}
                onToggle={() => setOpenEmp(openEmp === emp.id ? null : emp.id)}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="text-[11px] hum-faint text-center">
        账单口径：token 用量 × 模型单价 × {`工作日折算`}，与员工页「今日 token / 成本」同源 · 超预算硬顶自动熔断并转人工
      </div>
    </div>
  );
}

function EmployeeBillingRow({ emp, open, onToggle }: { emp: BillingEmployee; open: boolean; onToggle: () => void }) {
  const meta = BUDGET_META[emp.budgetStatus];
  const ratio = emp.monthCost / emp.budgetCap;
  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }} className="bg-neutral-25/40">
      <button onClick={onToggle} className="w-full pl-9 pr-4 py-2.5 flex items-center gap-3 hover:bg-neutral-25 transition text-left">
        {open ? <ChevronDown size={12} className="text-neutral-400 shrink-0" /> : <ChevronRight size={12} className="text-neutral-400 shrink-0" />}
        <div className="w-40 shrink-0">
          <div className="text-[12.5px] font-medium text-neutral-900 truncate">{emp.name}</div>
          <div className="text-[10.5px] hum-faint truncate flex items-center gap-1"><Cpu size={9} /> {emp.model}</div>
        </div>
        <div className="w-32 shrink-0 text-[11px] hum-muted hum-tabular">
          <div>{fmtTokens(emp.tokensToday)} tok/日</div>
          <div className="hum-faint">${emp.costTodayUsd.toFixed(1)}/日</div>
        </div>
        {/* 预算硬顶进度条 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-[10.5px] mb-1 hum-tabular">
            <span style={{ color: meta.color }} className="font-medium">{meta.label}{emp.fused ? ' · 已熔断转人工' : ''}</span>
            <span className="hum-muted">{fmtYuan(emp.monthCost)} / 硬顶 {fmtYuan(emp.budgetCap)}（{Math.round(ratio * 100)}%）</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(ratio, 1) * 100}%`, background: meta.color }}
            />
          </div>
        </div>
        {emp.fused && (
          <span className="hum-chip is-error shrink-0" style={{ padding: '1px 6px', fontSize: 10 }}>已熔断转人工</span>
        )}
        <span className="text-[12.5px] font-semibold hum-tabular text-neutral-900 w-24 text-right shrink-0">{fmtYuan(emp.monthCost)}</span>
      </button>

      {/* 任务级归因 */}
      {open && (
        <div className="pl-16 pr-4 pb-3">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-neutral-400">
                <th className="text-left py-1 font-semibold">任务</th>
                <th className="text-right py-1 font-semibold">Tokens</th>
                <th className="text-right py-1 font-semibold">成本</th>
                <th className="text-right py-1 font-semibold">计费</th>
              </tr>
            </thead>
            <tbody>
              {emp.tasks.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className={`py-1.5 pr-2 ${t.status === 'failed' ? 'text-neutral-400 line-through decoration-neutral-300' : 'text-neutral-700'}`}>
                    {t.title}
                  </td>
                  <td className="py-1.5 text-right hum-tabular hum-muted">{fmtTokens(t.tokens)}</td>
                  <td className={`py-1.5 text-right hum-tabular ${t.status === 'failed' ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>
                    {fmtYuan(t.cost)}
                  </td>
                  <td className="py-1.5 text-right">
                    {t.status === 'failed' ? (
                      <span className="hum-chip is-success" style={{ padding: '0 6px', fontSize: 9.5 }}>失败 · 免计费</span>
                    ) : (
                      <span className="hum-chip is-muted" style={{ padding: '0 6px', fontSize: 9.5 }}>正常计费</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div className="hum-card p-3.5">
      <div className="flex items-center gap-1.5 hum-eyebrow" style={{ color }}>
        {icon} <span style={{ color: 'var(--text-faint)' }}>{label}</span>
      </div>
      <div className="text-[22px] font-semibold hum-tabular text-neutral-900 mt-1.5">{value}</div>
      <div className="text-[11px] hum-muted mt-0.5">{sub}</div>
    </div>
  );
}
