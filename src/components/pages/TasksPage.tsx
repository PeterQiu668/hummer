/**
 * 工作任务（Kanban + 表格双视图）
 * 真实闭环：目标 → 分派 → 执行 → 提交验收 → 验收判定（通过/打回/转人工/降级）→ 交付
 * 合并 store.extraTasks（会议行动项 / 一线派活）；超期为展示层判定（不写回 store）
 */
import { useState, useMemo } from 'react';
import {
  Plus, LayoutGrid, Table2, Filter, Search, Clock, ArrowRight, ClipboardCheck,
} from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import { collabTasks } from '../../data/tasks';
import { employees } from '../../data/employees';
import { useAppStore } from '../../store/useAppStore';
import type { CollabTask, TaskStatus } from '../../lib/types';
import {
  STATUS_META, PRIORITY_META, FLOW_ACTION, Avatar, OverdueChip,
  isTaskOverdue, useTaskTransition,
} from '../work/taskFlow';
import TaskDrawer from '../work/TaskDrawer';

const COLUMN_ORDER: TaskStatus[] = ['pending', 'in_progress', 'waiting_approval', 'blocked', 'completed'];
/** failed / overdue 两列仅在有任务落入时出现，避免看板常态拥挤 */
const EXTRA_COLUMNS: TaskStatus[] = ['failed', 'overdue'];

export default function TasksPage() {
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const taskStatuses = useAppStore((s) => s.taskStatuses);
  const extraTasks = useAppStore((s) => s.extraTasks);
  const transition = useTaskTransition();

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), []);

  // 静态种子 + extraTasks（会议行动项 / 一线派活），再套 store 状态覆盖
  const tasks = useMemo(() => {
    return [...collabTasks, ...extraTasks].map((t) => ({
      ...t,
      status: (taskStatuses[t.id] as TaskStatus) ?? t.status,
    }));
  }, [taskStatuses, extraTasks]);

  const filtered = useMemo(
    () =>
      tasks.filter(
        (t) => q === '' || t.title.includes(q) || t.goal.includes(q) || (empMap.get(t.ownerId)?.name ?? '').includes(q),
      ),
    [tasks, q, empMap],
  );

  const byStatus = useMemo(() => {
    const m: Record<TaskStatus, CollabTask[]> = {
      pending: [], in_progress: [], waiting_approval: [], blocked: [], completed: [], failed: [], overdue: [],
    };
    for (const t of filtered) m[t.status]?.push(t);
    return m;
  }, [filtered]);

  const overdueCount = useMemo(() => filtered.filter(isTaskOverdue).length, [filtered]);
  const selected = selectedId ? filtered.find((t) => t.id === selectedId) ?? null : null;

  // 状态机动作（去掉旧单向 advance：waiting_approval 之后由验收工作台决定去向）
  const runFlowAction = (t: CollabTask) => {
    const fa = FLOW_ACTION[t.status];
    if (!fa) return;
    transition(t, fa.next, fa.audit);
  };

  return (
    <WorkspacePage
      title="工作任务"
      sub="目标 → 分派 → 执行 → 提交验收 → 验收判定 → 交付 · 一个闭环"
      actions={
        <>
          <div className="flex items-center hum-card-soft p-0.5 rounded-md">
            <button
              onClick={() => setView('kanban')}
              className={`hum-btn is-sm ${view === 'kanban' ? 'is-primary' : 'is-ghost'}`}
            >
              <LayoutGrid size={12} /> 看板
            </button>
            <button
              onClick={() => setView('table')}
              className={`hum-btn is-sm ${view === 'table' ? 'is-primary' : 'is-ghost'}`}
            >
              <Table2 size={12} /> 表格
            </button>
          </div>
          <button className="hum-btn is-sm">
            <Filter size={12} /> 筛选
          </button>
          <button className="hum-btn is-sm is-primary">
            <Plus size={12} /> 新建任务
          </button>
        </>
      }
      sticky={
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索任务标题、目标、负责员工…"
              className="hum-input pl-7"
            />
          </div>
          <span className="hum-chip is-muted">{filtered.length} / {tasks.length}</span>
          <span className="hum-chip is-warning">{byStatus.waiting_approval.length} 待验收</span>
          <span className="hum-chip is-error">{byStatus.blocked.length} 被阻断</span>
          {overdueCount > 0 && <span className="hum-chip is-error">{overdueCount} 已超期</span>}
        </div>
      }
    >
      <div className="p-6">
        {view === 'kanban' ? (
          <KanbanView byStatus={byStatus} empMap={empMap} onPick={(t) => setSelectedId(t.id)} onFlow={runFlowAction} />
        ) : (
          <TableView tasks={filtered} empMap={empMap} onPick={(t) => setSelectedId(t.id)} onFlow={runFlowAction} />
        )}
      </div>

      {selected && (
        <TaskDrawer task={selected} empMap={empMap} onClose={() => setSelectedId(null)} />
      )}
    </WorkspacePage>
  );
}

