/**
 * EmployeeDrawer (v7) — Notion 浅色 / 右侧固定 380px
 * **关键改动**：从中间悬浮抽屉改为「右侧固定面板」，由 AppShell 在 selectedEmployee 时
 * 渲染、替换 RightConsole 同一槽位（左侧办公室主场景保持完整可见）。
 */
import { useEffect, useState, useRef } from 'react';
import {
  X, Activity, Brain, Shield, FileText, Sparkles,
  AlertTriangle, CheckCircle2, Workflow, Play, Pause, RotateCcw,
  Camera, Send, Calendar, MessagesSquare, ChevronRight, Coins,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { executiveTwins, BOSS_TWIN, HUMAN_BOSS } from '../../data/executives';
import { setFocusEmployeeId } from '../../data/evolution';
import AgentAvatar from '../ui/AgentAvatar';
import EvolutionProfile from '../evolution/EvolutionProfile';

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  working:  { label: '工作中',     color: '#0F70B7', bg: 'var(--brand-soft)' },
  blocked:  { label: '守护者阻断', color: '#C13D3D', bg: 'var(--error-soft)' },
  meeting:  { label: '会议中',     color: '#7E22CE', bg: '#F8F0FC' },
  training: { label: '训练中',     color: '#0F766E', bg: '#EFFAF8' },
  idle:     { label: '待命',       color: '#6B6B65', bg: 'var(--bg-subtle)' },
};

const tabs = [
  { id: 'overview',    label: '身份',   icon: Activity },
  { id: 'task',        label: '任务',   icon: Workflow },
  { id: 'skills',      label: '技能',   icon: Brain },
  { id: 'permissions', label: '权限',   icon: Shield },
  { id: 'audit',       label: '审计',   icon: FileText },
  { id: 'evolution',   label: '进化档案', icon: Sparkles },
];

