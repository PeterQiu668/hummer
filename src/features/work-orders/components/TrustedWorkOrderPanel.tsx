import { useMemo, useState } from 'react';
import { Check, FileCheck2, ShieldAlert, Sparkles, X } from 'lucide-react';
import {
  createDemoWorkOrder,
  transitionWorkOrder,
  type WorkOrder,
  type WorkOrderCommandType,
  type WorkOrderStateChange,
} from '../model/workOrder';
import { createDemoResultPackage, type ResultPackage } from '../model/resultPackage';
import { WorkOrderStatusBadge } from './WorkOrderStatusBadge';
import { WorkOrderTimeline } from './WorkOrderTimeline';

const ACTOR_REF = 'human:boss_demo';
const COMMAND_LABELS: Partial<Record<WorkOrderCommandType, string>> = {
  submit: '提交军令状',
  approve_assignment: '确认分派',
  plan: '生成执行计划',
  start: '开始受控执行',
  request_approval: '申请合成 CRM 回写',
  approve_approval: '批准合成回写',
  reject_approval: '拒绝合成回写',
  deliver: '生成成果包',
  accept: '验收通过',
  reject: '打回成果包',
  request_rework: '重新规划',
};

export function TrustedWorkOrderPanel() {
  const [title, setTitle] = useState('研究 10 家合成目标客户');
  const [goal, setGoal] = useState('输出客户优先级、触达建议与可验收成果包');
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [events, setEvents] = useState<WorkOrderStateChange[]>([]);
  const [resultPackage, setResultPackage] = useState<ResultPackage | null>(null);
  const [writeApprovalGranted, setWriteApprovalGranted] = useState(false);

  const nextActions = useMemo(() => getNextActions(order, writeApprovalGranted), [order, writeApprovalGranted]);

  const createOrder = () => {
    const nextOrder = createDemoWorkOrder({
      id: `wo_demo_${Date.now()}`,
      title: title.trim() || '未命名合成 GTM 任务',
      goal: goal.trim() || '输出可验收的 GTM 研究成果包',
      ownerActorRef: ACTOR_REF,
      assignedEmployeeId: 'employee:gtm_researcher',
    });
    setOrder(nextOrder);
    setEvents([]);
    setResultPackage(null);
    setWriteApprovalGranted(false);
  };

  const runCommand = (type: WorkOrderCommandType) => {
    if (!order) return;

    const result = transitionWorkOrder(order, {
      type,
      actorRef: ACTOR_REF,
      expectedVersion: order.version,
      idempotencyKey: `ui-${order.id}-${type}-${order.version}`,
      occurredAt: new Date().toISOString(),
    });
    if (!result.ok || result.replayed) return;

    setOrder(result.order);
    setEvents((current) => [...current, result.event]);

    if (type === 'deliver') {
      setResultPackage(createDemoResultPackage({ workOrderId: result.order.id, updatedAt: result.event.occurredAt }));
    }
    if (type === 'approve_approval') {
      setWriteApprovalGranted(true);
    }
    if (type === 'reject_approval') {
      setWriteApprovalGranted(false);
    }
    if (type === 'accept') {
      setResultPackage((current) => current && acceptResultPackage(current, result.event.occurredAt));
    }
    if (type === 'reject') {
      setResultPackage((current) => current && rejectResultPackage(current, result.event.occurredAt));
    }
  };

  return (
    <section id="trusted-work-order" className="hum-card hum-elev-1 p-4" aria-labelledby="trusted-work-order-heading">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="hum-eyebrow flex items-center gap-1.5"><Sparkles size={12} /> 可信 MVP 演示</div>
          <h2 id="trusted-work-order-heading" className="mt-1 text-[15px] font-semibold text-neutral-900">
            合成 GTM 工作区
          </h2>
          <p className="mt-1 text-[12px] hum-muted">
            演示数据，仅验证任务军令状、审批、成果包与验收链路；不会访问或写入真实 CRM。
          </p>
        </div>
        {order && <WorkOrderStatusBadge status={order.status} />}
      </div>

      {!order ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <label className="block text-[12px] font-medium text-neutral-700">
            任务名称
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="hum-input mt-1" />
          </label>
          <label className="block text-[12px] font-medium text-neutral-700">
            目标
            <input value={goal} onChange={(event) => setGoal(event.target.value)} className="hum-input mt-1" />
          </label>
          <button onClick={createOrder} className="hum-btn is-primary whitespace-nowrap">
            <FileCheck2 size={14} /> 生成 WorkOrder
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div className="space-y-3">
            <div className="hum-card-soft p-3">
              <div className="text-[13px] font-medium text-neutral-900">{order.title}</div>
              <div className="mt-1 text-[12px] hum-muted">{order.goal}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] hum-faint">
                <span>负责人：{order.ownerActorRef}</span>
                <span>数字员工：{order.assignedEmployeeId}</span>
                <span>版本：{order.version}</span>
              </div>
            </div>

            {order.status === 'awaiting_approval' && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                <ShieldAlert size={15} className="mt-0.5 shrink-0" />
                <span>模拟写入已阻断，等待人工决定。</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {nextActions.map((type) => (
                <button
                  key={type}
                  onClick={() => runCommand(type)}
                  className={`hum-btn is-sm ${type === 'approve_approval' || type === 'accept' ? 'is-primary' : type === 'reject_approval' || type === 'reject' ? 'is-danger' : ''}`}
                >
                  {type === 'accept' ? <Check size={12} /> : type === 'reject' || type === 'reject_approval' ? <X size={12} /> : null}
                  {COMMAND_LABELS[type]}
                </button>
              ))}
            </div>

            {resultPackage && <ResultPackageSummary resultPackage={resultPackage} />}
          </div>

          <div className="hum-card-soft p-3">
            <WorkOrderTimeline events={events} />
          </div>
        </div>
      )}
    </section>
  );
}

