import { useState } from 'react';
import type { ExecutionNodePort } from '../execution-nodes/executionNodeClient';
import type { Planner, PlanRequest } from '../planning/planner';
import type { SessionPlan } from '../sessions/model/session';
import StartWorkPage from './StartWorkPage';
import {
  adaptSessionPlanToStartWorkPlan,
  createStartWorkDispatchIntent,
  type StartWorkDispatchIntent,
  type StartWorkDispatchIntentPort,
} from './startWorkDispatch';
import type { StartWorkPlan } from './startWorkPlan';

export interface StartWorkFlowProps {
  planner: Planner;
  nodePort?: Pick<ExecutionNodePort, 'list'>;
  decisionActorRef?: string;
  tenantId?: string;
  planDefaults?: Omit<PlanRequest, 'input'>;
  dispatchIntentPort?: StartWorkDispatchIntentPort;
  now?: () => string;
}

export default function StartWorkFlow({
  planner,
  nodePort,
  decisionActorRef = 'human:operator',
  tenantId = 'tenant_demo',
  planDefaults = {},
  dispatchIntentPort,
  now = () => new Date().toISOString(),
}: StartWorkFlowProps) {
  const [plan, setPlan] = useState<StartWorkPlan | null>(null);
  const [sourcePlan, setSourcePlan] = useState<SessionPlan | null>(null);
  const [intent, setIntent] = useState<StartWorkDispatchIntent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestPlan = async (target: string) => {
    setError(null);
    setIntent(null);
    try {
      const [nextSourcePlan, nodes] = await Promise.all([
        planner.draft({ ...planDefaults, input: target }),
        nodePort?.list() ?? Promise.resolve([]),
      ]);
      setSourcePlan(nextSourcePlan);
      setPlan(adaptSessionPlanToStartWorkPlan(nextSourcePlan, nodes));
    } catch (cause) {
      setSourcePlan(null);
      setPlan(null);
      setError(cause instanceof Error ? cause.message : '计划生成失败');
    }
  };

  const decide = (decidedPlan: StartWorkPlan, decision: 'confirm' | 'reject') => {
    if (decision === 'reject') return;
    if (!sourcePlan || intent) return;
    try {
      const nextIntent = createStartWorkDispatchIntent({
        plan: { ...decidedPlan, status: 'pending', decidedBy: null, decidedAt: null },
        sourcePlan,
        tenantId,
        confirmedBy: decidedPlan.decidedBy ?? decisionActorRef,
        confirmedAt: decidedPlan.decidedAt ?? now(),
      });
      setError(null);
      setIntent(nextIntent);
      void Promise.resolve(dispatchIntentPort?.record(nextIntent)).catch((cause) => {
        setIntent(null);
        setPlan({
          ...decidedPlan,
          status: 'pending',
          decidedBy: null,
          decidedAt: null,
        });
        setError(cause instanceof Error ? cause.message : '派发适配器未能记录意图');
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法生成派发意图');
    }
  };

  return (
    <div className="min-h-full">
      <StartWorkPage
        plan={plan}
        decisionActorRef={decisionActorRef}
        now={now}
        onPlanRequest={(target) => { void requestPlan(target); }}
        onDecision={decide}
      />
      {intent ? <output className="sr-only" aria-label="待派发意图">{intent.envelope.idempotencyKey}</output> : null}
      {error ? <p className="mx-auto mb-4 max-w-3xl text-sm text-[var(--error)]" role="alert">{error}</p> : null}
    </div>
  );
}
