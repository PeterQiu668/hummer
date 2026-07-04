/**
 * 会议室 — 完整 flow (议程 · 参会 · 实时纪要 · 行动项 · 结束生成任务 + 审计)
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, Users2, Mic, ScreenShare, FileText, Plus, Clock, CheckCircle2, Trash2, ArrowRight, Send,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import type { CollabTask } from '../../lib/types';

const PRESET_AGENDA = [
  'Q3 增长策略评审',
  '618 复盘 + Q3 投放计划',
  '高危合同 v4 风险消减方案',
  '招聘高级前端 3 候选人决策',
  '客服情绪识别异常应急',
];

interface ActionItem { id: string; owner: string; what: string; due: string; done: boolean; }
interface NoteLine   { ts: string; speaker: string; text: string; }

const pad2 = (n: number) => String(n).padStart(2, '0');
const nowFull = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export default function MeetingRoom() {
  const setShowMeeting = useAppStore((s) => s.setShowMeeting);
  const pushToast = useAppStore((s) => s.pushToast);
  const pushAudit = useAppStore((s) => s.pushAudit);
  const addTask = useAppStore((s) => s.addTask);

  const [step, setStep] = useState<'setup' | 'live' | 'finished'>('setup');
  const [agenda, setAgenda] = useState(PRESET_AGENDA[0]);
  const [attendees, setAttendees] = useState<string[]>(['emp-ceo', 'emp-sales-1', 'emp-meeting-1']);
  const [tick, setTick] = useState(0);
  const [notes, setNotes] = useState<NoteLine[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([
    { id: 'a-1', owner: '雪·销售官', what: '本周内出 BD 邮件清单 + 报价单', due: '本周五 18:00', done: false },
    { id: 'a-2', owner: '岚·运营官', what: '周一开始投放调整 + 数据回收',     due: '下周三 12:00', done: false },
  ]);

  // 实时纪要打字
  useEffect(() => {
    if (step !== 'live') return;
    const lines = [
      { speaker: '林·决策官',  text: 'Q3 我们要把华东大客户增长拉到 30%' },
      { speaker: '吴·销售 VP 分身', text: '建议 BD 邮件优先 23 家 A 级客户' },
      { speaker: '雪·销售官', text: 'CRM 客户分群已完成，今晚出报价单' },
      { speaker: 'Hermes',     text: '检测到三角条款风险 · 已记录到 SOP 改进队列' },
      { speaker: '万·CFO 分身', text: '资金调拨需要走四眼原则 · 已上报审批单' },
    ];
    let i = 0;
    const id = setInterval(() => {
      if (i >= lines.length) return;
      const ts = `${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}`;
      setNotes((n) => [...n, { ts, speaker: lines[i].speaker, text: lines[i].text }]);
      i++;
    }, 2200);
    return () => clearInterval(id);
  }, [step, tick]);

  // 计时
  useEffect(() => {
    if (step !== 'live') return;
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

  const startMeeting = () => {
    if (attendees.length === 0) {
      pushToast({ kind: 'warning', title: '请先选择参会人' });
      return;
    }
    setStep('live');
    setNotes([]);
    setTick(0);
    pushAudit({ actor: '昆仑（您）', action: '发起会议', target: agenda, result: 'ok', tags: ['meeting', 'start'] });
  };

  const endMeeting = () => {
    setStep('finished');
    pushAudit({
      actor: '昆仑（您）', action: '会议结束 · 生成纪要',
      target: agenda, result: 'ok',
      tags: ['meeting', 'finish', `actions:${actions.length}`],
    });
    pushToast({ kind: 'success', title: `会议「${agenda}」已结束`, detail: `生成 ${actions.length} 个行动项 · 纪要已归档` });
  };

  const addAction = () => {
    setActions((a) => [...a, {
      id: `a-${Date.now()}`,
      owner: employees[attendees.length % employees.length]?.name ?? '昆仑',
      what: '新增行动项 · 待编辑',
      due: '本周内',
      done: false,
    }]);
  };
  const toggleAction = (id: string) =>
    setActions((a) => a.map((x) => x.id === id ? { ...x, done: !x.done } : x));
  const removeAction = (id: string) => setActions((a) => a.filter((x) => x.id !== id));

  // ── 行动项 → CollabTask（结束会议后可逐条/一键转任务）──
  const [converted, setConverted] = useState<Record<string, boolean>>({});
  const [taskOwners, setTaskOwners] = useState<Record<string, string>>({});

  const defaultOwnerId = (a: ActionItem): string =>
    employees.find((e) => e.name === a.owner)?.id
    ?? employees.find((e) => attendees.includes(e.id))?.id
    ?? 'emp-doc';
  const ownerOf = (a: ActionItem) => taskOwners[a.id] ?? defaultOwnerId(a);

  const buildTask = (a: ActionItem, ownerId: string): CollabTask => ({
    id: `tk-meeting-${a.id}-${Date.now()}`,
    title: a.what,
    goal: agenda,
    scope: `会议「${agenda}」行动项`,
    inputs: ['会议纪要', '行动项上下文'],
    outputs: ['交付物 · 按行动项约定'],
    acceptance: ['发起人验收确认'],
    ownerId,
    collaboratorIds: [],
    dueAt: a.due,
    status: 'pending',
    progress: 0,
    channel: 'ch-q3',
    priority: 'normal',
    createdAt: nowFull(),
  });

  const convertOne = (a: ActionItem) => {
    if (converted[a.id]) return;
    const ownerId = ownerOf(a);
    const ownerName = employees.find((e) => e.id === ownerId)?.name ?? ownerId;
    addTask(buildTask(a, ownerId));
    setConverted((c) => ({ ...c, [a.id]: true }));
    pushToast({ kind: 'success', title: `已转任务 · 派给 ${ownerName}`, detail: a.what });
    pushAudit({
      actor: '昆仑（您）', action: '会议行动项转任务',
      target: `${ownerName} · ${a.what}`, result: 'ok',
      tags: ['meeting', 'task', 'ch-q3'],
    });
  };

  const convertAll = () => {
    const remaining = actions.filter((a) => !converted[a.id]);
    if (remaining.length === 0) {
      pushToast({ kind: 'info', title: '所有行动项都已转为任务' });
      return;
    }
    const next: Record<string, boolean> = {};
    remaining.forEach((a) => {
      addTask(buildTask(a, ownerOf(a)));
      next[a.id] = true;
    });
    setConverted((c) => ({ ...c, ...next }));
    pushToast({
      kind: 'success',
      title: `已将 ${remaining.length} 个行动项转为任务`,
      detail: '任务已进入任务看板 · 频道 ch-q3',
    });
    pushAudit({
      actor: '昆仑（您）', action: '会议行动项批量转任务',
      target: `${agenda} · ${remaining.length} 项`, result: 'ok',
      tags: ['meeting', 'task', 'batch'],
    });
  };

  const attendeesData = employees.filter((e) => attendees.includes(e.id));
  const elapsed = `${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}`;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(15,15,14,0.32)', backdropFilter: 'blur(4px)' }}
      onClick={() => setShowMeeting(false)}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
        className="bg-white rounded-xl w-[1080px] max-w-[94vw] h-[680px] max-h-[88vh] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="w-9 h-9 rounded-lg bg-secondary-50 grid place-items-center">
            <Users2 size={16} className="text-secondary-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-neutral-900">会议室 · 青莲</div>
            <div className="text-[11px] hum-muted">
              {step === 'setup' && '准备开会 · 选议题 + 拉参会人'}
              {step === 'live' && `${agenda} · ${attendeesData.length} 位参会`}
              {step === 'finished' && '已结束 · 纪要 + 行动项已归档'}
            </div>
          </div>
          {step === 'live' && (
            <span className="hum-chip is-success hum-tabular">
              <span className="hum-dot hum-pulse" style={{ background: 'var(--success)' }} />
              录制中 · {elapsed}
            </span>
          )}
          <button onClick={() => setShowMeeting(false)} className="text-neutral-400 hover:text-neutral-900">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        {step === 'setup' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <Section title="议题">
              <div className="space-y-1.5">
                {PRESET_AGENDA.map((a) => (
                  <label key={a} className="flex items-center gap-2 hum-card-soft px-3 py-2 cursor-pointer hover:hum-elev-1 transition">
                    <input type="radio" checked={agenda === a} onChange={() => setAgenda(a)} className="accent-primary-600" />
                    <span className="text-[12.5px] text-neutral-700">{a}</span>
                  </label>
                ))}
                <div className="flex items-center gap-2 hum-card-soft px-3 py-2">
                  <input type="radio" checked={!PRESET_AGENDA.includes(agenda)} onChange={() => setAgenda('自定义议题')} className="accent-primary-600" />
                  <input
                    value={!PRESET_AGENDA.includes(agenda) ? agenda : ''}
                    onChange={(e) => setAgenda(e.target.value || '自定义议题')}
                    placeholder="自定义议题 · 例如「Q4 销售复盘 + 关键决策」"
                    className="hum-input flex-1 border-0 p-0 focus:shadow-none"
                  />
                </div>
              </div>
            </Section>

            <Section title="参会人">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                {employees.map((e) => {
                  const on = attendees.includes(e.id);
                  return (
                    <label
                      key={e.id}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition ${on ? 'bg-primary-50 border-primary-200' : 'hum-card-soft hover:bg-neutral-100'}`}
                      style={{ border: `1px solid ${on ? 'var(--brand)' : 'var(--border-subtle)'}` }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setAttendees((p) => on ? p.filter((id) => id !== e.id) : [...p, e.id])}
                        className="accent-primary-600"
                      />
                      <span className="w-6 h-6 rounded-md grid place-items-center text-white text-[11px] font-semibold" style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}>
                        {e.avatar}
                      </span>
                      <span className="flex-1 min-w-0 leading-tight">
                        <div className="text-[12px] text-neutral-900 truncate">{e.name}</div>
                        <div className="text-[10px] hum-faint truncate">{e.role}</div>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-2 text-[11px] hum-muted">{attendees.length} 位已选</div>
            </Section>

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowMeeting(false)} className="hum-btn">取消</button>
              <button onClick={startMeeting} className="hum-btn is-primary">开始会议 <ArrowRight size={12} /></button>
            </div>
          </div>
        )}

        {step === 'live' && (
          <div className="flex-1 grid grid-cols-12 gap-3 p-4 overflow-hidden">
            {/* Attendee tiles */}
            <div className="col-span-12 md:col-span-7 grid grid-cols-3 gap-2 content-start overflow-y-auto">
              {attendeesData.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.06 }}
                  className="aspect-video rounded-lg relative overflow-hidden flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #F1F1ED, #FAFAF8)', border: '1px solid var(--border)' }}
                >
                  <motion.div
                    animate={{ y: [0, -2, 0] }} transition={{ duration: 2 + i * 0.2, repeat: Infinity }}
                    className="w-12 h-12 rounded-full grid place-items-center text-white text-[15px] font-bold"
                    style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}
                  >
                    {a.avatar}
                  </motion.div>
                  <div className="absolute top-1.5 left-1.5 hum-chip" style={{ padding: '1px 6px', fontSize: 9.5 }}>{a.name}</div>
                  {i % 3 === 0 && <Mic size={11} className="absolute bottom-1.5 right-1.5 text-success hum-pulse" />}
                </motion.div>
              ))}
              <button className="aspect-video rounded-lg border-2 border-dashed grid place-items-center text-[11.5px] hum-faint hover:border-neutral-400 hover:text-neutral-700 transition"
                style={{ borderColor: 'var(--border)' }}>
                <Plus size={20} className="mb-1" />
                <span>拉人</span>
              </button>
            </div>

            {/* Notes + actions */}
            <div className="col-span-12 md:col-span-5 flex flex-col gap-3 overflow-hidden">
              {/* Live notes */}
              <div className="flex-1 hum-card-soft flex flex-col overflow-hidden">
                <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <FileText size={12} className="text-success" />
                  <span className="hum-eyebrow">实时纪要</span>
                  <span className="flex-1" />
                  <span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 9.5 }}>
                    <span className="hum-dot hum-pulse" style={{ background: 'var(--success)' }} /> LIVE
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {notes.map((n, i) => (
                    <div key={i} className="flex gap-2 text-[11.5px]">
                      <span className="font-mono hum-faint w-9 shrink-0">{n.ts}</span>
                      <span className="font-medium text-neutral-900 shrink-0">{n.speaker.split('·')[0]}</span>
                      <span className="text-neutral-700 flex-1">{n.text}</span>
                    </div>
                  ))}
                  {notes.length === 0 && <div className="text-[11px] hum-faint italic text-center py-4">▋ 准备记录…</div>}
                </div>
              </div>

              {/* Actions */}
              <div className="hum-card-soft">
                <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <CheckCircle2 size={12} className="text-primary-600" />
                  <span className="hum-eyebrow">行动项</span>
                  <span className="text-[10px] hum-faint">{actions.filter((a) => a.done).length}/{actions.length}</span>
                  <span className="flex-1" />
                  <button onClick={addAction} className="hum-btn is-sm is-ghost"><Plus size={11} /></button>
                </div>
                <div className="p-2 space-y-1 max-h-44 overflow-y-auto">
                  {actions.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 text-[11.5px] group">
                      <input type="checkbox" checked={a.done} onChange={() => toggleAction(a.id)} className="accent-primary-600" />
                      <span className={`flex-1 ${a.done ? 'text-neutral-400 line-through' : 'text-neutral-700'}`}>
                        <b className="text-neutral-900">{a.owner.split('·')[0]}</b> · {a.what}
                      </span>
                      <span className="hum-faint font-mono text-[10px]"><Clock size={9} className="inline -mt-0.5 mr-0.5" />{a.due}</span>
                      <button onClick={() => removeAction(a.id)} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-error transition"><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'finished' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="hum-card-soft p-4 flex items-center gap-3">
              <CheckCircle2 size={20} className="text-success" />
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-neutral-900">会议已结束 · {agenda}</div>
                <div className="text-[12px] hum-muted">共 {attendeesData.length} 位参会 · 时长 {elapsed} · {actions.length} 个行动项</div>
              </div>
            </div>
            <Section title="纪要摘要">
              <ul className="space-y-1">
                {notes.map((n, i) => (
                  <li key={i} className="text-[12.5px] text-neutral-700"><b className="text-neutral-900">{n.speaker.split('·')[0]}</b>：{n.text}</li>
                ))}
              </ul>
            </Section>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="hum-eyebrow flex-1">行动项 · 转为任务</div>
                <span className="text-[10.5px] hum-faint hum-tabular">
                  {actions.filter((a) => converted[a.id]).length}/{actions.length} 已转
                </span>
                <button
                  onClick={convertAll}
                  disabled={actions.every((a) => converted[a.id])}
                  className="hum-btn is-sm is-primary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send size={11} /> 全部转为任务
                </button>
              </div>
              <div className="space-y-1.5">
                {actions.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 hum-card px-3 py-2">
                    <CheckCircle2 size={12} className={converted[a.id] ? 'text-success' : 'text-neutral-300'} />
                    <span className="flex-1 min-w-0 text-[12.5px] truncate">{a.what}</span>
                    <span className="hum-chip shrink-0"><Clock size={9} /> {a.due}</span>
                    <select
                      value={ownerOf(a)}
                      onChange={(e) => setTaskOwners((o) => ({ ...o, [a.id]: e.target.value }))}
                      disabled={!!converted[a.id]}
                      className="hum-input w-[132px] shrink-0 disabled:opacity-50"
                      style={{ padding: '3px 6px', fontSize: 11.5 }}
                    >
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                    {converted[a.id] ? (
                      <span className="hum-chip is-success shrink-0">已转任务 ✓</span>
                    ) : (
                      <button onClick={() => convertOne(a)} className="hum-btn is-sm shrink-0">
                        <Send size={10} /> 转为任务
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {step === 'live' && (
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <button className="hum-btn is-sm"><ScreenShare size={11} /> 共享白板</button>
            <button className="hum-btn is-sm">⏸ 暂停录制</button>
            <span className="flex-1" />
            <button onClick={endMeeting} className="hum-btn is-sm is-primary">结束 · 生成纪要</button>
          </div>
        )}
        {step === 'finished' && (
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <span className="flex-1 text-[11.5px] hum-muted">纪要 + 行动项已写入审计链</span>
            <button onClick={() => { setShowMeeting(false); }} className="hum-btn is-sm is-primary">完成</button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="hum-eyebrow mb-2">{title}</div>
      {children}
    </div>
  );
}