function ResultPackageSummary({ resultPackage }: { resultPackage: ResultPackage }) {
  const allPassed = resultPackage.acceptanceCriteria.every((criterion) => criterion.verdict === 'passed');

  return (
    <div className="hum-card-soft p-3">
      <div className="flex items-center gap-2">
        <FileCheck2 size={14} className="text-primary-700" />
        <span className="text-[12.5px] font-semibold text-neutral-900">ResultPackage</span>
        <span className="hum-chip is-muted">{resultPackage.status === 'accepted' ? '已验收' : resultPackage.status === 'rejected' ? '已打回' : '待验收'}</span>
      </div>
      <p className="mt-1.5 text-[12px] hum-muted">{resultPackage.summary}</p>
      <div className="mt-2 grid gap-1 text-[11px] text-neutral-600 sm:grid-cols-2">
        <span>证据：{resultPackage.evidenceRefs.join('、')}</span>
        <span>成本：¥{resultPackage.cost.totalCostCny.toFixed(2)}</span>
        <span>风险：{resultPackage.risk.level}</span>
        <span>验收：{allPassed ? '全部通过' : '待判定'}</span>
      </div>
      <div className="mt-2 text-[11px] hum-faint">回滚：{resultPackage.rollback.instructions}</div>
    </div>
  );
}

function getNextActions(order: WorkOrder | null, writeApprovalGranted: boolean): WorkOrderCommandType[] {
  if (!order) return [];

  switch (order.status) {
    case 'draft': return ['submit'];
    case 'submitted': return ['approve_assignment'];
    case 'approved': return ['plan'];
    case 'planned': return ['start'];
    case 'running': return writeApprovalGranted ? ['deliver'] : ['request_approval'];
    case 'awaiting_approval': return ['approve_approval', 'reject_approval'];
    case 'delivered': return ['accept', 'reject'];
    case 'rejected': return ['request_rework'];
    default: return [];
  }
}

function acceptResultPackage(resultPackage: ResultPackage, updatedAt: string): ResultPackage {
  return {
    ...resultPackage,
    status: 'accepted',
    acceptanceCriteria: resultPackage.acceptanceCriteria.map((criterion) => ({ ...criterion, verdict: 'passed' })),
    updatedAt,
  };
}

function rejectResultPackage(resultPackage: ResultPackage, updatedAt: string): ResultPackage {
  return {
    ...resultPackage,
    status: 'rejected',
    acceptanceCriteria: resultPackage.acceptanceCriteria.map((criterion) => ({ ...criterion, verdict: 'failed' })),
    updatedAt,
  };
}
