/**
 * 专家门户 · 介入工单 — SLA 倒计时 / 处置时间线 / 响应闭环
 * 两阶段接单（决策②）：接单前只见脱敏摘要 → 签临时保密与责任协议 → 可见完整信息 + 上下文切片；
 * 关单即撤销访问权，信息重新脱敏，处置记录归档留痕。
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle, Clock, CheckCircle2, PlayCircle, Send, Bot, Link2,
  ShieldCheck, Lock, EyeOff, MessagesSquare, Archive,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { ExpertTicket } from '../../lib/types';
import { seedExpertTickets, ticketChannels, ticketContextExt } from '../../data/expertops';

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
  const [ndaTicket, setNdaTicket] = useState<ExpertTicket | null>(null);

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

  /** 阶段二：同意临时保密与责任协议 → 才接单并解锁完整上下文 */
  const signAndStart = (t: ExpertTicket) => {
    updateExpertTicket(t.id, {
      status: 'responding',
      timeline: [
        ...t.timeline,
        { ts: nowHHMM(), actor: '林知远', note: '已签署临时保密与责任协议，接单并解锁工单上下文切片' },
      ],
    });
    pushAudit({ actor: '林知远（专家）', action: '签署临时保密与责任协议 · 接单开始响应', target: t.title, result: 'ok', tags: ['expert', 'sla', 'expert-nda'] });
    pushToast({ kind: 'info', title: '已接单', detail: `协议已留痕 · 已解锁「${t.title}」完整上下文` });
    setNdaTicket(null);
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
    pushAudit({ actor: '系统', action: '关单撤销专家上下文访问权 · 处置记录归档', target: t.title, result: 'ok', tags: ['expert', 'access-revoked'] });
    pushToast({ kind: 'success', title: '工单已关闭', detail: '通报已同步协作频道 · 上下文访问权已自动撤销' });
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
        const ext = ticketContextExt[t.id];
        const unlocked = t.status === 'responding'; // 仅处置中可见完整信息；关单后重新脱敏
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
                  {t.status === 'resolved' && (
                    <span className="hum-chip is-muted"><Archive size={11} /> 访问权已撤销 · 处置记录已归档</span>
                  )}
                </div>
                <div className="mt-2 text-[14px] font-semibold text-neutral-900">{t.title}</div>
                {/* 脱敏摘要 / 完整上下文（决策②） */}
                {ext && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-[11.5px]">
                    <span className="hum-chip is-warning">{ext.errorType}</span>
                    <span className="hum-chip is-muted">涉及 · {ext.sopRef}</span>
                    <span className="hum-chip is-muted">影响面 · {ext.impact}</span>
                    <span className="hum-chip">{unlocked ? ext.clientFull : ext.clientMasked}</span>
                    <span className="hum-chip is-muted">{unlocked ? ext.detailFull : ext.detailMasked}</span>
                  </div>
                )}
                {ext && t.status === 'open' && (
                  <div className="mt-1.5 flex items-center gap-1 text-[11px] hum-faint">
                    <Lock size={11} /> 脱敏摘要 · 接单后可见完整上下文（客户与业务细节已打码）
                  </div>
                )}
                {ext && t.status === 'resolved' && (
                  <div className="mt-1.5 flex items-center gap-1 text-[11px] hum-faint">
                    <EyeOff size={11} /> 关单后信息已重新脱敏 · 完整记录仅存于工单归档
                  </div>
                )}
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

            {/* 上下文切片（仅接单后可见） */}
            {ext && unlocked && (
              <div className="mt-3 hum-card-soft p-3">
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-neutral-700">
                  <MessagesSquare size={12} className="text-primary-600" /> 上下文切片
                  <span className="hum-chip is-muted">切片范围：工单创建时点起 · {ext.sliceChannel}</span>
                </div>
                <div className="mt-2 space-y-1.5">
                  {ext.contextSlices.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-[12px]">
                      <span className="font-mono hum-faint shrink-0 hum-tabular">{s.ts}</span>
                      <span className="font-medium text-neutral-700 shrink-0">{s.sender}</span>
                      <span className="hum-muted">{s.text}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[10.5px] hum-faint">仅可见与本工单相关的消息切片 · 关单后访问权自动撤销</div>
              </div>
            )}

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
                <button className="hum-btn is-primary is-sm" onClick={() => setNdaTicket(t)}>
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

      {/* 两步确认弹层：临时保密与责任协议 */}
      {ndaTicket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm"
          onClick={() => setNdaTicket(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-[480px] max-w-[92vw] bg-white rounded-lg shadow-large border border-neutral-200 overflow-hidden"
          >
            <div className="h-1" style={{ background: 'var(--brand)' }} />
            <div className="px-5 pt-4 pb-2 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--brand-soft)' }}>
                <ShieldCheck size={20} className="text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-neutral-900">签署临时保密与责任协议</div>
                <div className="text-[12px] hum-muted mt-0.5 truncate">{ndaTicket.title}</div>
              </div>
            </div>
            <div className="px-5 pb-3 space-y-2">
              {[
                '接单后仅可见与本工单相关的上下文切片（工单创建时点起 + 关联任务消息），不开放全群历史',
                '您在处置过程中的每一步操作均写入企业审计链，处置记录留存于工单',
                '工单关闭即自动退群并撤销全部历史访问权，客户数据不可再次查看',
              ].map((line, i) => (
                <div key={i} className="flex items-start gap-2 text-[12.5px] text-neutral-700">
                  <CheckCircle2 size={13} className="text-primary-600 mt-0.5 shrink-0" />
                  <span>{line}</span>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-subtle)' }}>
              <button className="hum-btn is-ghost is-sm" onClick={() => setNdaTicket(null)}>取消</button>
              <button className="hum-btn is-primary is-sm" onClick={() => signAndStart(ndaTicket)}>
                <ShieldCheck size={13} /> 同意并开始响应
              </button>
            </div>
          </div>
        </div>
      )}
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
