/**
 * 我的 AI 同事 — 小周·一线销售运营 视角
 * 卡片列表（派活 / 催办 / 去验收）+ 我发起的任务
 */
import { useMemo, useState } from 'react';
import {
  Send, BellRing, ClipboardCheck, ListTodo, X, Bot, Clock,
} from 'lucide-react';
import WorkspacePage, { EmptyState } from './WorkspacePage';
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import type { CollabTask, Employee, TaskStatus } from '../../lib/types';

const STAFF_NAME = '小周';
const COLLEAGUE_IDS = ['emp-sales-1', 'emp-ops', 'emp-rest-1', 'emp-doc'];

const NUDGE_REPLY: Record<string, string> = {
  'emp-sales-1': '收到催办 · BD 邮件草稿 30 分钟内同步给您（当前进度 64%）',
  'emp-ops': '收到催办 · 618 复盘图表生成中，预计 1 小时内出 v4.1（当前 48%）',
  'emp-rest-1': '收到催办 · 已从休眠唤醒，10 分钟内接单',
  'emp-doc': '收到催办 · 当前空闲，可立即领取新任务',
};

const TASK_STATUS_META: Record<TaskStatus, { label: string; cls: string }> = {
  pending:          { label: '待领取',   cls: 'hum-chip' },
  in_progress:      { label: '进行中',   cls: 'hum-chip is-brand' },
  waiting_approval: { label: '待审批',   cls: 'hum-chip is-warning' },
  blocked:          { label: '已阻塞',   cls: 'hum-chip is-error' },
  completed:        { label: '已完成',   cls: 'hum-chip is-success' },
  failed:           { label: '验收未过', cls: 'hum-chip is-error' },
  overdue:          { label: '已超期',   cls: 'hum-chip is-error' },
};

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const nowStr = () => fmt(new Date());
const defaultDue = () => fmt(new Date(Date.now() + 3 * 24 * 3600 * 1000));

