import { Clock, Users, FileInput, FileOutput, Target, CheckCircle2 } from 'lucide-react';
import type { CollabTask, TaskStatus } from '../../lib/types';
import { employees } from '../../data/employees';

const statusMeta: Record<
  TaskStatus,
  { label: string; bar: string; pill: string; ring: string }
> = {
  pending:        { label: '待开始',  bar: 'bg-neutral-300',  pill: 'bg-neutral-100 text-neutral-700 border-neutral-200', ring: 'ring-neutral-200' },
  in_progress:    { label: '进行中',  bar: 'bg-primary-500',  pill: 'bg-primary-50 text-primary-700 border-primary-200', ring: 'ring-primary-200' },
  waiting_approval: { label: '待审批', bar: 'bg-warning',     pill: 'bg-warning/10 text-warning border-warning/30', ring: 'ring-warning/30' },
  blocked:        { label: '已阻断',  bar: 'bg-error',        pill: 'bg-error/10 text-error border-error/30', ring: 'ring-error/30' },
  completed:      { label: '已完成',  bar: 'bg-success',      pill: 'bg-success/10 text-success border-success/30', ring: 'ring-success/30' },
  failed:         { label: '已失败',  bar: 'bg-error',        pill: 'bg-error/10 text-error border-error/30', ring: 'ring-error/30' },
  overdue:        { label: '已超期',  bar: 'bg-warning',      pill: 'bg-warning/10 text-warning border-warning/30', ring: 'ring-warning/30' },
};

function findEmp(id: string) {
  return employees.find((e) => e.id === id);
}

function countdown(due: string) {
  const target = new Date(due.replace(' ', 'T')).getTime();
  const now = Date.now();
  const diff = target - now;
  if (Number.isNaN(target)) return due;
  const sign = diff < 0 ? '逾期 ' : '剩 ';
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  if (h >= 24) return `${sign}${Math.floor(h / 24)}天 ${h % 24}h`;
  return `${sign}${h}h ${m}m`;
}

export default function TaskCard({
  task,
  compact = false,
}: {
  task: CollabTask;
  compact?: boolean;
}) {
  const meta = statusMeta[task.status];
  const owner = findEmp(task.ownerId);
  const collaborators = task.collaboratorIds.map(findEmp).filter(Boolean);

  return (
    <div
      className={`relative flex bg-white border border-neutral-200 rounded-lg overflow-hidden shadow-subtle hover:shadow-medium transition`}
    >
      <div className={`w-1 ${meta.bar}`} />
      <div className="flex-1 p-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                合同·任务卡 · {task.id}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${meta.pill}`}>
                {meta.label}
              </span>
              {task.priority === 'urgent' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border font-mono bg-error/10 text-error border-error/30">
                  URGENT
                </span>
              )}
            </div>
            <div className="mt-0.5 font-display text-sm font-semibold text-neutral-900 truncate">
              {task.title}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="flex items-center gap-1 text-[10px] font-mono text-neutral-500">
              <Clock size={10} /> {countdown(task.dueAt)}
            </div>
            <div className="text-[10px] font-mono text-neutral-400">
              截止 {task.dueAt.slice(5, 16)}
            </div>
          </div>
        </div>

        {!compact && (
          <>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-neutral-700">
              <div className="flex items-start gap-1">
                <Target size={11} className="mt-0.5 text-primary-500 shrink-0" />
                <span className="line-clamp-2">{task.goal}</span>
              </div>
              <div className="flex items-start gap-1">
                <CheckCircle2 size={11} className="mt-0.5 text-tertiary-500 shrink-0" />
                <span className="line-clamp-2">{task.acceptance.join(' · ')}</span>
              </div>
              <div className="flex items-start gap-1">
                <FileInput size={11} className="mt-0.5 text-secondary-500 shrink-0" />
                <span className="line-clamp-1 text-neutral-500">输入: {task.inputs.join('，')}</span>
              </div>
              <div className="flex items-start gap-1">
                <FileOutput size={11} className="mt-0.5 text-secondary-500 shrink-0" />
                <span className="line-clamp-1 text-neutral-500">产出: {task.outputs.join('，')}</span>
              </div>
            </div>

            <div className="mt-2 text-[10px] font-mono text-neutral-500">
              范围: <span className="text-neutral-700">{task.scope}</span>
            </div>
          </>
        )}

        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {owner && (
              <span
                title={`负责 · ${owner.name}`}
                className={`w-6 h-6 rounded-full bg-primary-500 text-white text-[11px] font-display font-semibold flex items-center justify-center ring-2 ${meta.ring}`}
              >
                {owner.avatar}
              </span>
            )}
            <div className="flex -space-x-1.5">
              {collaborators.slice(0, 4).map((c) => (
                <span
                  key={c!.id}
                  title={c!.name}
                  className="w-5 h-5 rounded-full bg-neutral-200 text-neutral-700 text-[10px] font-display font-semibold flex items-center justify-center border-2 border-white"
                >
                  {c!.avatar}
                </span>
              ))}
              {collaborators.length > 4 && (
                <span className="w-5 h-5 rounded-full bg-neutral-100 text-neutral-500 text-[9px] font-mono flex items-center justify-center border-2 border-white">
                  +{collaborators.length - 4}
                </span>
              )}
            </div>
            <Users size={11} className="text-neutral-400 ml-0.5" />
          </div>

          <div className="flex-1 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${meta.bar} transition-all`}
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-neutral-500 w-9 text-right">
              {task.progress}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
