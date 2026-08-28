import type { WorkOrderStatus } from '../model/workOrder';

const STATUS_META: Record<WorkOrderStatus, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-slate-100 text-slate-600' },
  submitted: { label: '待确认', className: 'bg-blue-50 text-blue-700' },
  approved: { label: '已分派', className: 'bg-cyan-50 text-cyan-700' },
  planned: { label: '执行计划已就绪', className: 'bg-indigo-50 text-indigo-700' },
  running: { label: '执行中', className: 'bg-emerald-50 text-emerald-700' },
  awaiting_approval: { label: '待人工审批', className: 'bg-amber-50 text-amber-800' },
  blocked: { label: '已阻断', className: 'bg-rose-50 text-rose-700' },
  delivered: { label: '待验收', className: 'bg-violet-50 text-violet-700' },
  accepted: { label: '已验收', className: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: '已打回', className: 'bg-rose-50 text-rose-700' },
  failed: { label: '执行失败', className: 'bg-rose-50 text-rose-700' },
  cancelled: { label: '已取消', className: 'bg-slate-100 text-slate-600' },
  archived: { label: '已归档', className: 'bg-slate-100 text-slate-500' },
};

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  const meta = STATUS_META[status];

  return (
    <span
      aria-label={`任务状态：${meta.label}`}
      className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
