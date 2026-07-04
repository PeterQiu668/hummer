import { useEffect, useRef } from 'react';
import {
  AlertOctagon,
  Sparkles,
  Workflow,
  FileText,
  AtSign,
  Wrench,
  CheckCircle2,
} from 'lucide-react';
import type { FeishuMessage, CollabTask } from '../../lib/types';
import TaskCard from './TaskCard';

type AnyMsg = FeishuMessage & {
  taskCard?: CollabTask;
  riskAlertId?: string;
  toolCall?: { tool: string; args: string };
};

const roleStyle: Record<
  FeishuMessage['senderRole'],
  { bg: string; text: string; chip: string }
> = {
  human:    { bg: 'bg-primary-500',                    text: 'text-white', chip: 'bg-primary-50 text-primary-700' },
  manager:  { bg: 'bg-gradient-to-br from-primary-500 to-secondary-500', text: 'text-white', chip: 'bg-secondary-50 text-secondary-700' },
  worker:   { bg: 'bg-tertiary-500',                   text: 'text-white', chip: 'bg-tertiary-50 text-tertiary-700' },
  hermes:   { bg: 'bg-gradient-to-br from-secondary-500 to-warning', text: 'text-white', chip: 'bg-warning/10 text-warning' },
  guardian: { bg: 'bg-error',                          text: 'text-white', chip: 'bg-error/10 text-error' },
  expert:   { bg: 'bg-neutral-800',                    text: 'text-white', chip: 'bg-neutral-100 text-neutral-700' },
};

// v8 · 9 种消息类型 (brief 第六条)
const typeIcon: Record<string, React.ReactNode> = {
  msg:        null,                                                          // 1. 老板/普通输入
  translate:  <AtSign size={11} className="text-primary-500" />,              // 2. 昆仑转译
  decompose:  <Workflow size={11} className="text-secondary-500" />,          // 3. 高管分身拆解
  confirm:    <CheckCircle2 size={11} className="text-tertiary-500" />,       // 4. 高管确认
  task:       <Workflow size={11} className="text-primary-500" />,            // 5. Agent 执行
  tool_call:  <Wrench size={11} className="text-tertiary-500" />,             // 6. MCP 工具调用
  approval:   <FileText size={11} className="text-warning" />,                // 7. 审批请求
  deliverable:<FileText size={11} className="text-success" />,                // 8. 产出物生成
  evidence:   <CheckCircle2 size={11} className="text-success" />,            // 9. 证据归档
  // legacy
  alert:      <AlertOctagon size={11} className="text-error" />,
  evolution:  <Sparkles size={11} className="text-secondary-500" />,
  mention:    <AtSign size={11} className="text-primary-500" />,
};

const TYPE_LABEL: Record<string, string> = {
  translate:   '昆仑转译',
  decompose:   '高管拆解',
  confirm:     '高管确认',
  tool_call:   'MCP 调用',
  approval:    '审批',
  deliverable: '产出',
  evidence:    '证据归档',
  alert:       '阻断',
  evolution:   '复盘',
};

export default function MessageStream({
  messages,
  onRiskClick,
}: {
  messages: AnyMsg[];
  onRiskClick?: (riskId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length]);

  return (
    <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-neutral-50/50">
      {messages.map((m) => (
        <MessageRow key={m.id} m={m} onRiskClick={onRiskClick} />
      ))}
    </div>
  );
}

