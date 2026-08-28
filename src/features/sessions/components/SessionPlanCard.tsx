import { useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, Pencil, Sparkles } from 'lucide-react';
import type { SessionPlan } from '../model/session';

export default function SessionPlanCard({
  plan,
  onChange,
  onRevise,
  onStart,
}: {
  plan: SessionPlan;
  onChange: (plan: SessionPlan) => void;
  onRevise: () => void;
  onStart: () => void;
}) {
  const [editing, setEditing] = useState<'assignees' | 'model' | 'tools' | 'scope' | 'gates' | 'estimate' | null>(null);
  return (
    <form onSubmit={(event) => { event.preventDefault(); onStart(); }} className="hum-card mx-auto w-full max-w-[820px] overflow-visible border-neutral-300 shadow-sm">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-4">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-neutral-900 text-white"><Sparkles size={15} /></span>
        <h2 className="text-[14px] font-semibold text-neutral-900">我理解你要做的是：</h2>
      </div>
      <div className="px-5 py-4">
        <ol className="space-y-2.5">
          {plan.understanding.map((item, index) => (
            <li key={`${index}-${item}`} className="flex gap-3 text-[12.5px] leading-5 text-neutral-700">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-neutral-100 font-mono text-[10px] text-neutral-500">{index + 1}</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5 divide-y divide-neutral-100 border-y border-neutral-100">
          <PlanRow label="派给" value={plan.assignees.join(' + ')} action="换人" open={editing === 'assignees'} onToggle={() => setEditing(editing === 'assignees' ? null : 'assignees')}>
            <select aria-label="修改派给" value={plan.assignees[0]} onChange={(event) => { onChange({ ...plan, assignees: [event.target.value] }); setEditing(null); }} className="w-full rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-[12px] outline-none">
              <option>我的分身 · 昆仑助理</option><option>雪·销售官</option><option>岚·分析官</option><option>苓·法务官</option><option>璇·数据官</option>
            </select>
          </PlanRow>
          <PlanRow label="模型" value={plan.modelProfile} action="更换" open={editing === 'model'} onToggle={() => setEditing(editing === 'model' ? null : 'model')}>
            <select aria-label="修改模型" value={plan.modelProfile} onChange={(event) => { onChange({ ...plan, modelProfile: event.target.value }); setEditing(null); }} className="w-full rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-[12px] outline-none"><option>标准</option><option>增强</option><option>旗舰</option></select>
          </PlanRow>
          <PlanRow label="需要能力" value={plan.tools.join(' · ')} action="修改" open={editing === 'tools'} onToggle={() => setEditing(editing === 'tools' ? null : 'tools')}>
            <InlineText value={plan.tools.join('、')} label="修改工具" onCommit={(value) => onChange({ ...plan, tools: splitList(value) })} close={() => setEditing(null)} />
          </PlanRow>
          <PlanRow label="工作空间" value={plan.workspaceScope} action="改范围" open={editing === 'scope'} onToggle={() => setEditing(editing === 'scope' ? null : 'scope')}>
            <InlineText value={plan.workspaceScope} label="修改范围" onCommit={(value) => onChange({ ...plan, workspaceScope: value })} close={() => setEditing(null)} />
          </PlanRow>
          <PlanRow label="停下来问你" value={plan.humanGates.join(' · ')} action="改关口" open={editing === 'gates'} onToggle={() => setEditing(editing === 'gates' ? null : 'gates')}>
            <InlineText value={plan.humanGates.join('、')} label="修改关口" onCommit={(value) => onChange({ ...plan, humanGates: splitList(value) })} close={() => setEditing(null)} />
          </PlanRow>
          <PlanRow label="预计" value={plan.estimate} action="改预计" open={editing === 'estimate'} onToggle={() => setEditing(editing === 'estimate' ? null : 'estimate')}>
            <InlineText value={plan.estimate} label="修改预计" onCommit={(value) => onChange({ ...plan, estimate: value })} close={() => setEditing(null)} />
          </PlanRow>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onRevise} className="hum-btn"><Pencil size={13} /> 改一下</button>
          <button type="submit" autoFocus className="hum-btn is-primary"><span>开始干</span><ArrowRight size={13} /></button>
        </div>
      </div>
    </form>
  );
}

function PlanRow({ label, value, action, open, onToggle, children }: { label: string; value: string; action: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="relative grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2 py-2.5 text-[11.5px]">
      <span className="text-neutral-400">{label}</span>
      <span className="min-w-0 truncate font-medium text-neutral-700">{value}</span>
      <button type="button" onClick={onToggle} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10.5px] text-primary-700 hover:bg-primary-50">{action}<ChevronDown size={10} className={open ? 'rotate-180' : ''} /></button>
      {open && <div className="absolute right-0 top-[calc(100%-4px)] z-20 w-[min(340px,80vw)] rounded-md border border-neutral-200 bg-white p-2 shadow-lg">{children}</div>}
    </div>
  );
}

function InlineText({ value, label, onCommit, close }: { value: string; label: string; onCommit: (value: string) => void; close: () => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="flex gap-1.5">
      <input autoFocus aria-label={label} value={draft} onChange={(event) => setDraft(event.target.value)} className="min-w-0 flex-1 rounded-md border border-neutral-200 px-2.5 py-2 text-[12px] outline-none focus:border-primary-400" />
      <button type="button" onClick={() => { if (draft.trim()) onCommit(draft.trim()); close(); }} className="hum-btn is-sm is-primary">确定</button>
    </div>
  );
}

function splitList(value: string): string[] {
  return value.split(/[、,，·]/).map((item) => item.trim()).filter(Boolean);
}
