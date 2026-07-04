/**
 * 任务详情抽屉 — 从 TasksPage 拆出
 * 验收标准 = AcceptancePanel（验收工作台）；交付物条目可「去证据库发起出口」
 * 状态机：waiting_approval 之后由验收决定去向；blocked 可解除阻断
 */
import { motion } from 'framer-motion';
import {
  X, Clock, CheckCircle2, ChevronRight, FileText, Users2,
  MessagesSquare, Calendar, Activity, Sparkles, ExternalLink,
} from 'lucide-react';
import type { CollabTask } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import {
  STATUS_META, PRIORITY_META, FLOW_ACTION, Avatar, OverdueChip, useTaskTransition,
} from './taskFlow';
import AcceptancePanel from './AcceptancePanel';

/* ── v8 · 任务详情接产出物 / 证据 / 关联对话 / 会议 / 审批 / 审计 ── */
interface DeliverableRow { name: string; size: string; who: string; approver: string; ts: string; color: string }
function taskDeliverables(taskId: string): DeliverableRow[] {
  const map: Record<string, DeliverableRow[]> = {
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

interface EmpLike { name: string; avatar: string }

export default function TaskDrawer({
  task, empMap, onClose,
}: {
  task: CollabTask;
  empMap: Map<string, EmpLike>;
  onClose: () => void;
}) {
  const owner = empMap.get(task.ownerId);
  const meta = STATUS_META[task.status];
  const setActivePage = useAppStore((s) => s.setActivePage);
  const pushToast = useAppStore((s) => s.pushToast);
  const transition = useTaskTransition();
  const flowAction = FLOW_ACTION[task.status];

  const goEvidence = (name: string) => {
    setActivePage('evidence');
    pushToast({ kind: 'info', title: '已切换到证据库', detail: `可对「${name}」发起交付出口（发送客户 / 回写 CRM / 发布）` });
    onClose();
  };

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
            <span className="hum-chip" style={{ background: meta.bg, color: meta.color, borderColor: 'transparent' }}>
              {meta.label}
            </span>
            <span className={PRIORITY_META[task.priority].cls}>{PRIORITY_META[task.priority].label}</span>
            <OverdueChip task={task} />
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

        {/* 验收工作台（替换原静态验收标准列表） */}
        <AcceptancePanel task={task} onDone={onClose} />

        <div>
          <div className="hum-eyebrow mb-1.5">协作员工</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Pill e={owner} role="owner" />
            {task.collaboratorIds.map((id) => (
              <Pill key={id} e={empMap.get(id)} role="collab" />
            ))}
          </div>
        </div>

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
                  <span className="flex-1" />
                  <button
                    onClick={() => goEvidence(d.name)}
                    className="flex items-center gap-1 text-primary-700 hover:text-primary-600 font-medium"
                    style={{ fontFamily: 'inherit' }}
                  >
                    <ExternalLink size={10} /> 去证据库发起出口
                  </button>
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
              <span className="flex items-center gap-1"><Clock size={10} /> 截止 {task.dueAt}</span>
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
        {task.status === 'waiting_approval' ? (
          <span className="flex-1 text-center text-[10.5px] hum-faint leading-tight">
            由上方验收标准<br />判定决定去向
          </span>
        ) : flowAction ? (
          <button
            onClick={() => { transition(task, flowAction.next, flowAction.audit); onClose(); }}
            className="hum-btn is-sm is-primary flex-1 justify-center"
          >
            {flowAction.label} <ChevronRight size={12} />
          </button>
        ) : null}
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
function Pill({ e, role }: { e: EmpLike | undefined; role: 'owner' | 'collab' }) {
  if (!e) return null;
  return (
    <span className="flex items-center gap-1.5 px-2 py-1 rounded-md hum-card-soft">
      <Avatar e={e} small />
      <span className="text-[12px] text-neutral-700">{e.name}</span>
      <span className="text-[10px] hum-faint">{role === 'owner' ? '负责' : '协作'}</span>
    </span>
  );
}