function MessageRow({
  m,
  onRiskClick,
}: {
  m: AnyMsg;
  onRiskClick?: (riskId: string) => void;
}) {
  const style = roleStyle[m.senderRole];

  return (
    <div className="flex gap-2.5 group">
      <div
        className={`shrink-0 w-8 h-8 rounded-md ${style.bg} ${style.text} flex items-center justify-center font-display font-semibold text-xs shadow-subtle`}
      >
        {m.avatar}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-display font-medium text-neutral-900">
            {m.sender}
          </span>
          <span className="text-[10px] font-mono text-neutral-400">{m.ts}</span>
          {typeIcon[m.type]}
          {TYPE_LABEL[m.type] && (
            <span className={`text-[9.5px] font-mono px-1.5 rounded ${style.chip}`}>{TYPE_LABEL[m.type]}</span>
          )}
          {m.senderRole === 'guardian' && (
            <span className={`text-[9px] font-mono px-1.5 rounded ${style.chip}`}>守护者</span>
          )}
          {m.senderRole === 'human' && (
            <span className={`text-[9px] font-mono px-1.5 rounded ${style.chip}`}>老板</span>
          )}
        </div>

        {m.type === 'alert' ? (
          <div
            onClick={() => m.riskAlertId && onRiskClick?.(m.riskAlertId)}
            className="mt-1 inline-flex items-start gap-2 px-3 py-2 rounded-md border border-error/40 bg-error/5 text-error text-[12px] cursor-pointer hover:bg-error/10 transition max-w-[640px]"
          >
            <AlertOctagon size={14} className="mt-0.5 shrink-0" />
            <span>{m.content}</span>
            {m.riskAlertId && (
              <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-error text-white shrink-0">
                点击审批
              </span>
            )}
          </div>
        ) : m.type === 'evolution' ? (
          <div className="mt-1 inline-flex items-start gap-2 px-3 py-2 rounded-md border border-secondary-200 bg-secondary-50/60 text-secondary-700 text-[12px] max-w-[640px]">
            <Sparkles size={12} className="mt-0.5 shrink-0" />
            <span>{m.content}</span>
          </div>
        ) : m.type === 'approval' ? (
          <div className="mt-1 inline-flex items-start gap-2 px-3 py-2 rounded-md border border-success/30 bg-success/5 text-success text-[12px] max-w-[640px]">
            <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
            <span>{m.content}</span>
          </div>
        ) : m.toolCall || m.type === 'tool_call' ? (
          <div className="mt-1 inline-flex items-start gap-2 px-3 py-2 rounded-md border border-primary-200 bg-primary-50/60 text-primary-700 text-[12px] font-mono max-w-[640px]">
            <Wrench size={12} className="mt-0.5 shrink-0" />
            <span>
              {m.toolCall ? `${m.toolCall.tool}(${m.toolCall.args}) → ` : ''}{m.content}
            </span>
          </div>
        ) : m.type === 'deliverable' ? (
          <div className="mt-1 inline-flex items-start gap-2 px-3 py-2 rounded-md border border-success/30 bg-success/5 text-success text-[12px] max-w-[640px]">
            <FileText size={12} className="mt-0.5 shrink-0" />
            <span>{m.content}</span>
          </div>
        ) : m.type === 'evidence' ? (
          <div className="mt-1 inline-flex items-start gap-2 px-3 py-2 rounded-md border border-neutral-200 bg-neutral-50 text-neutral-700 text-[12px] max-w-[640px] font-mono">
            <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-success" />
            <span>{m.content}</span>
          </div>
        ) : m.type === 'translate' ? (
          <div className="mt-1 inline-flex items-start gap-2 px-3 py-2 rounded-md border border-primary-200 bg-primary-50/60 text-primary-700 text-[12px] max-w-[640px]">
            <AtSign size={12} className="mt-0.5 shrink-0" />
            <span>{m.content}</span>
          </div>
        ) : m.type === 'decompose' ? (
          <div className="mt-1 inline-flex items-start gap-2 px-3 py-2 rounded-md border border-secondary-200 bg-secondary-50/40 text-secondary-700 text-[12px] max-w-[640px]">
            <Workflow size={12} className="mt-0.5 shrink-0" />
            <span>{m.content}</span>
          </div>
        ) : m.type === 'confirm' ? (
          <div className="mt-1 inline-flex items-start gap-2 px-3 py-2 rounded-md border border-tertiary-200 bg-tertiary-50/40 text-tertiary-700 text-[12px] max-w-[640px]">
            <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
            <span>{m.content}</span>
          </div>
        ) : (
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-800 whitespace-pre-wrap break-words">
            {renderMentions(m.content)}
          </div>
        )}

        {m.taskCard && (
          <div className="mt-2 max-w-[640px]">
            <TaskCard task={m.taskCard} />
          </div>
        )}

        {m.attachments && m.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {m.attachments.map((a) => (
              <span
                key={a.name}
                className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border border-neutral-200 bg-white text-neutral-700"
              >
                <FileText size={10} /> {a.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function renderMentions(text: string) {
  const parts = text.split(/(@[^\s@]+)/g);
  return parts.map((p, i) =>
    p.startsWith('@') ? (
      <span
        key={i}
        className="px-1 rounded bg-primary-50 text-primary-700 font-medium"
      >
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
