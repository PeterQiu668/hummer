/**
 * 工作任务（Kanban + 表格双视图）
 * 真实闭环：目标 → 分派 → 执行 → 审批 → 交付
 */
import { useState, useMemo } from 'react';
import { motion, Reorder } from 'framer-motion';
import {
  Plus, LayoutGrid, Table2, Filter, Search, X, Clock, AlertTriangle,
  CheckCircle2, ChevronRight, FileText, Users2, ArrowRight,
  MessagesSquare, Calendar, Activity, Sparkles,
} from 'lucide-react';

// v8 · 任务详情接产出物 / 证据 / 关联对话 / 关联会议 / 审批 / 审计
function taskDeliverables(taskId: string): { name: string; size: string; who: string; approver: string; ts: string; color: string }[] {
  const map: Record<string, any[]> = {
    'tk-sales-q3': [
      { name: 'Q3 BD 邮件清单.xlsx',       size: '128KB', who: '雪·销售官', approver: '林·决策官', ts: '14:35', color: '#1E8F5C' },
      { name: '鲲鹏制造 BD-0623 草稿.docx', size: '24KB',  who: '雪·销售官', approver: '昆仑',       ts: '14:32', color: '#0F70B7' },
    ],
    'tk-legal-review': [
      { name: '主合同 v4 风险清单.docx', size: '56KB', who: '律·法务官', approver: '昆仑', ts: '14:18', color: '#0F70B7' },
    ],
    'tk-finance-block': [
      { name: '审批单 #FN-0623-08.pdf', size: '12KB', who: '砚·财务官', approver: '昆仑（待审）', ts: '14:33', color: '#C13D3D' },
    ],
  };
  return map[taskId] ?? [{ name: '初始任务卡.md', size: '4KB', who: '系统', approver: '—', ts: '今日', color: '#6B6B65' }];
}
function taskEvidence(taskId: string): { hash: string; ts: string; what: string; who: string }[] {
  return [
    { hash: '0x4af2', ts: '14:35:12', what: 'BD 邮件草稿生成 · 调用 BD 邮件 v3.2', who: '雪·销售官' },
    { hash: '0x82e0', ts: '14:32:08', what: 'CRM 客户分群查询', who: '雪·销售官' },
    { hash: '0xb44a', ts: '14:30:22', what: '昆仑审批通过', who: '昆仑' },
  ].slice(0, taskId === 'tk-finance-block' ? 1 : 3);
}
const taskMessageCount = (id: string) => id === 'tk-sales-q3' ? 18 : id === 'tk-legal-review' ? 7 : 4;
const taskMeetingCount = (id: string) => id === 'tk-sales-q3' ? 2 : id === 'tk-legal-review' ? 1 : 0;
const taskApprovalCount = (id: string) => id === 'tk-finance-block' ? 2 : 1;
const taskAuditCount = (id: string) => id === 'tk-sales-q3' ? 12 : id === 'tk-legal-review' ? 6 : 8;
import WorkspacePage from './WorkspacePage';
import { collabTasks } from '../../data/tasks';
import { employees } from '../../data/employees';
import { useAppStore } from '../../store/useAppStore';
import type { CollabTask, TaskStatus } from '../../lib/types';

const STATUS_META: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  pending:           { label: '待分派',  color: '#6B6B65', bg: '#F1F1ED' },
  in_progress:       { label: '执行中',  color: '#0F70B7', bg: '#E8F1FA' },
  waiting_approval:  { label: '待审批',  color: '#B07706', bg: '#FBF2DF' },
  blocked:           { label: '被阻断',  color: '#C13D3D', bg: '#FBEAEA' },
  completed:         { label: '已完成',  color: '#1E8F5C', bg: '#E6F5ED' },
};

const COLUMN_ORDER: TaskStatus[] = ['pending', 'in_progress', 'waiting_approval', 'blocked', 'completed'];

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  low:    { label: '低', cls: 'hum-chip' },
  normal: { label: '中', cls: 'hum-chip' },
  high:   { label: '高', cls: 'hum-chip is-warning' },
  urgent: { label: '紧急', cls: 'hum-chip is-error' },
};

