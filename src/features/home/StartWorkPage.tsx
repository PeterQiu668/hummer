import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  CircleX,
  MonitorCog,
  ShieldAlert,
} from 'lucide-react';
import {
  decideStartWorkPlan,
  totalEstimatedCostCny,
  validateDispatchableStartWorkPlan,
  validatePendingStartWorkPlan,
  type StartWorkDecision,
  type StartWorkPlan,
  type StartWorkRiskClass,
} from './startWorkPlan';

const riskLabels: Record<StartWorkRiskClass, string> = {
  none: '无高风险动作',
  egress: '对外发送',
  write: '写入或覆盖',
  spend: '产生费用',
  delete: '删除',
  privilege: '权限变更',
  network: '新网络端点',
  unknown: '未知 · 最高风险',
};

const dispatchRiskClasses: StartWorkRiskClass[] = [
  'egress', 'write', 'spend', 'delete', 'privilege', 'network', 'unknown',
];

export interface StartWorkPageProps {
  plan: StartWorkPlan | null;
  decisionActorRef?: string;
  now?: () => string;
  onPlanRequest?: (target: string) => void;
  onDecision?: (plan: StartWorkPlan, decision: StartWorkDecision) => void;
  dispatchAvailable?: boolean;
}

/**
 * Phase 0 single-entry review surface. This component records a human decision
 * only; it intentionally has no runtime, relay, dispatch, or execution port.
 */
