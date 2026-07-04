/**
 * 试岗报告卡（Phase 0 缺口⑥）
 * 右侧抽屉：7 天进度 / 四维指标 / 试岗任务明细 / 试岗评分大数字。
 * trialDay >= 7 且未决策时，强制显示三选一：转正并授权 / 延长试岗 3 天 / 退回市场。
 */
import { motion } from 'framer-motion';
import {
  X, BadgeCheck, Clock3, Undo2, ShieldCheck, AlertTriangle,
  CheckCircle2, MinusCircle, XCircle, FileText,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { TRIAL_DAYS, EXTEND_DAYS, STAGE_META, type CandidateView } from '../../data/trial';

const SIGNER = '昆仑（您）';

const VERDICT_ICON = {
  pass: <CheckCircle2 size={13} className="text-success" />,
  warn: <MinusCircle size={13} className="text-warning" />,
  fail: <XCircle size={13} className="text-error" />,
};

interface Props {
  view: CandidateView;
  onClose: () => void;
  onPromote: () => void; // 进入授权仪式
}

export default function TrialReportCard({ view, onClose, onPromote }: Props) {
  const decideTrial = useAppStore((s) => s.decideTrial);
  const pushAudit = useAppStore((s) => s.pushAudit);
  const pushToast = useAppStore((s) => s.pushToast);

  const { emp, cand, decision, grant, stage, deadlineDays, tasks } = view;
  const day = Math.min(cand.trialDay ?? 1, deadlineDays);
  const score = cand.trialScore ?? 0;
  const m = cand.trialMetrics;
  const stageMeta = STAGE_META.find((s) => s.id === stage)!;
  const mustDecide = !decision && day >= TRIAL_DAYS && stage !== 'onboarded';

  const doPromote = () => {
    decideTrial({ candidateId: emp.id, decision: 'promote', decidedBy: SIGNER });
    pushAudit({ actor: SIGNER, action: '试岗决策 · 转正并授权', target: emp.name, result: 'ok', tags: ['trial', 'promote', 'human-in-loop'] });
    pushToast({ kind: 'success', title: `${emp.name} 通过试岗`, detail: '请完成授权仪式签署后正式入工区' });
    onPromote();
  };
  const doExtend = () => {
    decideTrial({ candidateId: emp.id, decision: 'extend', decidedBy: SIGNER });
    pushAudit({ actor: SIGNER, action: `试岗决策 · 延长试岗 ${EXTEND_DAYS} 天`, target: emp.name, result: 'pending', tags: ['trial', 'extend', 'human-in-loop'] });
    pushToast({ kind: 'info', title: `${emp.name} 试岗延长 ${EXTEND_DAYS} 天`, detail: `新试岗期 ${TRIAL_DAYS + EXTEND_DAYS} 天，期满需再次决策` });
  };
  const doReturn = () => {
    decideTrial({ candidateId: emp.id, decision: 'return', decidedBy: SIGNER });
    pushAudit({ actor: SIGNER, action: '试岗决策 · 退回市场', target: emp.name, result: 'blocked', tags: ['trial', 'return', 'human-in-loop'] });
    pushToast({ kind: 'warning', title: `${emp.name} 已退回市场`, detail: '试岗数据与沙箱记录已归档至审计链' });
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[70] flex justify-end"
      style={{ background: 'rgba(15,15,14,0.38)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 48, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.24 }}
        className="w-[520px] max-w-[94vw] h-full bg-white flex flex-col"
        style={{ borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="w-10 h-10 rounded-lg grid place-items-center text-white font-bold" style={{ background: emp.color }}>
            {emp.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-neutral-900 truncate">{emp.name}</span>
              <span className="hum-chip" style={{ padding: '1px 6px', fontSize: 10, color: stageMeta.color, borderColor: `${stageMeta.color}33`, background: `${stageMeta.color}14` }}>
                {stageMeta.label}
              </span>
            </div>
            <div className="text-[11px] hum-muted mt-0.5">试岗报告 · {emp.category} · {emp.expert} 共创认证</div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 评分大数字 + 7 天进度 */}
          <div className="flex gap-4">
            <div className="hum-card-soft p-4 w-[140px] shrink-0 text-center">
              <div
                className="text-[40px] font-bold hum-tabular leading-none"
                style={{ color: score >= 85 ? 'var(--success)' : score >= 70 ? 'var(--text-strong)' : 'var(--warning)' }}
              >
                {score}
              </div>
              <div className="text-[10.5px] hum-faint mt-1.5">试岗综合评分 / 100</div>
              <div className="text-[10px] mt-1" style={{ color: score >= 85 ? 'var(--success)' : 'var(--warning)' }}>
                {score >= 85 ? '建议转正' : score >= 70 ? '边缘 · 建议延长观察' : '建议退回'}
              </div>
            </div>
            <div className="flex-1 hum-card-soft p-4">
              <div className="hum-eyebrow mb-2">试岗进度 · 第 {day}/{deadlineDays} 天</div>
              <div className="flex gap-1.5">
                {Array.from({ length: deadlineDays }, (_, i) => i + 1).map((d) => (
                  <div key={d} className="flex-1 text-center">
                    <div
                      className="h-2 rounded-full"
                      style={{ background: d <= day ? (d > TRIAL_DAYS ? 'var(--warning)' : 'var(--brand)') : 'var(--bg-subtle)' }}
                    />
                    <div className={`text-[9px] mt-1 ${d === day ? 'text-neutral-900 font-semibold' : 'hum-faint'}`}>D{d}</div>
                  </div>
                ))}
              </div>
              {decision?.decision === 'extend' && (
                <div className="mt-2 text-[10.5px] text-warning flex items-center gap-1">
                  <Clock3 size={10} /> 已延长 {EXTEND_DAYS} 天（{decision.ts} 由 {decision.decidedBy} 决定）
                </div>
              )}
            </div>
          </div>

          {/* 四维指标 */}
          {m && (
            <div>
              <div className="hum-eyebrow mb-2">四维指标</div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '完成任务', value: String(m.completed), sub: '件' },
                  { label: '质量均分', value: m.quality.toFixed(1), sub: '/ 5.0' },
                  { label: '试岗成本', value: m.cost, sub: '沙箱累计' },
                  { label: '风险事件', value: String(m.risks), sub: m.risks > 0 ? '已拦截' : '零风险' },
                ].map((it) => (
                  <div key={it.label} className="hum-card p-3 text-center">
                    <div
                      className="text-[18px] font-bold hum-tabular"
                      style={it.label === '风险事件' && m.risks > 0 ? { color: 'var(--error)' } : undefined}
                    >
                      {it.value}
                    </div>
                    <div className="text-[10px] hum-faint mt-0.5">{it.label} · {it.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 试岗任务明细 */}
          <div>
            <div className="hum-eyebrow mb-2 flex items-center gap-1.5">
              <FileText size={11} /> 试岗任务明细（{tasks.length}）
            </div>
            <div className="hum-card overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] hum-faint" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <th className="px-3 py-2 font-medium w-[44px]">天</th>
                    <th className="px-3 py-2 font-medium">任务 / 结果</th>
                    <th className="px-3 py-2 font-medium w-[56px] text-right">评分</th>
                    <th className="px-3 py-2 font-medium w-[36px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t, i) => (
                    <tr key={i} style={i > 0 ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
                      <td className="px-3 py-2.5 hum-faint hum-tabular align-top">D{t.day}</td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-medium text-neutral-900">{t.name}</div>
                        <div className="text-[11px] text-neutral-600 mt-0.5">{t.result}</div>
                        <div className="text-[10.5px] hum-faint mt-0.5">评语：{t.comment}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right hum-tabular font-semibold align-top"
                        style={{ color: t.score >= 85 ? 'var(--success)' : t.score >= 70 ? 'var(--text-ink)' : 'var(--error)' }}>
                        {t.score}
                      </td>
                      <td className="px-3 py-2.5 align-top">{VERDICT_ICON[t.verdict]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 底部：决策区 */}
        <div className="px-5 py-4" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-canvas)' }}>
          {grant || stage === 'onboarded' ? (
            <div className="flex items-center gap-2 text-[12.5px] text-success">
              <BadgeCheck size={15} />
              已转正并完成授权签署{grant ? `（授权编号 ${grant.id} · 有效期至 ${grant.validUntil}）` : ''}
            </div>
          ) : decision?.decision === 'promote' ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 text-[12px] text-neutral-700 flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-primary-700" /> 已决定转正，待完成授权仪式签署
              </div>
              <button onClick={onPromote} className="hum-btn is-primary">
                <ShieldCheck size={13} /> 继续授权仪式
              </button>
            </div>
          ) : decision?.decision === 'return' ? (
            <div className="flex items-center gap-2 text-[12.5px] text-error">
              <Undo2 size={14} /> 已退回市场（{decision.ts} 由 {decision.decidedBy} 决定），试岗记录已归档
            </div>
          ) : mustDecide ? (
            <div>
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-900 mb-2.5">
                <AlertTriangle size={14} className="text-warning" />
                试岗已满 {TRIAL_DAYS} 天 · 必须做出决策
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={doPromote} className="hum-btn is-primary justify-center py-2.5">
                  <BadgeCheck size={13} /> 转正并授权
                </button>
                <button onClick={doExtend} className="hum-btn justify-center py-2.5">
                  <Clock3 size={13} /> 延长试岗 {EXTEND_DAYS} 天
                </button>
                <button onClick={doReturn} className="hum-btn is-danger justify-center py-2.5">
                  <Undo2 size={13} /> 退回市场
                </button>
              </div>
              <div className="text-[10.5px] hum-faint mt-2">
                转正需签署授权仪式（权限 / 数据范围 / 额度 / 有效期）· 全部动作写入审计链
              </div>
            </div>
          ) : (
            <div className="text-[12px] hum-muted flex items-center gap-1.5">
              <Clock3 size={13} />
              试岗进行中（第 {day}/{deadlineDays} 天）· 满 {TRIAL_DAYS} 天后需做转正决策
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