export default function EmployeeDrawer() {
  const e = useAppStore((s) => s.selectedEmployee);
  const setSelectedEmployee = useAppStore((s) => s.setSelectedEmployee);
  const pushAudit = useAppStore((s) => s.pushAudit);
  const pushToast = useAppStore((s) => s.pushToast);
  const setShowMeeting = useAppStore((s) => s.setShowMeeting);
  const setActivePage = useAppStore((s) => s.setActivePage);

  const [tab, setTab] = useState('overview');
  const [lines, setLines] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset state when selectedEmployee changes (different agent picked)
  useEffect(() => {
    setTab('overview');
    setLines([]);
    if (e?.id) {
      const saved = localStorage.getItem(`hummer-avatar-${e.id}`);
      setAvatarUrl(saved);
    }
  }, [e?.id]);

  // Task screen: type-in lines effect
  useEffect(() => {
    if (!e?.taskLines || tab !== 'task') return;
    setLines([]);
    let i = 0;
    const id = setInterval(() => {
      setLines((prev) => [...prev, e.taskLines![i % e.taskLines!.length]]);
      i++;
      if (i > 10) clearInterval(id);
    }, 700);
    return () => clearInterval(id);
  }, [e, tab]);

  if (!e) return null;
  const st = STATUS_META[e.status];

  // Find responsibility chain
  const execTwin = executiveTwins.find((x) => x.managesEmployeeIds.includes(e.id));

  const onUploadAvatar = (file: File) => {
    if (file.size > 2_000_000) {
      pushToast({ kind: 'error', title: '头像过大', detail: '请上传小于 2MB 的图片' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setAvatarUrl(url);
      localStorage.setItem(`hummer-avatar-${e.id}`, url);
      // 触发跨组件同步（同 tab 内 storage 事件不会自发，需要手动派发）
      window.dispatchEvent(new StorageEvent('storage', { key: `hummer-avatar-${e.id}`, newValue: url }));
      pushAudit({ actor: '昆仑（您）', action: '更换 Agent 头像', target: e.name, result: 'ok', tags: ['agent', 'avatar'] });
      pushToast({ kind: 'success', title: `${e.name} 头像已更新`, detail: '已同步到员工列表、首页、对话流、任务 owner' });
    };
    reader.readAsDataURL(file);
  };

  return (
    <aside
      className="absolute right-0 top-12 bottom-[276px] w-[380px] z-30 flex flex-col bg-white"
      style={{ borderLeft: '1px solid var(--border-subtle)', boxShadow: '-12px 0 24px rgba(15,15,14,0.04)' }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <button
              onClick={() => fileRef.current?.click()}
              className="group relative w-14 h-14 rounded-xl overflow-hidden block"
              title="点击更换头像"
            >
              <AgentAvatar id={e.id} size={56} status={e.status} />
              <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 bg-black/40 transition rounded-xl">
                <Camera size={16} className="text-white" />
              </div>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) onUploadAvatar(f);
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="px-2 py-0.5 rounded-md text-[10.5px] font-medium tabular-nums"
                style={{ background: st.bg, color: st.color }}
              >
                ● {st.label}
              </span>
              <span className="hum-chip">{e.role}</span>
            </div>
            <div className="text-[15px] font-semibold text-neutral-900 truncate">{e.name}</div>
            <div className="text-[11.5px] hum-faint mt-0.5 truncate">{e.department}</div>
          </div>
          <button onClick={() => setSelectedEmployee(null)} className="text-neutral-400 hover:text-neutral-900">
            <X size={18} />
          </button>
        </div>

        {/* Responsibility chain (责任链路) */}
        {execTwin && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div className="hum-eyebrow mb-1.5">责任链路</div>
            <div className="flex items-center gap-1 text-[10.5px] flex-wrap">
              <ChainNode label={HUMAN_BOSS.name} sub="老板" color="#171717" />
              <ChevronRight size={10} className="text-neutral-300" />
              <ChainNode label="昆仑分身" sub="意图入口" color="#7E22CE" />
              <ChevronRight size={10} className="text-neutral-300" />
              <ChainNode label={execTwin.name.split('·')[0]} sub={execTwin.role.split(' / ')[0]} color={execTwin.color} />
              <ChevronRight size={10} className="text-neutral-300" />
              <ChainNode label={e.name.split('·')[0]} sub="执行 Agent" color="#0F70B7" active />
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="px-2 pt-2 flex items-center gap-0.5 flex-wrap" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-2 py-1.5 rounded-md text-[11.5px] font-medium flex items-center gap-1 transition ${
                active ? 'bg-primary-50 text-primary-700' : 'text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              <Icon size={11} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {tab === 'overview' && (
          <>
            <Panel title="当前任务">
              <div className="text-[12.5px] text-neutral-700 leading-relaxed">{e.currentTask}</div>
              {typeof e.progress === 'number' && (
                <>
                  <div className="mt-2 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${e.progress}%`, background: st.color }}
                    />
                  </div>
                  <div className="text-[10.5px] hum-faint mt-1 font-mono hum-tabular">{e.progress}% 完成</div>
                </>
              )}
            </Panel>

            <Panel title="今日交付">
              <div className="space-y-1.5">
                {[
                  { name: 'BD 邮件草稿 x3', kind: 'draft', ts: '14:35' },
                  { name: 'Q3 客户清单 v4.xlsx', kind: 'sheet', ts: '13:22' },
                  { name: '北辰金融回访纪要', kind: 'memo', ts: '10:08' },
                ].map((d) => (
                  <div key={d.name} className="flex items-center gap-2 hum-card-soft px-2.5 py-1.5">
                    <FileText size={11} className="text-neutral-500" />
                    <span className="flex-1 text-[12px] text-neutral-700 truncate">{d.name}</span>
                    <span className="text-[10px] hum-faint font-mono">{d.ts}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="运行指标">
              <div className="grid grid-cols-3 gap-1.5">
                <KV label="模型" value={e.model.replace('Claude ', '')} />
                <KV label="今日 Token" value={`${(e.tokensToday / 1000).toFixed(1)}K`} mono />
                <KV label="今日成本" value={`¥${e.costToday.toFixed(1)}`} mono />
              </div>
            </Panel>

            <Panel title="快捷操作">
              <div className="grid grid-cols-2 gap-1.5">
                <Action icon={<Send size={11} />} label="指派新任务" onClick={() => {
                  setActivePage('tasks');
                  setSelectedEmployee(null);
                }} />
                <Action icon={<MessagesSquare size={11} />} label="打开对话" onClick={() => {
                  setActivePage('chat');
                  setSelectedEmployee(null);
                }} />
                <Action icon={<Calendar size={11} />} label="发起会议" onClick={() => {
                  setShowMeeting(true);
                  pushAudit({ actor: '昆仑（您）', action: '发起会议', target: e.name, result: 'ok', tags: ['meeting'] });
                }} />
                <Action icon={<Shield size={11} />} label="调整权限" onClick={() => {
                  pushToast({ kind: 'info', title: '权限调整面板', detail: '即将上线 · 当前为占位' });
                }} />
                <Action icon={e.status === 'idle' ? <Play size={11} /> : <Pause size={11} />} label={e.status === 'idle' ? '启动 Agent' : '暂停 Agent'} onClick={() => {
                  pushAudit({ actor: '昆仑（您）', action: e.status === 'idle' ? '启动 Agent' : '暂停 Agent', target: e.name, result: 'ok', tags: ['agent'] });
                  pushToast({ kind: 'info', title: `${e.name} ${e.status === 'idle' ? '已启动' : '已暂停'}` });
                }} />
                <Action icon={<RotateCcw size={11} />} label="回滚最近变更" onClick={() => {
                  pushToast({ kind: 'warning', title: '回滚需四眼原则', detail: '请在审计页提交回滚请求' });
                }} />
              </div>
            </Panel>
          </>
        )}

        {tab === 'task' && (
          <Panel title="员工屏幕实时数据流" right={<span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}><span className="hum-dot hum-pulse" style={{ background: 'var(--success)' }} /> LIVE</span>}>
            <div className="hum-card-soft p-3 h-64 overflow-hidden font-mono text-[11px] text-neutral-700 leading-relaxed">
              {lines.map((l, i) => (
                <div key={i} className={l.startsWith('⚠') ? 'text-error' : ''}>{l}</div>
              ))}
              <span className="inline-block w-1.5 h-3 bg-primary-500 animate-pulse ml-1" />
            </div>
          </Panel>
        )}

        {tab === 'skills' && (
          <Panel title="已装备技能">
            <div className="space-y-1.5">
              {e.skills.map((s) => (
                <div key={s.id} className="hum-card-soft p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] font-medium text-neutral-900">{s.name}</span>
                    <span className={`hum-chip ${s.source === 'expert' ? 'is-brand' : s.source === 'marketplace' ? 'is-warning' : ''}`} style={{ padding: '1px 6px', fontSize: 10 }}>
                      {s.source === 'expert' ? '专家' : s.source === 'marketplace' ? '市场' : '内置'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className={`flex-1 h-1 rounded-full ${i < s.level ? 'bg-primary-500' : 'bg-neutral-100'}`} />
                    ))}
                  </div>
                  <div className="mt-1 text-[10.5px] hum-faint flex justify-between font-mono">
                    <span>Lv.{s.level}</span>
                    {s.equipped ? <span className="text-success">● 已装备</span> : <span>未装备</span>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {tab === 'permissions' && (
          <Panel title="权限矩阵">
            <div className="space-y-1.5">
              {e.permissions.map((p) => (
                <div key={p.id} className="hum-card-soft p-2.5 flex items-center gap-2.5">
                  {p.approvalRequired
                    ? <AlertTriangle size={13} className="text-warning shrink-0" />
                    : <CheckCircle2 size={13} className="text-success shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] text-neutral-900">{p.scope}</div>
                    <div className="text-[10.5px] hum-faint">
                      {p.approvalRequired ? '需人审批准（四眼原则）' : '在授权边界内自动'}
                    </div>
                  </div>
                  <span className={`hum-chip ${
                    p.level === 'admin' ? 'is-brand' :
                    p.level === 'external' ? 'is-warning' :
                    'is-muted'
                  }`} style={{ padding: '1px 6px', fontSize: 10 }}>
                    {p.level.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 hum-card-soft p-2.5 text-[11px] text-neutral-600 leading-relaxed">
              所有 API Key / DB 凭证 / 第三方 Token 均由 <b className="text-primary-700">HiClaw AI Gateway</b> 统一托管，Agent 不持任何凭证，只能通过策略代理调用。
            </div>
          </Panel>
        )}

        {tab === 'audit' && (
          <Panel title="审计链" right={<span className="hum-chip">{e.auditEntries.length}</span>}>
            <div className="space-y-1.5">
              {e.auditEntries.length === 0 && (
                <div className="text-[11.5px] hum-faint italic text-center py-3">今日暂无审计事件</div>
              )}
              {e.auditEntries.map((a, i) => (
                <div key={a.id} className="hum-card-soft px-2.5 py-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="hum-faint font-mono">#{String(i + 1).padStart(3, '0')}</span>
                    <span className="hum-faint font-mono">{a.ts}</span>
                    <span className="font-medium text-neutral-900">{a.action}</span>
                    {a.risk === 'high' && <AlertTriangle size={11} className="text-error" />}
                  </div>
                  <div className="text-[11px] text-neutral-600 mt-0.5">
                    → {a.target}{a.approver && <span className="text-secondary-700"> · 审批 {a.approver}</span>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {tab === 'evolution' && (
          <>
            <Panel title="Hermes 进化指标">
              <div className="grid grid-cols-4 gap-1.5">
                <KV label="等级" value={`Lv.${e.evolution.level}`} />
                <KV label="Bad" value={String(e.evolution.badCases)} />
                <KV label="改进" value={String(e.evolution.improved)} />
                <KV label="待审" value={String(e.evolution.pending)} />
              </div>
            </Panel>
            {/* 进化档案（与进化中心 Tab2 同源组件 · 紧凑模式） */}
            <EvolutionProfile
              employeeId={e.id}
              compact
              onOpenCenter={() => {
                setFocusEmployeeId(e.id);
                setActivePage('evolution');
                setSelectedEmployee(null);
              }}
            />
          </>
        )}
      </div>
    </aside>
  );
}

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="hum-eyebrow">{title}</div>
        {right}
      </div>
      <div className="hum-card-soft p-2.5">{children}</div>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white border border-neutral-150 rounded-md px-2 py-1.5">
      <div className="text-[9.5px] uppercase tracking-wider hum-faint">{label}</div>
      <div className={`text-[12px] mt-0.5 text-neutral-900 ${mono ? 'font-mono hum-tabular' : ''}`}>{value}</div>
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="hum-btn is-sm justify-center">
      {icon} {label}
    </button>
  );
}

function ChainNode({ label, sub, color, active }: { label: string; sub: string; color: string; active?: boolean }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] leading-tight"
      style={{
        background: active ? `${color}1A` : 'var(--bg-subtle)',
        color: active ? color : 'var(--text-muted)',
        border: `1px solid ${active ? color + '40' : 'var(--border-subtle)'}`,
      }}
      title={sub}
    >
      {label}
    </span>
  );
}