export default function StartWorkPage({
  plan,
  decisionActorRef = 'human:operator',
  now = () => new Date().toISOString(),
  onPlanRequest,
  onDecision,
  dispatchAvailable = true,
}: StartWorkPageProps) {
  const [localDecision, setLocalDecision] = useState<{
    sourcePlan: StartWorkPlan;
    plan: StartWorkPlan;
  } | null>(null);
  const [target, setTarget] = useState('');
  const currentPlan = localDecision?.sourcePlan === plan ? localDecision.plan : plan;
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const validation = useMemo(
    () => {
      if (!currentPlan) return { ok: false, errors: ['还没有可确认计划'] };
      if (localDecision?.sourcePlan === plan) return { ok: true, errors: [] };
      return validatePendingStartWorkPlan(currentPlan);
    },
    [currentPlan, localDecision, plan],
  );
  const actorIsHuman = decisionActorRef.startsWith('human:') && decisionActorRef.length > 'human:'.length;
  const dispatchValidation = currentPlan ? validateDispatchableStartWorkPlan(currentPlan) : { ok: false, errors: [] };
  const canReject = Boolean(currentPlan && validation.ok && actorIsHuman);
  const canConfirm = Boolean(canReject && dispatchValidation.ok && dispatchAvailable);

  const decide = (decision: StartWorkDecision) => {
    if (!currentPlan) {
      setDecisionError('还没有可确认计划');
      return;
    }
    if (decision === 'confirm' && !dispatchValidation.ok) {
      setDecisionError(dispatchValidation.errors.join('；'));
      return;
    }
    const transition = decideStartWorkPlan(currentPlan, decision, decisionActorRef, now());
    if (!transition.accepted) {
      setDecisionError(transition.reason ?? '计划决策被拒绝');
      return;
    }
    setLocalDecision({ sourcePlan: currentPlan, plan: transition.plan });
    setDecisionError(null);
    onDecision?.(transition.plan, decision);
  };

  if (!currentPlan) {
    return (
      <main className="h-full overflow-y-auto bg-[var(--bg-canvas)] p-6" aria-labelledby="start-work-title">
        <section className="mx-auto max-w-3xl space-y-4">
          <Header />
          <div className="hum-card p-6">
            <label htmlFor="start-work-target" className="hum-h2">你想完成什么</label>
            <textarea
              id="start-work-target"
              className="hum-input mt-3 min-h-24 resize-y"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="例如：整理两台设备上的客户资料，生成一份带证据的摘要"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs hum-muted" role="status">还没有可确认计划。提交目标只会请求生成计划。</p>
              <button
                type="button"
                className="hum-btn is-primary"
                disabled={!target.trim() || !onPlanRequest}
                onClick={() => onPlanRequest?.(target.trim())}
              >
                生成待确认计划
              </button>
            </div>
          </div>
          <DecisionBar canConfirm={false} canReject={false} onConfirm={() => decide('confirm')} onReject={() => decide('reject')} />
        </section>
      </main>
    );
  }

  if (!validation.ok || !actorIsHuman) {
    const errors = actorIsHuman ? validation.errors : ['只有具名人类操作者可以确认或拒绝计划'];
    return (
      <main className="h-full overflow-y-auto bg-[var(--bg-canvas)] p-6" aria-labelledby="start-work-title">
        <section className="mx-auto max-w-3xl space-y-4">
          <Header />
          <div className="hum-card border-[var(--error)] p-5" role="alert">
            <div className="flex items-center gap-2 text-[var(--error)]">
              <AlertTriangle size={18} aria-hidden="true" />
              <h2 className="font-semibold">计划无法确认</h2>
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm hum-muted">
              {errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
            <p className="mt-3 text-xs hum-faint">已按 fail-closed 处理，没有派发或执行任何任务。</p>
          </div>
          <DecisionBar canConfirm={false} canReject={false} onConfirm={() => decide('confirm')} onReject={() => decide('reject')} />
        </section>
      </main>
    );
  }

  const estimatedCost = totalEstimatedCostCny(currentPlan);
  const terminal = currentPlan.status !== 'pending';

  return (
    <main className="h-full overflow-y-auto bg-[var(--bg-canvas)] p-6" aria-labelledby="start-work-title">
      <section className="mx-auto max-w-3xl space-y-4">
        <Header />

        <div className="hum-card p-5">
          <p className="hum-eyebrow">目标</p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--text-strong)]">{currentPlan.target}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className={`hum-chip ${terminal ? 'is-muted' : 'is-warning'}`}>
              {terminal ? (currentPlan.status === 'confirmed' ? '已确认 · 等待回执' : '已拒绝 · 未派发') : '等待你的确认'}
            </span>
            <span className="hum-chip"><CircleDollarSign size={13} aria-hidden="true" />{formatCost(estimatedCost)}</span>
          </div>
        </div>

        <div className="hum-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="hum-eyebrow">待确认计划</p>
              <h2 className="mt-1 hum-h2">{currentPlan.steps.length} 个步骤</h2>
            </div>
            <p className="text-xs hum-muted">确认只记录决定，不会自动开始执行</p>
          </div>

          <ol className="mt-4 space-y-3">
            {currentPlan.steps.map((step, index) => (
              <li key={step.id} className="hum-card-soft flex gap-3 p-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--text-ink)]">{step.title}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="hum-chip"><MonitorCog size={13} aria-hidden="true" />{step.nodeLabel}</span>
                    <span className={`hum-chip ${step.riskClass === 'none' ? 'is-success' : 'is-warning'}`}>
                      <ShieldAlert size={13} aria-hidden="true" />{riskLabels[step.riskClass]}
                    </span>
                    <span className="hum-chip"><CircleDollarSign size={13} aria-hidden="true" />{formatCost(step.estimatedCostCny)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-4 border-t border-[var(--border-soft)] pt-3" aria-label="七类受控风险">
            <p className="text-xs hum-muted">七类受控风险</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {dispatchRiskClasses.map((riskClass) => (
                <span key={riskClass} className={`hum-chip ${riskClass === 'unknown' ? 'is-error' : 'is-muted'}`}>
                  {riskLabels[riskClass]}
                </span>
              ))}
            </div>
          </div>
        </div>

        {!terminal && !dispatchValidation.ok ? (
          <div className="hum-card border-[var(--error)] p-4" role="alert">
            <div className="flex items-center gap-2 font-medium text-[var(--error)]"><AlertTriangle size={16} />无法生成派发意图</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs hum-muted">
              {dispatchValidation.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
            <p className="mt-2 text-xs hum-faint">已按 fail-closed 处理；你仍可以明确拒绝此计划。</p>
          </div>
        ) : null}

        {!terminal && !dispatchAvailable ? (
          <p className="hum-card border-[var(--border)] bg-[var(--bg-canvas)] p-4 text-sm hum-muted" role="status">
            Relay 未配置，当前只读，不能发送任务。
          </p>
        ) : null}

        {terminal ? (
          <div className="hum-card p-4" role="status">
            <div className="flex items-start gap-3">
              {currentPlan.status === 'confirmed'
                ? <CheckCircle2 className="mt-0.5 text-[var(--success)]" size={18} aria-hidden="true" />
                : <CircleX className="mt-0.5 text-[var(--error)]" size={18} aria-hidden="true" />}
              <div>
                <p className="font-medium">{currentPlan.status === 'confirmed' ? '计划已确认，等待派发回执' : '计划已拒绝，未派发'}</p>
                <p className="mt-1 text-xs hum-muted">决策人：{currentPlan.decidedBy} · 任务只能通过受控派发入口发送</p>
              </div>
            </div>
          </div>
        ) : (
          <DecisionBar canConfirm={canConfirm} canReject={canReject} onConfirm={() => decide('confirm')} onReject={() => decide('reject')} />
        )}

        {decisionError ? <p className="text-sm text-[var(--error)]" role="alert">{decisionError}</p> : null}
      </section>
    </main>
  );
}

function Header() {
  return (
    <header>
      <p className="hum-eyebrow">开始做</p>
      <h1 id="start-work-title" className="mt-1 hum-h1">先看计划，再决定是否继续</h1>
      <p className="mt-2 text-sm hum-muted">检查步骤、执行节点、风险和预估成本。默认不会派发。</p>
    </header>
  );
}

function DecisionBar({ canConfirm, canReject, onConfirm, onReject }: {
  canConfirm: boolean;
  canReject: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <div className="hum-card flex flex-wrap items-center justify-between gap-3 p-4" aria-label="计划确认">
      <p className="text-xs hum-muted">确认后仍需由受控任务入口创建 pending 工单。</p>
      <div className="flex gap-2">
        <button type="button" className="hum-btn is-danger" disabled={!canReject} onClick={onReject}>拒绝计划</button>
        <button type="button" className="hum-btn is-primary" disabled={!canConfirm} onClick={onConfirm}>确认计划</button>
      </div>
    </div>
  );
}

function formatCost(cost: number | null): string {
  return cost === null ? '成本待核实' : `预估 ¥${cost.toFixed(2)}`;
}