export default function StaffWorkspacePage() {
  const addTask = useAppStore((s) => s.addTask);
  const extraTasks = useAppStore((s) => s.extraTasks);
  const pushToast = useAppStore((s) => s.pushToast);
  const pushAudit = useAppStore((s) => s.pushAudit);
  const setActivePage = useAppStore((s) => s.setActivePage);

  const [assignTarget, setAssignTarget] = useState<Employee | null>(null);

  const colleagues = useMemo(
    () => COLLEAGUE_IDS.map((id) => employees.find((e) => e.id === id)).filter((e): e is Employee => Boolean(e)),
    [],
  );
  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), []);

  const nudge = (e: Employee) => {
    pushToast({ kind: 'info', title: `${e.name} 回复`, detail: NUDGE_REPLY[e.id] ?? '收到催办 · 稍后同步进展' });
  };

  const submitAssign = (target: Employee, title: string, desc: string, due: string) => {
    const task: CollabTask = {
      id: `tk-staff-${Date.now()}`,
      title,
      goal: desc || `由 ${STAFF_NAME} 派发的协作任务`,
      scope: `一线派单 · ${STAFF_NAME} 发起`,
      inputs: [desc ? `${STAFF_NAME} 提供的说明：${desc}` : `${STAFF_NAME} 口头说明`],
      outputs: ['交付物 · 与发起人约定'],
      acceptance: [`${STAFF_NAME} 验收确认`],
      ownerId: target.id,
      collaboratorIds: [],
      dueAt: due || defaultDue(),
      status: 'pending',
      progress: 0,
      channel: 'ch-q3',
      priority: 'normal',
      createdAt: nowStr(),
    };
    addTask(task);
    setAssignTarget(null);
    pushToast({ kind: 'success', title: `已派给 ${target.name}`, detail: `「${title}」· 期限 ${task.dueAt}` });
    pushAudit({
      actor: `${STAFF_NAME}（一线员工）`,
      action: '派活给数字员工',
      target: `${target.name} · ${title}`,
      result: 'ok',
      tags: ['staff', 'assign', 'ch-q3'],
    });
  };

  return (
    <WorkspacePage
      title="我的 AI 同事"
      sub={`${STAFF_NAME} · 一线销售运营 · 像用同事一样用 AI：派活、催办、验收，全程留痕`}
      actions={<span className="hum-chip is-brand"><Bot size={11} /> {colleagues.length} 位 AI 同事在线</span>}
    >
      <div className="p-6 space-y-6 max-w-[1080px]">
        {/* AI 同事卡片 */}
        <section>
          <div className="grid grid-cols-2 gap-3">
            {colleagues.map((e) => (
              <div key={e.id} className="hum-card p-4 hover:hum-elev-1 transition">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-lg grid place-items-center text-white text-[14px] font-semibold shrink-0" style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}>
                    {e.avatar}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-neutral-900">{e.name}</span>
                      <StatusChip status={e.status} />
                    </div>
                    <div className="text-[11px] hum-muted">{e.role} · {e.department}</div>
                  </div>
                </div>

                <div className="mt-3 hum-card-soft px-3 py-2">
                  <div className="text-[11px] text-neutral-700 truncate">{e.currentTask}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1 rounded-full bg-neutral-150 overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
                      <div className="h-full rounded-full" style={{ width: `${e.progress ?? 0}%`, background: 'var(--brand)' }} />
                    </div>
                    <span className="text-[10px] hum-faint hum-tabular w-8 text-right">{e.progress ?? 0}%</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 mt-3">
                  <button onClick={() => setAssignTarget(e)} className="hum-btn is-sm is-primary flex-1 justify-center">
                    <Send size={11} /> 派活
                  </button>
                  <button onClick={() => nudge(e)} className="hum-btn is-sm flex-1 justify-center">
                    <BellRing size={11} /> 催办
                  </button>
                  <button onClick={() => setActivePage('tasks')} className="hum-btn is-sm flex-1 justify-center">
                    <ClipboardCheck size={11} /> 去验收
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 我发起的任务 */}
        <section>
          <div className="flex items-center gap-1.5 mb-2.5">
            <ListTodo size={13} className="text-primary-600" />
            <span className="hum-h3">我发起的任务</span>
            <span className="hum-chip is-muted">{extraTasks.length}</span>
          </div>
          {extraTasks.length === 0 ? (
            <EmptyState
              icon={<ListTodo size={18} />}
              title="还没有发起过任务"
              sub="点击任意 AI 同事卡片上的「派活」，填写任务标题、说明和期限，任务会出现在这里和任务看板中"
            />
          ) : (
            <div className="hum-card overflow-hidden">
              {extraTasks.map((t, i) => {
                const owner = empMap.get(t.ownerId);
                const sm = TASK_STATUS_META[t.status] ?? TASK_STATUS_META.pending;
                return (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3" style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
                    <span className="w-7 h-7 rounded-md grid place-items-center text-white text-[11px] font-semibold shrink-0" style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}>
                      {owner?.avatar ?? 'A'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-medium text-neutral-900 truncate">{t.title}</div>
                      <div className="text-[11px] hum-muted truncate">{owner?.name ?? t.ownerId} · {t.goal}</div>
                    </div>
                    <span className="text-[10.5px] hum-faint font-mono shrink-0 hidden md:inline-flex items-center gap-1">
                      <Clock size={9} /> {t.dueAt}
                    </span>
                    <span className={`${sm.cls} shrink-0`}>{sm.label}</span>
                    <button onClick={() => setActivePage('tasks')} className="hum-btn is-sm is-ghost shrink-0">查看</button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {assignTarget && (
        <AssignModal
          target={assignTarget}
          onClose={() => setAssignTarget(null)}
          onSubmit={submitAssign}
        />
      )}
    </WorkspacePage>
  );
}

function AssignModal({
  target, onClose, onSubmit,
}: {
  target: Employee;
  onClose: () => void;
  onSubmit: (target: Employee, title: string, desc: string, due: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [due, setDue] = useState(defaultDue());

  const submit = () => {
    if (!title.trim()) return;
    onSubmit(target, title.trim(), desc.trim(), due.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(15,15,14,0.32)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl w-[440px] max-w-[92vw] overflow-hidden"
        style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="w-8 h-8 rounded-lg grid place-items-center text-white text-[12px] font-semibold" style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}>
            {target.avatar}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-neutral-900">派活给 {target.name}</div>
            <div className="text-[11px] hum-muted">任务将进入频道 ch-q3 · 全程可追溯</div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3.5">
          <div>
            <div className="hum-eyebrow mb-1.5">任务标题 *</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如「整理华东 5 家客户的报价对比表」"
              className="hum-input"
              autoFocus
            />
          </div>
          <div>
            <div className="hum-eyebrow mb-1.5">任务说明</div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="背景、输入材料、期望产出…"
              rows={3}
              className="hum-input resize-none"
            />
          </div>
          <div>
            <div className="hum-eyebrow mb-1.5">期限</div>
            <input value={due} onChange={(e) => setDue(e.target.value)} className="hum-input font-mono" />
          </div>
        </div>

        <div className="px-5 py-3 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={onClose} className="hum-btn is-sm">取消</button>
          <button onClick={submit} disabled={!title.trim()} className="hum-btn is-sm is-primary disabled:opacity-40 disabled:cursor-not-allowed">
            <Send size={11} /> 确认派活
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === 'working') return <span className="hum-chip is-success"><span className="hum-dot hum-pulse" style={{ background: 'var(--success)' }} /> 工作中</span>;
  if (status === 'blocked') return <span className="hum-chip is-error">阻塞</span>;
  if (status === 'meeting') return <span className="hum-chip is-brand">会议中</span>;
  if (status === 'training') return <span className="hum-chip is-warning">训练中</span>;
  return <span className="hum-chip">空闲</span>;
}
