import { useRef, useState } from 'react';
import { AtSign, BrainCircuit, ChevronDown, Clock3, FolderOpen, LoaderCircle, Paperclip, Send, ShieldCheck } from 'lucide-react';
import type { ApprovalMode } from '../model/session';
import { engineProfileForLabel, type CustomerEngineProfile } from '../../engines/engineProfileClient';

const examples = [
  { title: '整理本周线索', detail: '生成跟进清单', assignee: '雪·销售官', prompt: '把这周的线索整理成跟进清单，写回 CRM 前先给我看' },
  { title: '做一份竞对', detail: '对比报告', assignee: '岚·分析官', prompt: '对比三家主要竞对的产品、价格和渠道，做一份带证据的报告' },
  { title: '把这批合同', detail: '提取关键条款', assignee: '苓·法务官', prompt: '把这批合同的付款、交付和责任条款提取出来，标记异常' },
  { title: '上周复盘', detail: '出一页纸', assignee: '璇·数据官', prompt: '汇总上周经营数据和任务结果，做一页复盘并给出下周建议' },
] as const;

export interface WorkbenchComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  assignee: string;
  onAssigneeChange: (value: string) => void;
  approvalMode: ApprovalMode;
  assigneeOptions?: string[];
  onApprovalModeChange: (value: ApprovalMode) => void;
  attachmentNames: string[];
  onAttachmentNamesChange: (names: string[]) => void;
  modelProfile: string;
  engineProfiles: readonly CustomerEngineProfile[];
  onModelProfileChange: (value: string) => void;
  workContext: string;
  onWorkContextChange: (value: string) => void;
  compact?: boolean;
  onRecentSelect?: (prompt: string) => void;
  busy?: boolean;
}

