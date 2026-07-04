/**
 * 专家门户 · 介入工单 — SLA 倒计时 / 处置时间线 / 响应闭环
 * 动作：开始响应 → 填写处置结论并关闭（通报协作频道 + 写审计）
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, CheckCircle2, PlayCircle, Send, Bot, Link2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { ExpertTicket } from '../../lib/types';
import { seedExpertTickets, ticketChannels } from '../../data/expertops';

const nowHHMM = () => new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5);

const SEVERITY: Record<ExpertTicket['severity'], { label: string; cls: string }> = {
  high: { label: '高', cls: 'is-error' },
  medium: { label: '中', cls: 'is-warning' },
  low: { label: '低', cls: 'is-muted' },
};

const STATUS_LABEL: Record<ExpertTicket['status'], string> = {
  open: '待响应', responding: '处置中', resolved: '已解决',
};

/** 剩余毫秒（负数 = 超时） */
const remainingMs = (t: ExpertTicket) =>
  new Date(t.createdAt).getTime() + t.slaHours * 3600_000 - Date.now();

const fmtDuration = (ms: number) => {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600_000);
  const m = Math.floor((abs % 3600_000) / 60_000);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
};

export default function TicketBoard() {
  const tickets = useAppStore((s) => s.expertTickets);
  const updateExpertTicket = useAppStore((s) => s.updateExpertTicket);
  const pushCollabMessage = useAppStore((s) => s.pushCollabMessage);
  const pushAudit = useAppStore((s) => s.pushAudit);
  const pushToast = useAppStore((s) => s.pushToast);
  useAppStore((s) => s.tick); // 每 5s 重渲染，驱动 SLA 倒计时

  const [closingId, setClosingId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // 挂载注入 seed（store 为空才注入，getState 防 StrictMode 重复）
  useEffect(() => {
    const st = useAppStore.getState();
    if (st.expertTickets.length === 0) {
      // pushExpertTicket 头插，倒序注入以保持展示顺序
      [...seedExpertTickets()].reverse().forEach((t) => st.pushExpertTicket(t));
    }
  }, []);

  const openTickets = tickets.filter((t) => t.status !== 'resolved');
  const slaOk = tickets.filter((t) => t.status === 'resolved' || remainingMs(t) > 0).length;
  const slaRate = tickets.length > 0 ? Math.round((slaOk / tickets.length) * 100) : 100;

  const startResponse = (t: ExpertTicket) => {
    updateExpertTicket(t.id, {
      status: 'responding',
      timeline: [...t.timeline, { ts: nowHHMM(), actor: '林知远', note: '专家已接入，开始排查根因' }],
    });
    pushAudit({ actor: '林知远（专家）', action: '开始响应介入工单', target: t.title, result: 'ok', tags: ['expert', 'sla'] });
    pushToast({ kind: 'info', title: '已开始响应', detail: t.title });
  };

  const closeTicket = (t: ExpertTicket) => {
    const conclusion = note.trim();
    if (!conclusion) {
      pushToast({ kind: 'warning', title: '请先填写处置结论', detail: '结论将通报到相关协作频道并留痕' });
      return;
    }
    updateExpertTicket(t.id, {
      status: 'resolved',
      timeline: [...t.timeline, { ts: nowHHMM(), actor: '林知远', note: `处置结论：${conclusion}` }],
    });
    pushCollabMessage({
      id: `exp-${Date.now()}`,
      ts: nowHHMM(),
      channel: ticketChannels[t.id] ?? 'ch-q3',
      sender: '林知远（专家）',
      avatar: '林',
      senderRole: 'expert',
      content: `[专家处置通报] ${t.agentName} · ${t.title} — ${conclusion}`,
      type: 'msg',
    });
    pushAudit({ actor: '林知远（专家）', action: '关闭介入工单', target: t.title, result: 'ok', tags: ['expert', 'sla', 'resolve'] });
    pushToast({ kind: 'success', title: '工单已关闭', detail: '处置通报已同步至相关协作频道' });
    setClosingId(null);
    setNote('');
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      {/* 顶部统计 */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="开放工单" value={`${openTickets.length}`} sub={`共 ${tickets.length} 条 · 高严重度 ${openTickets.filter((t) => t.severity === 'high').length} 条`} accent={openTickets.length > 0 ? 'var(--warning)' : 'var(--success)'} />
        <StatCard label="平均响应时长" value="32 分钟" sub="近 30 天 · 保障协议要求 ≤ 60 分钟" accent="var(--brand)" />
        <StatCard label="SLA 达标率" value={`${slaRate}%`} sub="当前批次工单口径" accent={slaRate >= 90 ? 'var(--success)' : 'var(--error)'} />
      </div>

      {/* 工单列表 */}
      {tickets.map((t) => {
        const rem = remainingMs(t);
        const overdue = rem <= 0 && t.status !== 'resolved';
        const sev = SEVERITY[t.severity];
        return (
          <div key={t.id} className="hum-card p-4 hum-elev-1">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`hum-chip ${sev.cls}`}>严重度 · {sev.label}</span>
                  <span className={`hum-chip ${t.status === 'resolved' ? 'is-success' : t.status === 'responding' ? 'is-brand' : ''}`}>
                    {STATUS_LABEL[t.status]}
                  </span>
                  <span className="hum-chip"><Bot size={11} /> {t.agentName}</span>
                  {t.taskId && <span className="hum-chip is-muted font-mono"><Link2 size={11} /> {t.taskId}</span>}
                </div>
                <div className="mt-2 text-[14px] font-semibold text-neutral-900">{t.title}</div>
              </div>
              {/* SLA 倒计时 */}
              {t.status !== 'resolved' ? (
                <div
                  className="shrink-0 text-right rounded-lg px-3 py-2"
                  style={{ background: overdue ? 'var(--error-soft)' : 'var(--bg-subtle)' }}
                >
                  <div className={`flex items-center gap-1 justify-end text-[11px] font-semibold ${overdue ? 'text-error' : 'hum-muted'}`}>
                    {overdue ? <AlertTriangle size={12} /> : <Clock size={12} />}
                    {overdue ? 'SLA 超时' : 'SLA 剩余'}
                  </div>
                  <div className={`mt-0.5 text-[15px] font-semibold hum-tabular ${overdue ? 'text-error' : 'text-neutral-900'}`}>
                    {overdue ? `超时 ${fmtDuration(rem)}` : fmtDuration(rem)}
                  </div>
                  <div className="text-[10.5px] hum-faint mt-0.5">承诺 {t.slaHours}h 内响应</div>
                </div>
              ) : (
                <div className="shrink-0 flex items-center gap-1.5 text-success text-[12px] font-medium">
                  <CheckCircle2 size={14} /> SLA 内完成
                </div>
              )}
            </div>

            {/* 处置时间线 */}
            <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {t.timeline.map((ev, i) => (
                <div key={i} className="flex items-start gap-2.5 text-[12.5px]">
                  <span className="hum-dot mt-1.5 shrink-0" style={{ background: i === t.timeline.length - 1 ? 'var(--brand)' : 'var(--border-strong)' }} />
                  <span className="font-mono hum-faint shrink-0 hum-tabular">{ev.ts}</span>
                  <span className="font-medium text-neutral-700 shrink-0">{ev.actor}</span>
                  <span className="hum-muted">{ev.note}</span>
                </div>
              ))}
            </div>

            {/* 动作区 */}
            {t.status === 'open' && (
              <div className="mt-3">
                <button className="hum-btn is-primary is-sm" onClick={() => startResponse(t)}>
                  <PlayCircle size={13} /> 开始响应
                </button>
              </div>
            )}
            {t.status === 'responding' && (
              closingId === t.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="填写处置结论：根因 / 处置动作 / SOP 修订项…（将通报至协作频道并写入审计链）"
                    className="hum-input resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <button className="hum-btn is-primary is-sm" onClick={() => closeTicket(t)}>
                      <Send size={12} /> 提交结论并关闭工单
                    </button>
                    <button className="hum-btn is-ghost is-sm" onClick={() => { setClosingId(null); setNote(''); }}>取消</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <button className="hum-btn is-sm" onClick={() => { setClosingId(t.id); setNote(''); }}>
                    <CheckCircle2 size={13} /> 填写处置结论并关闭
                  </button>
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="hum-card p-4">
      <div className="hum-eyebrow">{label}</div>
      <div className="mt-1.5 text-[24px] font-semibold hum-tabular" style={{ color: accent }}>{value}</div>
      <div className="mt-0.5 text-[11.5px] hum-faint">{sub}</div>
    </div>
  );
}