export default function TasksPage() {
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<CollabTask | null>(null);
  const taskStatuses = useAppStore((s) => s.taskStatuses);
  const updateTaskStatus = useAppStore((s) => s.updateTaskStatus);
  const pushAudit = useAppStore((s) => s.pushAudit);
  const pushToast = useAppStore((s) => s.pushToast);

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), []);

  // Merge persisted overrides
  const tasks = useMemo(() => {
    return collabTasks.map((t) => ({
      ...t,
      status: (taskStatuses[t.id] as TaskStatus) ?? t.status,
    }));
  }, [taskStatuses]);

  const filtered = useMemo(
    () =>
      tasks.filter(
        (t) => q === '' || t.title.includes(q) || t.goal.includes(q) || (empMap.get(t.ownerId)?.name ?? '').includes(q),
      ),
    [tasks, q, empMap],
  );

  const byStatus = useMemo(() => {
    const m: Record<TaskStatus, CollabTask[]> = {
      pending: [], in_progress: [], waiting_approval: [], blocked: [], completed: [],
    };
    for (const t of filtered) m[t.status]?.push(t);
    return m;
  }, [filtered]);

  const advance = (t: CollabTask) => {
    const idx = COLUMN_ORDER.indexOf(t.status);
    const next = COLUMN_ORDER[Math.min(idx + 1, COLUMN_ORDER.length - 1)];
    if (next === t.status) return;
    updateTaskStatus(t.id, next);
    pushAudit({
      actor: '昆仑（您）', action: '任务推进', target: t.title,
      result: 'ok', tags: ['task', `from:${t.status}`, `to:${next}`],
    });
    pushToast({ kind: 'success', title: `${t.title} → ${STATUS_META[next].label}` });
  };

  return (
    <WorkspacePage
      title="工作任务"
      sub="目标 → 分派 → 执行 → 审批 → 交付 · 一个闭环"
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
          <span className="hum-chip is-warning">{byStatus.waiting_approval.length} 待审批</span>
          <span className="hum-chip is-error">{byStatus.blocked.length} 被阻断</span>
        </div>
      }
    >
      <div className="p-6">
        {view === 'kanban' ? (
          <KanbanView byStatus={byStatus} empMap={empMap} onPick={setSelected} onAdvance={advance} />
        ) : (
          <TableView tasks={filtered} empMap={empMap} onPick={setSelected} onAdvance={advance} />
        )}
      </div>

      {selected && (
        <TaskDrawer
          task={selected}
          empMap={empMap}
          onClose={() => setSelected(null)}
          onAdvance={() => {
            advance(selected);
            setSelected(null);
          }}
        />
      )}
    </WorkspacePage>
  );
}

/* ─────────────────────────── Kanban ─────────────────────────── */

