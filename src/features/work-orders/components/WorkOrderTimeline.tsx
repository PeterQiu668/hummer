import type { WorkOrderStateChange } from '../model/workOrder';

const EVENT_LABELS: Record<string, string> = {
  'work_order.submitted': '任务已提交',
  'work_order.assigned': '任务已分派',
  'work_order.planned': '执行计划已就绪',
  'work_order.started': '任务已启动',
  'approval.requested': '已发起审批',
  'approval.decided': '审批已决策',
  'result_package.created': '结果包已生成',
  'result_package.accepted': '结果包已验收',
  'result_package.rejected': '结果包已驳回',
  'work_order.failed': '任务执行失败',
  'work_order.archived': '任务已归档',
};

function formatOccurredAt(occurredAt: string) {
  const date = new Date(occurredAt);

  if (Number.isNaN(date.getTime())) {
    return occurredAt;
  }

  const pad = (value: number) => value.toString().padStart(2, '0');

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

export function WorkOrderTimeline({ events }: { events: WorkOrderStateChange[] }) {
  const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence);

  return (
    <section aria-labelledby="work-order-timeline-heading">
      <h2 id="work-order-timeline-heading" className="text-sm font-semibold text-slate-800">
        执行时间线
      </h2>

      {orderedEvents.length === 0 ? (
        <p role="status" className="mt-3 text-sm text-slate-500">
          暂无执行事件
        </p>
      ) : (
        <ol aria-label="任务执行时间线" className="mt-4 space-y-0">
          {orderedEvents.map((event, index) => {
            const label = EVENT_LABELS[event.type] ?? `其他事件（${event.type}）`;

            return (
              <li
                key={`${event.sequence}-${event.type}-${event.occurredAt}`}
                aria-label={`事件 ${event.sequence}：${label}`}
                className="relative flex gap-3 pb-5 last:pb-0"
              >
                <div className="relative flex w-8 shrink-0 flex-col items-center">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700"
                  >
                    {event.sequence}
                  </span>
                  {index < orderedEvents.length - 1 ? (
                    <span aria-hidden="true" className="absolute top-8 h-full w-px bg-slate-200" />
                  ) : null}
                </div>

                <div className="min-w-0 pt-1">
                  <p className="text-sm font-medium text-slate-800">{label}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="font-mono text-slate-600">{event.actorRef}</span>
                    <time dateTime={event.occurredAt}>{formatOccurredAt(event.occurredAt)}</time>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
