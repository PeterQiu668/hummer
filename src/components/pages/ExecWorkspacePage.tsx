/**
 * 高管工作台 — 吴帆·销售 VP（真人高管）视角
 * 区块：分身拆解待确认 / 部门验收队列 / 团队绩效 / 待我处理的风险
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GitBranch, CheckCircle2, RotateCcw, Inbox, ShieldAlert, Users2,
  ThumbsUp, ThumbsDown, AlertTriangle, FileText, Timer, ScrollText, X,
} from 'lucide-react';
import WorkspacePage, { EmptyState } from './WorkspacePage';
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import { executiveTwins } from '../../data/executives';
import { collabTasks } from '../../data/tasks';

const EXEC_NAME = '吴帆·销售 VP';
const SALES_TWIN = executiveTwins.find((e) => e.id === 'exec-sales');

// ── 区块 1：分身拆解待确认（吴·销售 VP 分身把老板目标拆成的部门动作）──
// 决策①：分级超时 + 默许记账 —— 低风险超时自动放行记「默许」，中高风险超时升级老板收件箱
interface DecompItem {
  id: string;
  title: string;
  detail: string;
  assignee: string;   // 拟派给的数字员工
  source: string;     // 上游老板目标
  status: 'pending' | 'confirmed' | 'rejected' | 'tacit' | 'escalated';
  risk: 'low' | 'medium' | 'high';
  deadline: string;   // mock 静态倒计时展示
  overdueSeed?: boolean; // 初始即超时（挂载时按 risk 转 tacit / escalated 并写审计）
}

const RISK_LABEL: Record<DecompItem['risk'], string> = { low: '低风险', medium: '中风险', high: '高风险' };

const DECOMP_SEED: DecompItem[] = [
  {
    id: 'dc-1',
    title: '锁定华东 23 家 A 级客户 · 双周 BD 战役',
    detail: '基于 CRM 分层，按行业 × 客单价筛选 tier-A 客户，双周节奏外发 BD 邮件 + 报价单',
    assignee: '雪·销售官',
    source: '昆仑：Q3 华东大客户增长 30%',
    status: 'pending', risk: 'low', deadline: '剩余 42 分钟',
  },
  {
    id: 'dc-2',
    title: '关键客户拜访排期 · 高管陪访 8 场',
    detail: '为 Top 8 客户排真人高管拜访，分身生成拜访简报 + 谈判要点卡',
    assignee: '雪·销售官',
    source: '昆仑：Q3 华东大客户增长 30%',
    status: 'pending', risk: 'low', deadline: '已超时 26 分钟', overdueSeed: true,
  },
  {
    id: 'dc-3',
    title: '报价折扣策略调整 · 上限 8% → 10%',
    detail: '对 A 级客户临时上调折扣权限，超 8% 部分需财务会签，季度末回收',
    assignee: '雪·销售官（财务会签）',
    source: '昆仑：Q3 回收率目标 ≥ 22%',
    status: 'pending', risk: 'high', deadline: '已超时 1 小时 05 分', overdueSeed: true,
  },
  {
    id: 'dc-4',
    title: '销售 SOP「BD 邮件 v3.2」推广到全部一线',
    detail: '将专家认证的 BD 邮件技能装配到部门全部销售 Agent，一周内完成灰度',
    assignee: '部门全体销售 Agent',
    source: '昆仑：能力沉淀为组织资产',
    status: 'pending', risk: 'medium', deadline: '剩余 3 小时 10 分',
  },
];

// 预授权规则（授权仪式的高管版 · mock）
interface PreauthRule { id: string; rule: string; scope: string }
const PREAUTH_SEED: PreauthRule[] = [
  { id: 'pa-1', rule: '单笔 <5w 的部门内资源调配免确认', scope: '销售增长部门 · 低风险拆解' },
  { id: 'pa-2', rule: 'SOP 灰度推广（已认证版本）免确认', scope: '部门全体销售 Agent · 低风险拆解' },
];

// ── 区块 2：部门验收队列（映射 data/tasks.ts 销售相关任务）──
interface DeptDelivery {
  id: string;
  name: string;
  ownerId: string;
  taskId: string;
  note: string;
  ts: string;
}

const DELIVERY_SEED: DeptDelivery[] = [
  { id: 'dd-1', name: 'BD 外发清单.xlsx（23 家 A 级客户）', ownerId: 'emp-sales-1', taskId: 'tk-sales-q3', note: '每封邮件已经法务模板核验', ts: '今日 14:35' },
  { id: 'dd-2', name: 'Q3 标准报价单 PDF x23', ownerId: 'emp-sales-1', taskId: 'tk-sales-q3', note: '折扣均 ≤ 8% · 符合当前权限', ts: '今日 13:58' },
  { id: 'dd-3', name: '华东客户分层报告 v2', ownerId: 'emp-sales-1', taskId: 'tk-sales-q3', note: '行业 × 客单价双维分层 · 引用客户 KG', ts: '今日 11:20' },
  { id: 'dd-4', name: '鲲鹏制造主合同 v4 风险清单（协作交付）', ownerId: 'emp-legal', taskId: 'tk-legal-review', note: '3 条高危条款已加批注 · 待销售侧确认商务口径', ts: '昨日 18:40' },
];

// 团队今日完成（mock）
const TODAY_DONE: Record<string, number> = { 'emp-sales-1': 6 };

export default function ExecWorkspacePage() {
  const pushAudit = useAppStore((s) => s.pushAudit);
  const pushToast = useAppStore((s) => s.pushToast);
  const riskAlerts = useAppStore((s) => s.riskAlerts);
  const approveAlert = useAppStore((s) => s.approveAlert);

  const [decomps, setDecomps] = useState<DecompItem[]>(DECOMP_SEED);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [verdicts, setVerdicts] = useState<Record<string, 'passed' | 'returned'>>({});
  const [preauthOpen, setPreauthOpen] = useState(false);
  const [preauthRules, setPreauthRules] = useState<PreauthRule[]>(PREAUTH_SEED);
  const [preauthDraft, setPreauthDraft] = useState('');
  const timeoutSettled = useRef(false); // 超时结算只做一次（防 StrictMode 重复写审计）

  // 挂载结算已超时项：低风险 → 默许放行记账；中高风险 → 升级老板收件箱
  useEffect(() => {
    if (timeoutSettled.current) return;
    timeoutSettled.current = true;
    setDecomps((list) =>
      list.map((d) => {
        if (!d.overdueSeed || d.status !== 'pending') return d;
        if (d.risk === 'low') {
          pushAudit({ actor: '系统（超时策略）', action: '默许放行（超时未审）', target: d.title, result: 'warning', tags: ['exec', 'tacit', 'decompose'] });
          return { ...d, status: 'tacit' as const };
        }
        pushAudit({ actor: '系统（超时策略）', action: `${RISK_LABEL[d.risk]}拆解超时未审 · 升级老板收件箱`, target: d.title, result: 'warning', tags: ['exec', 'escalate', 'decompose'] });
        return { ...d, status: 'escalated' as const };
      }),
    );
  }, [pushAudit]);

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), []);
  const taskMap = useMemo(() => new Map(collabTasks.map((t) => [t.id, t])), []);
  const teamMembers = useMemo(
    () => employees.filter((e) => SALES_TWIN?.managesEmployeeIds.includes(e.id)),
    [],
  );

  const pendingDecomps = decomps.filter((d) => d.status === 'pending').length;
  const tacitCount = decomps.filter((d) => d.status === 'tacit').length;
  const confirmedCount = decomps.filter((d) => d.status === 'confirmed').length;
  const tacitRate = tacitCount + confirmedCount > 0
    ? Math.round((tacitCount / (tacitCount + confirmedCount)) * 100)
    : 0;
  const pendingDeliveries = DELIVERY_SEED.filter((d) => !verdicts[d.id]).length;
  const pendingRisks = riskAlerts.filter((a) => a.status === 'pending');
  const weeklyBadCases = teamMembers.reduce((sum, e) => sum + e.evolution.badCases, 0);

  const confirmDecomp = (item: DecompItem) => {
    setDecomps((list) => list.map((d) => (d.id === item.id ? { ...d, status: 'confirmed' } : d)));
    pushAudit({ actor: EXEC_NAME, action: '确认授权分身拆解', target: item.title, result: 'ok', tags: ['exec', 'decompose'] });
    pushToast({ kind: 'success', title: '已确认授权', detail: `「${item.title}」将派给 ${item.assignee}` });
  };

  const rejectDecomp = (item: DecompItem) => {
    const note = rejectNote.trim() || '请补充依据后重拆';
    setDecomps((list) => list.map((d) => (d.id === item.id ? { ...d, status: 'rejected' } : d)));
    setRejectingId(null);
    setRejectNote('');
    pushAudit({ actor: EXEC_NAME, action: `打回重拆 · ${note}`, target: item.title, result: 'warning', tags: ['exec', 'decompose', 'reject'] });
    pushToast({ kind: 'warning', title: '已打回重拆', detail: `意见已回传分身：${note}` });
  };

  // 默许项 → 补确认（转正式确认，冲销默许记账）
  const lateConfirm = (item: DecompItem) => {
    setDecomps((list) => list.map((d) => (d.id === item.id ? { ...d, status: 'confirmed' } : d)));
    pushAudit({ actor: EXEC_NAME, action: '补确认（默许转正式确认）', target: item.title, result: 'ok', tags: ['exec', 'tacit', 'confirm'] });
    pushToast({ kind: 'success', title: '已补确认', detail: `「${item.title}」默许记账已转正式确认` });
  };

  // 默许项 → 撤回（等同打回重拆，执行中动作回滚）
  const revokeTacit = (item: DecompItem) => {
    setDecomps((list) => list.map((d) => (d.id === item.id ? { ...d, status: 'rejected' } : d)));
    pushAudit({ actor: EXEC_NAME, action: '撤回默许放行 · 打回重拆', target: item.title, result: 'warning', tags: ['exec', 'tacit', 'revoke'] });
    pushToast({ kind: 'warning', title: '已撤回', detail: `「${item.title}」已打回分身重拆，执行中动作回滚` });
  };

  // 新增预授权规则（mock）
  const addPreauth = () => {
    const rule = preauthDraft.trim();
    if (!rule) {
      pushToast({ kind: 'warning', title: '请先填写规则内容', detail: '例如「单份合同 <10w 的标准报价免确认」' });
      return;
    }
    setPreauthRules((list) => [...list, { id: `pa-${Date.now()}`, rule, scope: '销售增长部门 · 低风险拆解' }]);
    setPreauthDraft('');
    pushAudit({ actor: EXEC_NAME, action: '配置预授权规则', target: rule, result: 'ok', tags: ['exec', 'preauth'] });
    pushToast({ kind: 'success', title: '预授权规则已生效', detail: `命中该规则的低风险拆解将免确认：${rule}` });
  };

  const acceptDelivery = (d: DeptDelivery, passed: boolean) => {
    setVerdicts((v) => ({ ...v, [d.id]: passed ? 'passed' : 'returned' }));
    pushAudit({
      actor: EXEC_NAME,
      action: passed ? '部门验收通过' : '部门验收打回',
      target: d.name,
      result: passed ? 'ok' : 'warning',
      tags: ['exec', 'accept', `task:${d.taskId}`],
    });
    pushToast(
      passed
        ? { kind: 'success', title: '验收通过', detail: d.name }
        : { kind: 'warning', title: '已打回', detail: `${d.name} · 已通知 ${empMap.get(d.ownerId)?.name ?? '责任 Agent'} 返工` },
    );
  };

  const decideRisk = (id: string, approve: boolean, action: string) => {
    approveAlert(id, approve ? 'approve' : 'reject', `由 ${EXEC_NAME} 处理`);
    pushToast(
      approve
        ? { kind: 'success', title: '风险已批准放行', detail: action }
        : { kind: 'info', title: '已拒绝 · 改走更安全方式', detail: action },
    );
  };

  return (
    <WorkspacePage
      title="高管工作台"
      sub={`${EXEC_NAME} · 分身「${SALES_TWIN?.name ?? '吴·销售 VP 分身'}」为您预处理了部门事务，关键决策仍由您签字`}
      actions={<span className="hum-chip is-brand"><Users2 size={11} /> 销售增长部门</span>}
    >
      <div className="p-6 space-y-6 max-w-[1080px]">
        {/* 概览 */}
        <div className="grid grid-cols-5 gap-3">
          <Stat label="拆解待确认" value={pendingDecomps.toString()} color="warning" />
          <Stat label="待验收交付" value={pendingDeliveries.toString()} color="brand" />
          <Stat label="待处理风险" value={pendingRisks.length.toString()} color={pendingRisks.length > 0 ? 'error' : undefined} />
          <Stat label="本周 bad case" value={weeklyBadCases.toString()} />
          {/* 决策①：默许率进治理指标 */}
          <div className="hum-card p-3">
            <div className="flex items-center justify-between gap-1">
              <div className="hum-eyebrow">默许率</div>
              <button onClick={() => setPreauthOpen(true)} className="flex items-center gap-0.5 text-[10.5px] text-primary-600 hover:underline shrink-0">
                <ScrollText size={10} /> 预授权规则
              </button>
            </div>
            <div className={`text-[22px] font-semibold mt-1 hum-tabular ${tacitRate > 0 ? 'text-warning' : 'text-neutral-900'}`}>
              {tacitRate}%
            </div>
            <div className="text-[10px] hum-faint mt-0.5">默许 {tacitCount} / 总确认 {tacitCount + confirmedCount} · 默许率进入您的治理指标</div>
          </div>
        </div>

        {/* 区块 1：分身拆解待确认 */}
        <section>
          <SectionHead icon={<GitBranch size={13} className="text-primary-600" />} title="分身拆解待确认" sub="吴·销售 VP 分身把老板目标拆成的部门动作 · 您确认后才会下发执行" />
          <div className="space-y-2">
            {decomps.map((d) => (
              <div key={d.id} className={`hum-card p-4 ${d.status === 'confirmed' || d.status === 'rejected' ? 'opacity-70' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-neutral-900">{d.title}</span>
                      {d.status === 'confirmed' && <span className="hum-chip is-success">已确认授权</span>}
                      {d.status === 'rejected' && <span className="hum-chip is-warning">已打回重拆</span>}
                      {d.status === 'tacit' && (
                        <span className="hum-chip" style={{ background: '#f2eddc', color: '#7d6b2e', borderColor: '#dfd5b4' }}>
                          已默许（超时未审）
                        </span>
                      )}
                      {d.status === 'escalated' && <span className="hum-chip is-error">已升级收件箱</span>}
                    </div>
                    <div className="text-[12px] text-neutral-600 mt-1">{d.detail}</div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className={`hum-chip ${d.risk === 'high' ? 'is-error' : d.risk === 'medium' ? 'is-warning' : 'is-muted'}`}>
                        {RISK_LABEL[d.risk]}
                      </span>
                      <span className={`hum-chip ${d.deadline.startsWith('已超时') ? 'is-warning' : 'is-muted'}`}>
                        <Timer size={10} /> {d.deadline}
                      </span>
                      <span className="hum-chip">拟派：{d.assignee}</span>
                      <span className="hum-chip is-muted">来源 · {d.source}</span>
                    </div>
                    {d.risk !== 'low' && (d.status === 'pending' || d.status === 'escalated') && (
                      <div className="text-[10.5px] hum-faint mt-1.5">{RISK_LABEL[d.risk]}拆解不自动确认 · 超时将升级老板收件箱</div>
                    )}
                    {d.status === 'tacit' && (
                      <div className="text-[10.5px] hum-faint mt-1.5">低风险超时已自动放行并计入默许记账 · 您仍可补确认或撤回</div>
                    )}
                  </div>
                  {d.status === 'pending' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => confirmDecomp(d)} className="hum-btn is-sm is-primary"><CheckCircle2 size={11} /> 确认授权</button>
                      <button onClick={() => { setRejectingId(rejectingId === d.id ? null : d.id); setRejectNote(''); }} className="hum-btn is-sm"><RotateCcw size={11} /> 打回重拆</button>
                    </div>
                  )}
                  {d.status === 'tacit' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => lateConfirm(d)} className="hum-btn is-sm is-primary"><CheckCircle2 size={11} /> 补确认</button>
                      <button onClick={() => revokeTacit(d)} className="hum-btn is-sm is-danger"><RotateCcw size={11} /> 撤回</button>
                    </div>
                  )}
                </div>
                {rejectingId === d.id && d.status === 'pending' && (
                  <div className="mt-3 flex items-center gap-2 hum-card-soft p-2">
                    <input
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="打回意见 · 例如「折扣上调需先给出 ROI 测算」"
                      className="hum-input flex-1"
                      autoFocus
                    />
                    <button onClick={() => rejectDecomp(d)} className="hum-btn is-sm is-danger">提交打回</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 区块 2：部门验收队列 */}
        <section>
          <SectionHead icon={<Inbox size={13} className="text-success" />} title="部门验收队列" sub="本部门数字员工的待验收交付 · 通过后进入交付出口 / 打回则返工" />
          <div className="hum-card overflow-hidden">
            {DELIVERY_SEED.map((d, i) => {
              const owner = empMap.get(d.ownerId);
              const task = taskMap.get(d.taskId);
              const verdict = verdicts[d.id];
              return (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3" style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
                  <FileText size={14} className="text-neutral-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-neutral-900 truncate">{d.name}</div>
                    <div className="text-[11px] hum-muted truncate">
                      {owner?.name ?? '—'} · {task?.title ?? d.taskId} · {d.note} · {d.ts}
                    </div>
                  </div>
                  {verdict === 'passed' && <span className="hum-chip is-success shrink-0"><ThumbsUp size={10} /> 已验收</span>}
                  {verdict === 'returned' && <span className="hum-chip is-warning shrink-0"><ThumbsDown size={10} /> 已打回</span>}
                  {!verdict && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => acceptDelivery(d, true)} className="hum-btn is-sm is-primary"><ThumbsUp size={11} /> 验收通过</button>
                      <button onClick={() => acceptDelivery(d, false)} className="hum-btn is-sm"><ThumbsDown size={11} /> 打回</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* 区块 3：团队绩效 */}
        <section>
          <SectionHead icon={<Users2 size={13} className="text-primary-600" />} title="团队绩效" sub={`您管辖的数字员工 · ${SALES_TWIN?.responsibility ?? ''}`} />
          <div className="grid grid-cols-2 gap-3">
            {teamMembers.map((e) => (
              <div key={e.id} className="hum-card p-4">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg grid place-items-center text-white text-[13px] font-semibold shrink-0" style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}>
                    {e.avatar}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-neutral-900">{e.name}</span>
                      <StatusChip status={e.status} />
                    </div>
                    <div className="text-[11px] hum-muted truncate mt-0.5">{e.currentTask}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <MiniStat label="今日完成" value={`${TODAY_DONE[e.id] ?? 0} 项`} />
                  <MiniStat label="今日成本" value={`¥${e.costToday.toFixed(1)}`} />
                  <MiniStat label="本周 bad case" value={`${e.evolution.badCases} 起`} warn={e.evolution.badCases > 0} />
                </div>
              </div>
            ))}
            <div className="hum-card-soft p-4 flex flex-col justify-center">
              <div className="hum-eyebrow mb-1">本周部门 bad case 小计</div>
              <div className="text-[22px] font-semibold hum-tabular text-warning">{weeklyBadCases} 起</div>
              <div className="text-[11px] hum-muted mt-1">已全部进入 Hermes 改进队列 · 改进上线前不重复计费</div>
            </div>
          </div>
        </section>

        {/* 区块 4：待我处理的风险 */}
        <section>
          <SectionHead icon={<ShieldAlert size={13} className="text-error" />} title="待我处理的风险" sub="守护者拦截的高危动作 · 批准放行或拒绝改走更安全方式" />
          {pendingRisks.length === 0 ? (
            <EmptyState icon={<ShieldAlert size={18} />} title="暂无待处理风险" sub="守护者未发现需要您人工介入的高危动作" />
          ) : (
            <div className="space-y-2">
              {pendingRisks.map((a) => (
                <div key={a.id} className="hum-card p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={15} className={a.level === 'critical' || a.level === 'high' ? 'text-error mt-0.5' : 'text-warning mt-0.5'} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-neutral-900">{a.action}</span>
                        <span className={`hum-chip ${a.level === 'critical' || a.level === 'high' ? 'is-error' : 'is-warning'}`}>
                          {a.level === 'critical' ? '极高' : a.level === 'high' ? '高危' : a.level === 'medium' ? '中危' : '低危'}
                        </span>
                        <span className="hum-chip is-muted">{a.agent} · {a.ts}</span>
                      </div>
                      <div className="text-[12px] text-neutral-600 mt-1">拦截原因：{a.reason}</div>
                      <div className="text-[12px] text-neutral-600 mt-0.5">建议：{a.suggestion}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => decideRisk(a.id, true, a.action)} className="hum-btn is-sm is-primary">批准</button>
                      <button onClick={() => decideRisk(a.id, false, a.action)} className="hum-btn is-sm is-danger">拒绝</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 预授权规则 modal（授权仪式的高管版 · 决策①） */}
        {preauthOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm"
            onClick={() => setPreauthOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative w-[520px] max-w-[92vw] bg-white rounded-lg shadow-large border border-neutral-200 overflow-hidden"
            >
              <div className="h-1" style={{ background: 'var(--brand)' }} />
              <div className="px-5 pt-4 pb-2 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--brand-soft)' }}>
                  <ScrollText size={20} className="text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-neutral-900">预授权规则</div>
                  <div className="text-[12px] hum-muted mt-0.5">命中规则的低风险拆解免确认 · 不计默许 · 全部写入审计链</div>
                </div>
                <button onClick={() => setPreauthOpen(false)} className="hum-btn is-ghost is-sm shrink-0"><X size={13} /></button>
              </div>
              <div className="px-5 pb-3 space-y-2">
                {preauthRules.map((r) => (
                  <div key={r.id} className="hum-card-soft p-3 flex items-start gap-2.5">
                    <CheckCircle2 size={14} className="text-success mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-neutral-900">{r.rule}</div>
                      <div className="text-[11px] hum-faint mt-0.5">适用范围：{r.scope} · 已生效</div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    value={preauthDraft}
                    onChange={(e) => setPreauthDraft(e.target.value)}
                    placeholder="新增规则 · 例如「单份合同 <10w 的标准报价免确认」"
                    className="hum-input flex-1"
                  />
                  <button onClick={addPreauth} className="hum-btn is-sm is-primary shrink-0">新增预授权</button>
                </div>
              </div>
              <div className="px-5 py-3 text-[11px] hum-faint" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-subtle)' }}>
                预授权是显式、有记录、可计量的授权形态 —— 免确认 ≠ 免责任，命中记录仍可追溯到本规则与您的签署。
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}

function SectionHead({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="mb-2.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="hum-h3">{title}</span>
      </div>
      {sub && <div className="text-[11.5px] hum-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === 'working') return <span className="hum-chip is-success"><span className="hum-dot hum-pulse" style={{ background: 'var(--success)' }} /> 工作中</span>;
  if (status === 'blocked') return <span className="hum-chip is-error">阻塞</span>;
  if (status === 'meeting') return <span className="hum-chip is-brand">会议中</span>;
  if (status === 'training') return <span className="hum-chip is-warning">训练中</span>;
  return <span className="hum-chip">空闲</span>;
}

function MiniStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="hum-card-soft py-2 px-1">
      <div className="text-[9.5px] hum-faint">{label}</div>
      <div className={`text-[12.5px] font-semibold hum-tabular mt-0.5 ${warn ? 'text-warning' : 'text-neutral-900'}`}>{value}</div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: 'success' | 'warning' | 'error' | 'brand' }) {
  const c =
    color === 'success' ? 'text-success'
    : color === 'warning' ? 'text-warning'
    : color === 'error' ? 'text-error'
    : color === 'brand' ? 'text-primary-700'
    : 'text-neutral-900';
  return (
    <div className="hum-card p-3">
      <div className="hum-eyebrow">{label}</div>
      <div className={`text-[22px] font-semibold mt-1 hum-tabular ${c}`}>{value}</div>
    </div>
  );
}
