/**
 * 验收工作台 — 对任务 acceptance[] 逐条判定 通过/不通过
 * 全部通过 → 「确认验收 · 任务完成」；任一不通过 → 三选一（打回重做 / 转人工 / 降级交付）
 * 判定为本地 state，判定人 = 当前角色；三个出口动作全部写审计 + toast
 */
import { useState } from 'react';
import {
  CheckCircle2, XCircle, RotateCcw, UserRound, PackageMinus, ShieldCheck, X,
} from 'lucide-react';
import type { CollabTask } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { ROLE_NAMES, useTaskTransition } from './taskFlow';

type Verdict = 'passed' | 'failed';

export default function AcceptancePanel({ task, onDone }: { task: CollabTask; onDone?: () => void }) {
  const currentRole = useAppStore((s) => s.currentRole);
  const judgeName = ROLE_NAMES[currentRole];
  const transition = useTaskTransition();

  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [decideOpen, setDecideOpen] = useState(false);

  const interactive = task.status === 'waiting_approval';
  const total = task.acceptance.length;
  const judged = Object.keys(verdicts).length;
  const failedCount = Object.values(verdicts).filter((v) => v === 'failed').length;
  const allJudged = judged === total;
  const allPassed = allJudged && failedCount === 0;

  const setVerdict = (i: number, v: Verdict) =>
    setVerdicts((prev) => ({ ...prev, [i]: v }));

  const confirmAccept = () => {
    transition(task, 'completed', '确认验收 · 任务完成', {
      tags: ['task', 'acceptance', 'passed'],
      note: `${total} 条验收标准全部通过 · 判定人 ${judgeName}`,
      toastTitle: `「${task.title}」验收通过 · 任务完成`,
    });
    onDone?.();
  };

  return (
    <div>
      <div className="hum-eyebrow mb-1.5 flex items-center gap-1.5">
        <ShieldCheck size={11} /> 验收标准（{total}）
        {interactive && (
          <span className="hum-chip is-brand" style={{ padding: '1px 6px', fontSize: 10 }}>
            验收工作台 · 判定人 {judgeName}
          </span>
        )}
      </div>

      <ul className="space-y-1.5">
        {task.acceptance.map((item, i) => {
          const v = verdicts[i];
          return (
            <li key={i} className="hum-card-soft p-2.5">
              <div className="flex items-start gap-2">
                <span className="text-[12.5px] text-neutral-700 leading-relaxed flex-1">{item}</span>
                {v === 'passed' && (
                  <span className="hum-chip is-success shrink-0" style={{ padding: '1px 6px', fontSize: 10 }}>
                    <CheckCircle2 size={10} /> 通过
                  </span>
                )}
                {v === 'failed' && (
                  <span className="hum-chip is-error shrink-0" style={{ padding: '1px 6px', fontSize: 10 }}>
                    <XCircle size={10} /> 不通过
                  </span>
                )}
              </div>
              {interactive && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    onClick={() => setVerdict(i, 'passed')}
                    className={`hum-btn is-sm ${v === 'passed' ? 'is-primary' : ''}`}
                  >
                    <CheckCircle2 size={11} /> 通过
                  </button>
                  <button
                    onClick={() => setVerdict(i, 'failed')}
                    className={`hum-btn is-sm ${v === 'failed' ? 'is-danger' : ''}`}
                    style={v === 'failed' ? { background: 'var(--error-soft)' } : undefined}
                  >
                    <XCircle size={11} /> 不通过
                  </button>
                  {v && <span className="text-[10px] hum-faint">判定人 {judgeName}</span>}
                </div>
              )}
            </li>
          );
        })}
        {total === 0 && (
          <li className="text-[11.5px] hum-faint italic px-1">该任务未附验收标准，可直接确认验收。</li>
        )}
      </ul>

      {interactive && (
        <div className="mt-2.5 hum-card-soft p-2.5">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="hum-muted">
              已判定 <b className="text-neutral-900">{judged}/{total}</b>
              {failedCount > 0 && <span className="text-error"> · 不通过 {failedCount} 条</span>}
            </span>
            {allPassed || (total === 0) ? (
              <button onClick={confirmAccept} className="hum-btn is-sm is-primary">
                <CheckCircle2 size={12} /> 确认验收 · 任务完成
              </button>
            ) : failedCount > 0 ? (
              <button onClick={() => setDecideOpen(true)} className="hum-btn is-sm is-danger">
                处置不通过项（三选一）
              </button>
            ) : (
              <span className="hum-faint text-[10.5px]">逐条判定后出现验收动作</span>
            )}
          </div>
        </div>
      )}
      {!interactive && task.status !== 'completed' && (
        <div className="mt-1.5 text-[10.5px] hum-faint">任务提交验收（待验收）后可在此逐条判定。</div>
      )}

      {decideOpen && (
        <FailDecisionModal
          task={task}
          failedCount={failedCount}
          onClose={() => setDecideOpen(false)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

/* ── 不通过三选一：打回重做 / 转人工处理 / 降级交付 ── */

function FailDecisionModal({
  task, failedCount, onClose, onDone,
}: {
  task: CollabTask;
  failedCount: number;
  onClose: () => void;
  onDone?: () => void;
}) {
  const transition = useTaskTransition();
  const [reason, setReason] = useState('');

  const finish = () => { onClose(); onDone?.(); };

  const rework = () => {
    transition(task, 'in_progress', '验收不通过 · 打回重做', {
      result: 'warning',
      tags: ['task', 'acceptance', 'rework'],
      note: `打回原因：${reason.trim()}`,
      toastKind: 'warning',
      toastTitle: `「${task.title}」已打回重做`,
      toastDetail: reason.trim(),
    });
    finish();
  };
  const toManual = () => {
    transition(task, 'blocked', '验收不通过 · 转人工处理', {
      result: 'warning',
      tags: ['task', 'acceptance', 'manual'],
      note: '已转人工',
      toastKind: 'info',
      toastTitle: `「${task.title}」已转人工处理`,
      toastDetail: '任务标记为被阻断，等待人工接管',
    });
    finish();
  };
  const degrade = () => {
    transition(task, 'completed', '验收 · 降级交付', {
      result: 'warning',
      tags: ['task', 'acceptance', 'degraded'],
      note: `${failedCount} 条未达标 · 降级交付`,
      toastKind: 'warning',
      toastTitle: `「${task.title}」已降级交付`,
      toastDetail: '审计已标注 degraded',
    });
    finish();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: 'rgba(15,15,14,0.32)' }}>
      <div className="hum-card hum-elev-3 w-[420px] max-w-[92vw]">
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <XCircle size={14} className="text-error" />
          <span className="text-[13.5px] font-semibold text-neutral-900 flex-1">
            验收不通过 · {failedCount} 条未达标
          </span>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-2.5">
          <div className="text-[11.5px] hum-muted">「{task.title}」— 请选择处置方式（全部写入审计链）：</div>

          <div className="hum-card-soft p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <RotateCcw size={13} className="text-warning" />
              <span className="text-[12.5px] font-medium text-neutral-900">打回重做</span>
              <span className="text-[10.5px] hum-faint">→ 回到执行中，附打回原因</span>
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="打回原因（必填），如：第 2 条数据口径与验收标准不一致…"
              rows={2}
              className="hum-input text-[12px]"
              style={{ resize: 'none' }}
            />
            <button onClick={rework} disabled={reason.trim() === ''} className="hum-btn is-sm mt-1.5 disabled:opacity-40">
              <RotateCcw size={11} /> 确认打回
            </button>
          </div>

          <button onClick={toManual} className="w-full text-left hum-card-soft p-3 hover:hum-elev-1 transition">
            <div className="flex items-center gap-2">
              <UserRound size={13} className="text-primary-700" />
              <span className="text-[12.5px] font-medium text-neutral-900">转人工处理</span>
              <span className="text-[10.5px] hum-faint">→ 标记被阻断 · 标注「已转人工」</span>
            </div>
          </button>

          <button onClick={degrade} className="w-full text-left hum-card-soft p-3 hover:hum-elev-1 transition">
            <div className="flex items-center gap-2">
              <PackageMinus size={13} className="text-warning" />
              <span className="text-[12.5px] font-medium text-neutral-900">降级交付</span>
              <span className="text-[10.5px] hum-faint">→ 按现状完成 · 审计标注 degraded</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