function KanbanView({
  byStatus, empMap, onPick, onAdvance,
}: {
  byStatus: Record<TaskStatus, CollabTask[]>;
  empMap: Map<string, any>;
  onPick: (t: CollabTask) => void;
  onAdvance: (t: CollabTask) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-3">
      {COLUMN_ORDER.map((status) => {
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
                      <span className={PRIORITY_META[t.priority].cls}>{PRIORITY_META[t.priority].label}</span>
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
                      <span className="flex items-center gap-1 text-[10px] hum-muted">
                        <Clock size={10} /> {t.dueAt.split(' ')[0].slice(5)}
                      </span>
                    </div>
                    {status !== 'completed' && (
                      <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); onAdvance(t); }}
                          className="text-[11px] text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
                        >
                          推进 <ArrowRight size={11} />
                        </button>
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
  tasks, empMap, onPick, onAdvance,
}: {
  tasks: CollabTask[];
  empMap: Map<string, any>;
  onPick: (t: CollabTask) => void;
  onAdvance: (t: CollabTask) => void;
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
                  <span
                    className="hum-chip"
                    style={{ background: meta.bg, color: meta.color, borderColor: 'transparent' }}
                  >
                    {meta.label}
                  </span>
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
                <td className="px-3 py-2 text-neutral-600 hum-tabular">{t.dueAt.split(' ')[0]}</td>
                <td className="px-3 py-2 text-right">
                  {t.status !== 'completed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onAdvance(t); }}
                      className="hum-btn is-sm"
                    >
                      推进 <ArrowRight size={11} />
                    </button>
                  )}
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

/* ─────────────────────────── Task Drawer ─────────────────────────── */

function TaskDrawer({
  task, empMap, onClose, onAdvance,
}: {
  task: CollabTask;
  empMap: Map<string, any>;
  onClose: () => void;
  onAdvance: () => void;
}) {
  const owner = empMap.get(task.ownerId);
  const meta = STATUS_META[task.status];
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
      className="absolute top-0 right-0 bottom-0 w-[420px] z-40 bg-white flex flex-col"
      style={{ borderLeft: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-modal)' }}
    >
      <div className="px-5 py-4 flex items-start gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="hum-chip"
              style={{ background: meta.bg, color: meta.color, borderColor: 'transparent' }}
            >
              {meta.label}
            </span>
            <span className={PRIORITY_META[task.priority].cls}>{PRIORITY_META[task.priority].label}</span>
          </div>
          <h2 className="text-[15px] font-semibold text-neutral-900">{task.title}</h2>
        </div>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <Field label="目标" value={task.goal} />
        <Field label="范围" value={task.scope} />
        <FieldList label="输入资料" items={task.inputs} />
        <FieldList label="输出格式" items={task.outputs} />
        <FieldList label="验收标准" items={task.acceptance} />

        <div>
          <div className="hum-eyebrow mb-1.5">协作员工</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Pill e={owner} role="owner" />
            {task.collaboratorIds.map((id) => (
              <Pill key={id} e={empMap.get(id)} role="collab" />
            ))}
          </div>
        </div>

        {/* v8 ── 产出物 + 证据链 + 关联对话/会议/审批/审计 + 复盘回写 ── */}
        <div>
          <div className="hum-eyebrow mb-1.5 flex items-center gap-1.5">
            <FileText size={11} /> 产出物（{taskDeliverables(task.id).length}）
          </div>
          <div className="space-y-1.5">
            {taskDeliverables(task.id).map((d) => (
              <div key={d.name} className="hum-card-soft p-2.5">
                <div className="flex items-center gap-2">
                  <FileText size={12} style={{ color: d.color }} />
                  <span className="flex-1 text-[12px] font-medium text-neutral-900 truncate">{d.name}</span>
                  <span className="text-[10px] hum-faint font-mono">{d.size}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] hum-faint font-mono">
                  <span>生成 {d.who}</span>
                  <span>·</span>
                  <span>审 {d.approver}</span>
                  <span>·</span>
                  <span>{d.ts}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="hum-eyebrow mb-1.5">证据链（hash / 时间 / 责任人）</div>
          <div className="hum-card-soft p-2.5 space-y-1 text-[11px]">
            {taskEvidence(task.id).map((e, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="font-mono text-primary-700 w-14 shrink-0">{e.hash}</span>
                <span className="font-mono hum-faint w-16 shrink-0">{e.ts}</span>
                <span className="flex-1 text-neutral-700 truncate">{e.what}</span>
                <span className="text-neutral-500 shrink-0">{e.who}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="hum-card-soft p-2.5">
            <div className="hum-eyebrow mb-1 flex items-center gap-1"><MessagesSquare size={10} /> 关联对话</div>
            <div className="text-[11.5px] text-primary-700 font-mono">#{task.channel}</div>
            <div className="text-[10.5px] hum-faint mt-0.5">{taskMessageCount(task.id)} 条消息</div>
          </div>
          <div className="hum-card-soft p-2.5">
            <div className="hum-eyebrow mb-1 flex items-center gap-1"><Calendar size={10} /> 关联会议</div>
            <div className="text-[11.5px] text-secondary-700">{taskMeetingCount(task.id)} 场会议</div>
            <div className="text-[10.5px] hum-faint mt-0.5">含纪要 + 行动项</div>
          </div>
          <div className="hum-card-soft p-2.5">
            <div className="hum-eyebrow mb-1 flex items-center gap-1"><CheckCircle2 size={10} /> 审批</div>
            <div className="text-[11.5px] text-success">{taskApprovalCount(task.id)} 节点</div>
            <div className="text-[10.5px] hum-faint mt-0.5">含四眼原则 + 人审</div>
          </div>
          <div className="hum-card-soft p-2.5">
            <div className="hum-eyebrow mb-1 flex items-center gap-1"><Activity size={10} /> 审计</div>
            <div className="text-[11.5px] text-neutral-900">{taskAuditCount(task.id)} 条事件</div>
            <div className="text-[10.5px] hum-faint mt-0.5">Append-only 入链</div>
          </div>
        </div>

        <div className="hum-card-soft p-3" style={{ borderLeft: '3px solid var(--secondary-DEFAULT, #7E22CE)' }}>
          <div className="hum-eyebrow mb-1.5 flex items-center gap-1.5">
            <Sparkles size={11} className="text-secondary-600" /> 复盘与 SOP 回写
          </div>
          <div className="text-[11.5px] text-neutral-700 leading-relaxed">
            完成后将自动复盘：bad case 入 <b>质量与复盘</b> 队列；改进项写回 <b>知识中枢</b> SOP 库；
            下次执行时由相应 Agent 自动调用。
          </div>
        </div>

        <div>
          <div className="hum-eyebrow mb-1.5">进度</div>
          <div className="hum-card-soft p-3">
            <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${task.progress}%`, background: meta.color }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] hum-muted mt-2">
              <span>{task.progress}% · 启动 {task.createdAt}</span>
              <span>截止 {task.dueAt}</span>
            </div>
          </div>
        </div>

        <div className="hum-card-soft p-3">
          <div className="hum-eyebrow mb-2">最近操作</div>
          <div className="space-y-1.5">
            {[
              { ts: '14:35', act: '雪·销售官 生成 BD 邮件草稿', icon: <FileText size={11} /> },
              { ts: '14:28', act: '昆仑 批准外发预算', icon: <CheckCircle2 size={11} className="text-success" /> },
              { ts: '14:11', act: '林·决策官 分派任务', icon: <Users2 size={11} /> },
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px] text-neutral-700">
                <span className="text-neutral-400">{r.icon}</span>
                <span className="hum-mono text-[10.5px] text-neutral-400 font-mono w-10">{r.ts}</span>
                <span className="flex-1">{r.act}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <button className="hum-btn is-sm flex-1 justify-center">查看审计</button>
        <button className="hum-btn is-sm flex-1 justify-center">打开对话</button>
        {task.status !== 'completed' && (
          <button onClick={onAdvance} className="hum-btn is-sm is-primary flex-1 justify-center">
            推进 <ChevronRight size={12} />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="hum-eyebrow mb-1">{label}</div>
      <div className="text-[12.5px] text-neutral-700 leading-relaxed">{value}</div>
    </div>
  );
}
function FieldList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="hum-eyebrow mb-1.5">{label}</div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-[12.5px] text-neutral-700 flex items-start gap-1.5">
            <span className="text-neutral-300 mt-1.5">·</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
function Avatar({ e, small }: { e: any; small?: boolean }) {
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
function Pill({ e, role }: { e: any; role: 'owner' | 'collab' }) {
  if (!e) return null;
  return (
    <span className="flex items-center gap-1.5 px-2 py-1 rounded-md hum-card-soft">
      <Avatar e={e} small />
      <span className="text-[12px] text-neutral-700">{e.name}</span>
      <span className="text-[10px] hum-faint">{role === 'owner' ? '负责' : '协作'}</span>
    </span>
  );
}