/* ─────────────────────────── 状态机操作按钮（卡片/表格共用） ─────────────────────────── */

function FlowButton({
  t, onPick, onFlow, asChip,
}: {
  t: CollabTask;
  onPick: (t: CollabTask) => void;
  onFlow: (t: CollabTask) => void;
  asChip?: boolean;
}) {
  const cls = asChip
    ? 'text-[11px] text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1'
    : 'hum-btn is-sm';
  if (t.status === 'waiting_approval') {
    return (
      <button onClick={(e) => { e.stopPropagation(); onPick(t); }} className={cls}>
        <ClipboardCheck size={11} /> 验收
      </button>
    );
  }
  const fa = FLOW_ACTION[t.status];
  if (!fa) return null;
  return (
    <button onClick={(e) => { e.stopPropagation(); onFlow(t); }} className={cls}>
      {fa.label} <ArrowRight size={11} />
    </button>
  );
}

/* ─────────────────────────── Kanban ─────────────────────────── */

function KanbanView({
  byStatus, empMap, onPick, onFlow,
}: {
  byStatus: Record<TaskStatus, CollabTask[]>;
  empMap: Map<string, any>;
  onPick: (t: CollabTask) => void;
  onFlow: (t: CollabTask) => void;
}) {
  const columns = [...COLUMN_ORDER, ...EXTRA_COLUMNS.filter((s) => byStatus[s].length > 0)];
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map((status) => {
        const meta = STATUS_META[status];
        const list = byStatus[status];
        return (
          <div key={status} className="hum-card-soft flex flex-col min-h-[60vh] overflow-hidden">
            <div
              className="px-3 py-2 flex items-center gap-2"
              style={{ background: meta.bg, borderBottom: `1px solid ${meta.bg}` }}
            >
              <span className="hum-dot" style={{ background: meta.color }} />
              <span className="text-[12px] font-semibold tracking-wide" style={{ color: meta.color }}>
                {meta.label}
              </span>
              <span className="flex-1" />
              <span className="text-[11px] font-mono" style={{ color: meta.color }}>{list.length}</span>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {list.map((t) => {
                const owner = empMap.get(t.ownerId);
                return (
                  <button
                    key={t.id}
                    onClick={() => onPick(t)}
                    className="w-full text-left hum-card hum-elev-1 p-3 hover:hum-elev-2 transition group"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-neutral-900 leading-snug">
                          {t.title}
                        </div>
                        <div className="text-[11px] hum-muted mt-1 line-clamp-2">{t.goal}</div>
                      </div>
                      <span className="flex flex-col items-end gap-1 shrink-0">
                        <span className={PRIORITY_META[t.priority].cls}>{PRIORITY_META[t.priority].label}</span>
                        <OverdueChip task={t} />
                      </span>
                    </div>
                    {/* Progress */}
                    <div className="mt-2.5">
                      <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${t.progress}%`,
                            background: STATUS_META[t.status].color,
                          }}
                        />
                      </div>
                    </div>
                    {/* Footer */}
                    <div className="mt-2 flex items-center gap-2">
                      <Avatar e={owner} />
                      {t.collaboratorIds.slice(0, 2).map((id) => (
                        <Avatar key={id} e={empMap.get(id)} small />
                      ))}
                      {t.collaboratorIds.length > 2 && (
                        <span className="text-[10px] hum-faint">+{t.collaboratorIds.length - 2}</span>
                      )}
                      <span className="flex-1" />
                      <span
                        className={`flex items-center gap-1 text-[10px] ${isTaskOverdue(t) ? 'text-error font-medium' : 'hum-muted'}`}
                      >
                        <Clock size={10} /> {t.dueAt.split(' ')[0].slice(5)}
                      </span>
                    </div>
                    {(t.status === 'waiting_approval' || FLOW_ACTION[t.status]) && (
                      <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <FlowButton t={t} onPick={onPick} onFlow={onFlow} asChip />
                      </div>
                    )}
                  </button>
                );
              })}
              {list.length === 0 && (
                <div className="text-[11px] hum-faint text-center py-6 italic">空</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Table ─────────────────────────── */

function TableView({
  tasks, empMap, onPick, onFlow,
}: {
  tasks: CollabTask[];
  empMap: Map<string, any>;
  onPick: (t: CollabTask) => void;
  onFlow: (t: CollabTask) => void;
}) {
  return (
    <div className="hum-card overflow-hidden hum-elev-1">
      <table className="w-full text-[12.5px]">
        <thead className="bg-neutral-50" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <tr className="text-[10.5px] uppercase tracking-wider text-neutral-500">
            <th className="text-left px-3 py-2 font-semibold">任务</th>
            <th className="text-left px-3 py-2 font-semibold">负责员工</th>
            <th className="text-left px-3 py-2 font-semibold">状态</th>
            <th className="text-left px-3 py-2 font-semibold">优先级</th>
            <th className="text-left px-3 py-2 font-semibold">进度</th>
            <th className="text-left px-3 py-2 font-semibold">截止</th>
            <th className="text-right px-3 py-2 font-semibold">操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t, i) => {
            const owner = empMap.get(t.ownerId);
            const meta = STATUS_META[t.status];
            const overdue = isTaskOverdue(t);
            return (
              <tr
                key={t.id}
                className="hover:bg-neutral-50 transition cursor-pointer"
                style={{ borderTop: i ? '1px solid var(--border-subtle)' : '' }}
                onClick={() => onPick(t)}
              >
                <td className="px-3 py-2">
                  <div className="text-[13px] font-medium text-neutral-900">{t.title}</div>
                  <div className="text-[11px] hum-faint truncate max-w-md">{t.goal}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar e={owner} small />
                    <span className="text-neutral-700">{owner?.name ?? '—'}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span
                      className="hum-chip"
                      style={{ background: meta.bg, color: meta.color, borderColor: 'transparent' }}
                    >
                      {meta.label}
                    </span>
                    <OverdueChip task={t} />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={PRIORITY_META[t.priority].cls}>{PRIORITY_META[t.priority].label}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1 rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${t.progress}%`, background: meta.color }}
                      />
                    </div>
                    <span className="text-[11px] font-mono hum-tabular text-neutral-600">{t.progress}%</span>
                  </div>
                </td>
                <td className={`px-3 py-2 hum-tabular ${overdue ? 'text-error font-medium' : 'text-neutral-600'}`}>
                  {t.dueAt.split(' ')[0]}
                </td>
                <td className="px-3 py-2 text-right">
                  <FlowButton t={t} onPick={onPick} onFlow={onFlow} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tasks.length === 0 && (
        <div className="text-[12px] hum-faint text-center py-8">未匹配到任务</div>
      )}
    </div>
  );
}