export default function WorkbenchComposer(props: WorkbenchComposerProps) {
  const { value, onChange, onSubmit, assignee, assigneeOptions = [], onAssigneeChange, approvalMode, onApprovalModeChange, attachmentNames, onAttachmentNamesChange, modelProfile, engineProfiles, onModelProfileChange, workContext, onWorkContextChange, compact = false, onRecentSelect, busy = false } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const selectedProfile = engineProfileForLabel(engineProfiles, modelProfile);
  const submit = () => { if (value.trim() && !busy && selectedProfile.available) onSubmit(); };

  return <div className={compact ? 'w-full' : 'mx-auto w-full max-w-[920px]'}>
    {!compact && <div className="mb-5 text-center"><h2 className="text-[24px] font-semibold text-neutral-900">昆仑，今天想推进什么？</h2><p className="mt-1.5 text-[12px] text-neutral-500">你可以自己处理，也可以交给分身或数字同事一起完成。</p></div>}
    <div className={`overflow-hidden border bg-white shadow-sm ${compact ? 'rounded-md border-neutral-200' : 'rounded-lg border-neutral-300'}`}>
      <textarea ref={textArea} aria-label="任务描述" value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }} rows={compact ? 2 : 4} placeholder="比如：把这周的线索整理成跟进清单，写回 CRM 前先给我看" className={`w-full resize-none border-0 bg-white text-neutral-900 outline-none placeholder:text-neutral-400 ${compact ? 'px-4 py-3 text-[13px]' : 'px-5 py-5 text-[15px] leading-6'}`} />
      <div className="flex flex-wrap items-center gap-1 border-t border-neutral-100 bg-neutral-25 px-2 py-2">
        <InlineSelect icon={<AtSign size={13} />} label="派给谁" value={assignee} onChange={onAssigneeChange} options={[...new Set(['自动推荐', '我的分身 · 昆仑助理', '雪·销售官', '岚·分析官', '苓·法务官', '璇·数据官', ...assigneeOptions])]} />
        <EngineProfileSelect profiles={engineProfiles} value={selectedProfile.label} onChange={onModelProfileChange} />
        <InlineSelect icon={<FolderOpen size={13} />} label="选择工作空间" value={workContext} onChange={onWorkContextChange} options={['我的工作空间', '销售共享空间', '公司知识库']} />
        <label className="relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-neutral-600 hover:bg-white"><ShieldCheck size={13} /><span className="sr-only">任务权限</span><select aria-label="任务权限" value={approvalMode} onChange={(event) => onApprovalModeChange(event.target.value as ApprovalMode)} className="appearance-none bg-transparent pr-4 font-medium text-neutral-700 outline-none"><option value="L1">只查看</option><option value="L2">执行前确认</option><option value="L3">范围内自动</option></select><ChevronDown size={11} className="pointer-events-none absolute right-1.5" /></label>
        <button type="button" onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium text-neutral-600 hover:bg-white"><Paperclip size={13} /> {attachmentNames.length ? `${attachmentNames.length} 份资料` : '添加资料'}</button>
        <input ref={fileInput} type="file" multiple className="hidden" aria-label="选择参考资料" onChange={(event) => onAttachmentNamesChange(Array.from(event.target.files ?? []).map((file) => file.name))} />
        {busy && <span role="status" className="ml-auto flex items-center gap-1.5 text-[10.5px] text-neutral-500"><LoaderCircle size={12} className="animate-spin" /> 正在生成计划</span>}
        <button type="button" onClick={submit} disabled={!value.trim() || busy || !selectedProfile.available} aria-label={busy ? '正在生成计划' : '提交任务'} className={`${busy ? '' : 'ml-auto'} grid h-8 w-8 place-items-center rounded-md bg-neutral-900 text-white disabled:cursor-not-allowed disabled:opacity-30`}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}</button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-100 bg-white px-3 py-1.5 text-[10.5px] text-neutral-500">
        <span>数据流向：<strong className="font-medium text-neutral-700">{selectedProfile.dataDomain}</strong></span>
        {engineProfiles.filter((profile) => !profile.available).map((profile) => (
          <span key={profile.id} className="text-warning" title={profile.compatibilityNote}>
            {profile.label}暂不可用：{profile.compatibilityNote}
          </span>
        ))}
      </div>
    </div>

    {!compact && <><div className="mt-6 text-[11.5px] font-medium text-neutral-500">常用工作</div><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{examples.map((example) => <button type="button" key={example.title} aria-label={`填入示例：${example.title} ${example.detail}`} onClick={() => { onChange(example.prompt); onAssigneeChange(example.assignee); requestAnimationFrame(() => textArea.current?.focus()); }} className="hum-card min-h-[96px] p-3 text-left transition hover:border-neutral-300 hover:shadow-sm"><div className="text-[13px] font-semibold text-neutral-800">{example.title}</div><div className="mt-0.5 text-[12px] text-neutral-600">{example.detail}</div><div className="mt-3 text-[10.5px] text-neutral-400">{example.assignee}</div></button>)}</div><div className="mt-4 border-t border-neutral-200 pt-3"><button type="button" onClick={() => setRecentOpen((open) => !open)} className="flex w-full items-center gap-2 text-left text-[11.5px] text-neutral-500"><Clock3 size={13} /> 最近 <span className="text-neutral-400">2 个会话</span><ChevronDown size={12} className={`ml-auto transition ${recentOpen ? 'rotate-180' : ''}`} /></button>{recentOpen && <div className="mt-2 grid gap-1 sm:grid-cols-2"><Recent label="华东目标账户研究" state="进行中" onClick={() => onRecentSelect?.('继续华东目标账户研究，优先核验制造业客户')} /><Recent label="Q3 复盘素材" state="待我确认" onClick={() => onRecentSelect?.('整理 Q3 复盘素材，列出需要我确认的结论')} /></div>}</div></>}
  </div>;
}

function InlineSelect({ icon, label, value, onChange, options }: { icon: React.ReactNode; label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-neutral-600 hover:bg-white">{icon}<span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="max-w-[150px] appearance-none truncate bg-transparent pr-4 font-medium text-neutral-700 outline-none">{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={11} className="pointer-events-none absolute right-1.5" /></label>;
}


function EngineProfileSelect({ profiles, value, onChange }: { profiles: readonly CustomerEngineProfile[]; value: string; onChange: (value: string) => void }) {
  return <label className="relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-neutral-600 hover:bg-white">
    <BrainCircuit size={13} />
    <span className="sr-only">选择模型</span>
    <select aria-label="选择模型" value={value} onChange={(event) => onChange(event.target.value)} className="max-w-[150px] appearance-none truncate bg-transparent pr-4 font-medium text-neutral-700 outline-none">
      {profiles.map((profile) => <option key={profile.id} value={profile.label} disabled={!profile.available}>{profile.label}{profile.available ? '' : ' · 暂不可用'}</option>)}
    </select>
    <ChevronDown size={11} className="pointer-events-none absolute right-1.5" />
  </label>;
}
function Recent({ label, state, onClick }: { label: string; state: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-left hover:bg-neutral-25"><span className="min-w-0 flex-1 truncate text-[11.5px] text-neutral-700">{label}</span><span className="text-[10px] text-neutral-400">{state}</span></button>; }
