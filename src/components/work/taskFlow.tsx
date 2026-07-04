/**
 * components/work/taskFlow — 任务闭环共享元数据 + 状态机 helper
 * 状态机：pending → in_progress → waiting_approval →（由验收判定决定去向）
 *        blocked 可「解除阻断」回 in_progress；超期为展示层判定，不写回 store
 */
import type { CollabTask, RoleKey, TaskStatus } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';

export const ROLE_NAMES: Record<RoleKey, string> = {
  boss: '昆仑 · 老板',
  exec: '吴帆 · 销售 VP',
  staff: '小周 · 一线',
  expert: '林知远 · 专家',
  auditor: '合规审计员',
};

/** 演示用固定「当前时间」：与 mock 数据时间线（2026-06-23/24）对齐 */
export const MOCK_NOW = '2026-06-24 14:40';

export const isTaskOverdue = (t: CollabTask): boolean =>
  t.status !== 'completed' && t.status !== 'failed' && t.dueAt < MOCK_NOW;

export const STATUS_META: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  pending:           { label: '待分派',  color: '#6B6B65', bg: '#F1F1ED' },
  in_progress:       { label: '执行中',  color: '#0F70B7', bg: '#E8F1FA' },
  waiting_approval:  { label: '待验收',  color: '#B07706', bg: '#FBF2DF' },
  blocked:           { label: '被阻断',  color: '#C13D3D', bg: '#FBEAEA' },
  completed:         { label: '已完成',  color: '#1E8F5C', bg: '#E6F5ED' },
  failed:            { label: '已失败',  color: '#C13D3D', bg: '#FBEAEA' },
  overdue:           { label: '已超期',  color: '#C13D3D', bg: '#FBEAEA' },
};

export const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  low:    { label: '低', cls: 'hum-chip' },
  normal: { label: '中', cls: 'hum-chip' },
  high:   { label: '高', cls: 'hum-chip is-warning' },
  urgent: { label: '紧急', cls: 'hum-chip is-error' },
};

/** 各状态的下一步动作（waiting_approval 之后由验收工作台决定去向，无单向推进） */
export const FLOW_ACTION: Partial<Record<TaskStatus, { label: string; next: TaskStatus; audit: string }>> = {
  pending:     { label: '开始执行', next: 'in_progress',      audit: '任务启动' },
  in_progress: { label: '提交验收', next: 'waiting_approval', audit: '提交验收' },
  blocked:     { label: '解除阻断', next: 'in_progress',      audit: '解除阻断' },
};

export interface TransitionOpts {
  result?: 'ok' | 'blocked' | 'pending' | 'warning';
  tags?: string[];
  /** 附加说明，会拼进审计 target（如打回原因） */
  note?: string;
  toastKind?: 'success' | 'info' | 'warning' | 'error';
  toastTitle?: string;
  toastDetail?: string;
}

/** 统一的状态迁移：写 store 状态 + 审计留痕 + toast 反馈（操作人 = 当前角色） */
export function useTaskTransition() {
  const updateTaskStatus = useAppStore((s) => s.updateTaskStatus);
  const pushAudit = useAppStore((s) => s.pushAudit);
  const pushToast = useAppStore((s) => s.pushToast);
  const currentRole = useAppStore((s) => s.currentRole);

  return (t: CollabTask, next: TaskStatus, action: string, opts: TransitionOpts = {}) => {
    updateTaskStatus(t.id, next);
    pushAudit({
      actor: ROLE_NAMES[currentRole],
      action,
      target: opts.note ? `${t.title} · ${opts.note}` : t.title,
      result: opts.result ?? 'ok',
      tags: opts.tags ?? ['task', `to:${next}`],
    });
    pushToast({
      kind: opts.toastKind ?? 'success',
      title: opts.toastTitle ?? `${t.title} → ${STATUS_META[next].label}`,
      detail: opts.toastDetail,
    });
  };
}

/* ── 小组件（Kanban / 表格 / 抽屉共用）── */

export function Avatar({ e, small }: { e: { name: string; avatar: string } | undefined; small?: boolean }) {
  const sz = small ? 'w-5 h-5 text-[10px]' : 'w-6 h-6 text-[11px]';
  if (!e) return <span className={`${sz} rounded-full bg-neutral-200 inline-block`} />;
  return (
    <span
      className={`${sz} rounded-full grid place-items-center text-white font-semibold`}
      style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}
      title={e.name}
    >
      {e.avatar}
    </span>
  );
}

export function OverdueChip({ task }: { task: CollabTask }) {
  if (!isTaskOverdue(task)) return null;
  return <span className="hum-chip is-error" style={{ padding: '1px 6px', fontSize: 10 }}>已超期</span>;
}
