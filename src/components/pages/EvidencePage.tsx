/**
 * 证据库 / 产出物 — 客户能看到「Agent 到底交付了什么，依据是什么，谁确认了」
 * 每条记录：产出物 / hash / 时间戳 / 责任 Agent / 关联任务 / 资料来源 / 知识引用
 */
import { useMemo, useState } from 'react';
import { Search, Filter, FileText, Download, ExternalLink, Eye, Shield, Tag, ArrowRight } from 'lucide-react';
import WorkspacePage, { EmptyState } from './WorkspacePage';
import { collabTasks } from '../../data/tasks';
import { employees } from '../../data/employees';
import { useAppStore } from '../../store/useAppStore';
import type { ExitActionKind } from '../../lib/types';
import ExitActionModal, { ACTION_META } from '../work/ExitActionModal';
import ExitQueue from '../work/ExitQueue';

type Kind = 'doc' | 'sheet' | 'pdf' | 'memo' | 'sop' | 'report' | 'log';
type Status = 'draft' | 'approved' | 'shipped' | 'archived';

interface Evidence {
  id: string;
  name: string;
  kind: Kind;
  status: Status;
  ownerId: string;       // 责任 Agent
  approverId?: string;   // 审批人 (Agent or human '昆仑')
  taskId?: string;
  conversation?: string; // 关联对话频道
  sources: string[];     // 资料来源
  knowledgeRefs: string[]; // 知识图谱引用
  hash: string;
  ts: string;
  size: string;
}

const KIND_META: Record<Kind, { label: string; color: string }> = {
  doc:    { label: '文档', color: '#0F70B7' },
  sheet:  { label: '表格', color: '#1E8F5C' },
  pdf:    { label: 'PDF',  color: '#C13D3D' },
  memo:   { label: '纪要', color: '#7E22CE' },
  sop:    { label: 'SOP',  color: '#B07706' },
  report: { label: '报告', color: '#0F766E' },
  log:    { label: '日志', color: '#6B6B65' },
};

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  draft:    { label: '草稿', cls: 'hum-chip' },
  approved: { label: '已审批', cls: 'hum-chip is-brand' },
  shipped:  { label: '已交付', cls: 'hum-chip is-success' },
  archived: { label: '已归档', cls: 'hum-chip is-muted' },
};

const evidenceSeed: Evidence[] = [
  {
    id: 'ev-1', name: 'Q3 BD 邮件清单.xlsx', kind: 'sheet', status: 'shipped',
    ownerId: 'emp-sales-1', approverId: 'emp-ceo', taskId: 'tk-sales-q3', conversation: 'ch-q3',
    sources: ['CRM · Salesforce Top-A 23 家客户', 'BD 邮件模板 v3.2'],
    knowledgeRefs: ['客户与合同 KG', '历史 BD 邮件成功率分析'],
    hash: '0x8f3a4d71', ts: '14:35:12', size: '128KB',
  },
  {
    id: 'ev-2', name: '鲲鹏制造 BD-0623 草稿.docx', kind: 'doc', status: 'approved',
    ownerId: 'emp-sales-1', approverId: '昆仑', taskId: 'tk-sales-q3', conversation: 'ch-q3',
    sources: ['CRM 鲲鹏过去 6 月互动 19 条', '客户公开新闻 4 条'],
    knowledgeRefs: ['客户分群 v2', '产品差异化文案库'],
    hash: '0x2a14fe09', ts: '14:32:40', size: '24KB',
  },
  {
    id: 'ev-3', name: '鲲鹏 SaaS 主合同 v4 风险清单.docx', kind: 'doc', status: 'approved',
    ownerId: 'emp-legal', approverId: '昆仑', taskId: 'tk-legal-review', conversation: 'ch-q3',
    sources: ['主合同 v4.docx', '历史同款合同 12 份', '判例库 5 条'],
    knowledgeRefs: ['合同条款 KG · 17 边类型', '数据出境合规规则集'],
    hash: '0x9b67c812', ts: '14:18:00', size: '56KB',
  },
  {
    id: 'ev-4', name: '618 复盘报告 v4.1.pdf', kind: 'pdf', status: 'shipped',
    ownerId: 'emp-ops', approverId: '邓·运营 VP 分身', taskId: 'tk-ops-q3', conversation: 'ch-618',
    sources: ['BI 数仓 gmv_618.sql', '广告投放 ROI 表 v3'],
    knowledgeRefs: ['复盘 SOP 模板 v4', '跨渠道归因模型 v2'],
    hash: '0x3df0a51e', ts: '13:42:00', size: '4.2MB',
  },
  {
    id: 'ev-5', name: 'Q3 增长策略评审会议纪要.memo', kind: 'memo', status: 'archived',
    ownerId: 'emp-meeting-1', approverId: '林·决策官', taskId: 'tk-strategy-q3', conversation: 'ch-q3',
    sources: ['会议录音转写', '议程 + 行动项'],
    knowledgeRefs: ['Q3 OKR 拆解模板'],
    hash: '0x6e11ab44', ts: '13:50:00', size: '38KB',
  },
  {
    id: 'ev-6', name: 'SOP「资金调拨」v4 (沙箱评测).sop', kind: 'sop', status: 'draft',
    ownerId: 'emp-finance', taskId: 'tk-finance-block', conversation: 'ch-hermes',
    sources: ['资金调拨历史 32 次', '风控规则 #R-44'],
    knowledgeRefs: ['企业财务流程图', '四眼原则触发条件'],
    hash: '0xfa72d901', ts: '14:33:48', size: '12KB',
  },
  {
    id: 'ev-7', name: 'API 接口对齐文档 v2.1.md', kind: 'doc', status: 'approved',
    ownerId: 'emp-dev', approverId: 'emp-pm', conversation: 'ch-q3',
    sources: ['OpenAPI spec', '单测计划'],
    knowledgeRefs: ['API 设计规范 v3'],
    hash: '0xc01ab934', ts: '14:40:11', size: '18KB',
  },
  {
    id: 'ev-8', name: '客服情绪识别异常分析报告.report', kind: 'report', status: 'archived',
    ownerId: 'emp-cs', approverId: 'Hermes', conversation: 'ch-hermes',
    sources: ['本周工单 1840 条', '中英混合样本 220 条'],
    knowledgeRefs: ['情绪分类模型 v3 评估集'],
    hash: '0xd91a7e22', ts: '13:50:30', size: '892KB',
  },
];

export default function EvidencePage() {
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [detail, setDetail] = useState<Evidence | null>(null);
  const [exitReq, setExitReq] = useState<{ ev: Evidence; action: ExitActionKind } | null>(null);
  const exitActions = useAppStore((s) => s.exitActions);

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), []);
  const taskMap = useMemo(() => new Map(collabTasks.map((t) => [t.id, t])), []);

  // 已生效的出口动作 → 在对应证据行显示「已生效 → 目标」徽标
  const executedByEvidence = useMemo(() => {
    const m = new Map<string, typeof exitActions>();
    for (const a of exitActions) {
      if (a.status !== 'executed') continue;
      m.set(a.evidenceId, [...(m.get(a.evidenceId) ?? []), a]);
    }
    return m;
  }, [exitActions]);

  const filtered = useMemo(() => evidenceSeed.filter((ev) =>
    (statusFilter === 'all' || ev.status === statusFilter) &&
    (q === '' || ev.name.includes(q) || (empMap.get(ev.ownerId)?.name ?? '').includes(q)),
  ), [q, statusFilter, empMap]);

  return (
    <WorkspacePage
      title="证据库 · 产出物"
      sub="Agent 交付的每个产出物 · 含 hash / 时间戳 / 责任人 / 资料来源 / 知识引用 · 可追溯可审计"
      actions={
        <>
          <button className="hum-btn is-sm"><Filter size={12} /> 高级筛选</button>
          <button className="hum-btn is-sm is-primary"><Download size={12} /> 批量导出</button>
        </>
      }
      sticky={
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative max-w-md flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜产出物 / 责任 Agent / hash…"
              className="hum-input pl-7"
            />
          </div>
          {(['all', 'draft', 'approved', 'shipped', 'archived'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium ${
                statusFilter === s ? 'bg-neutral-900 text-white' : 'hum-card-soft text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {s === 'all' ? '全部' : STATUS_META[s].label}
            </button>
          ))}
          <span className="hum-chip is-muted ml-auto">{filtered.length} / {evidenceSeed.length}</span>
        </div>
      }
    >
      <div className="p-6 grid grid-cols-4 gap-3 mb-4">
        <Stat label="总产出物" value={evidenceSeed.length.toString()} />
        <Stat label="本周交付" value={evidenceSeed.filter((e) => e.status === 'shipped').length.toString()} color="success" />
        <Stat label="待审批" value={evidenceSeed.filter((e) => e.status === 'draft').length.toString()} color="warning" />
        <Stat label="出口动作" value={exitActions.length.toString()} />
      </div>

      {/* 交付出口队列：发起 → 老板审批 → 生效，全程留痕 */}
      <div className="px-6 mb-4">
        <ExitQueue />
      </div>

      <div className="px-6 pb-6">
        <div className="hum-card overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-25" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <tr className="text-[10.5px] uppercase tracking-wider text-neutral-500">
                <th className="text-left px-3 py-2 font-semibold">产出物</th>
                <th className="text-left px-3 py-2 font-semibold">类型</th>
                <th className="text-left px-3 py-2 font-semibold">责任 Agent</th>
                <th className="text-left px-3 py-2 font-semibold">审批</th>
                <th className="text-left px-3 py-2 font-semibold">状态</th>
                <th className="text-left px-3 py-2 font-semibold">Hash</th>
                <th className="text-left px-3 py-2 font-semibold">时间</th>
                <th className="text-right px-3 py-2 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev, i) => {
                const owner = empMap.get(ev.ownerId);
                const km = KIND_META[ev.kind];
                const sm = STATUS_META[ev.status];
                const canExit = ev.status === 'approved' || ev.status === 'shipped';
                const executed = executedByEvidence.get(ev.id) ?? [];
                return (
                  <tr
                    key={ev.id}
                    onClick={() => setDetail(ev)}
                    className="hover:bg-neutral-25 cursor-pointer transition"
                    style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <FileText size={13} style={{ color: km.color }} />
                        <span className="text-neutral-900 font-medium">{ev.name}</span>
                        <span className="hum-faint text-[10px] font-mono">{ev.size}</span>
                      </div>
                      {executed.length > 0 && (
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          {executed.map((a) => (
                            <span key={a.id} className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}>
                              已生效 <ArrowRight size={9} /> {a.target}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="hum-chip" style={{ padding: '1px 6px', fontSize: 10, background: `${km.color}1A`, color: km.color, borderColor: `${km.color}33` }}>
                        {km.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-neutral-700">{owner?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-neutral-700">{ev.approverId ?? '—'}</td>
                    <td className="px-3 py-2.5"><span className={sm.cls} style={{ padding: '1px 6px', fontSize: 10 }}>{sm.label}</span></td>
                    <td className="px-3 py-2.5 hum-faint font-mono text-[11px]">{ev.hash}</td>
                    <td className="px-3 py-2.5 hum-faint font-mono text-[11px]">{ev.ts}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canExit && (['send_client', 'writeback_crm', 'publish'] as ExitActionKind[]).map((k) => {
                          const am = ACTION_META[k];
                          const Icon = am.icon;
                          return (
                            <button
                              key={k}
                              title={`生效动作 · ${am.label}`}
                              onClick={(e) => { e.stopPropagation(); setExitReq({ ev, action: k }); }}
                              className="hum-btn is-sm"
                              style={{ color: am.color, padding: '4px 6px' }}
                            >
                              <Icon size={11} />
                            </button>
                          );
                        })}
                        <button onClick={(e) => { e.stopPropagation(); setDetail(ev); }} className="hum-btn is-sm">
                          <Eye size={11} /> 详情
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="p-8">
              <EmptyState
                icon={<FileText size={18} />}
                title="未匹配到产出物"
                sub="试试不同关键词或调整状态筛选"
              />
            </div>
          )}
        </div>

        <div className="mt-3 text-[11px] hum-faint text-center">
          所有产出物在生成时即写入审计链（hash 取自内容 SHA-256），可追溯可审计
        </div>
      </div>

      {detail && (
        <EvidenceDrawer
          ev={detail} empMap={empMap} taskMap={taskMap}
          onClose={() => setDetail(null)}
        />
      )}

      {exitReq && (
        <ExitActionModal
          evidenceId={exitReq.ev.id}
          evidenceName={exitReq.ev.name}
          action={exitReq.action}
          onClose={() => setExitReq(null)}
        />
      )}
    </WorkspacePage>
  );
}

function EvidenceDrawer({ ev, empMap, taskMap, onClose }: { ev: Evidence; empMap: any; taskMap: any; onClose: () => void }) {
  const owner = empMap.get(ev.ownerId);
  const task = ev.taskId ? taskMap.get(ev.taskId) : null;
  return (
    <div className="absolute top-0 right-0 bottom-0 w-[440px] z-40 bg-white flex flex-col"
      style={{ borderLeft: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-modal)' }}>
      <div className="px-5 py-4 flex items-start gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <FileText size={20} style={{ color: KIND_META[ev.kind].color }} className="mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-neutral-900">{ev.name}</h2>
          <div className="text-[11px] hum-muted font-mono mt-0.5">{ev.size} · {ev.ts} · {ev.hash}</div>
        </div>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900 text-xl">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <Field label="责任 Agent" value={<span className="text-neutral-900">{owner?.name ?? '—'}</span>} />
        <Field label="审批人" value={<span className="text-neutral-900">{ev.approverId ?? '—'}</span>} />
        {task && <Field label="关联任务" value={<span className="text-primary-700">{task.title}</span>} />}
        {ev.conversation && <Field label="关联对话" value={<span className="font-mono text-[11.5px] hum-faint">{ev.conversation}</span>} />}

        <div>
          <div className="hum-eyebrow mb-1.5">资料来源（{ev.sources.length}）</div>
          <ul className="space-y-1">
            {ev.sources.map((s: string, i: number) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px] text-neutral-700">
                <Tag size={11} className="text-neutral-400 mt-0.5" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="hum-eyebrow mb-1.5">知识图谱引用（{ev.knowledgeRefs.length}）</div>
          <div className="flex flex-wrap gap-1">
            {ev.knowledgeRefs.map((k: string) => (
              <span key={k} className="hum-chip is-brand" style={{ padding: '2px 8px' }}>{k}</span>
            ))}
          </div>
        </div>

        <div className="hum-card-soft p-3">
          <div className="hum-eyebrow mb-2 flex items-center gap-1"><Shield size={11} className="text-success" /> 合规凭证</div>
          <div className="space-y-1 text-[11.5px] text-neutral-700">
            <div className="flex justify-between"><span>SHA-256 hash</span><span className="font-mono">{ev.hash}</span></div>
            <div className="flex justify-between"><span>签名</span><span className="text-success">已验证</span></div>
            <div className="flex justify-between"><span>入链</span><span className="font-mono">{ev.ts}</span></div>
            <div className="flex justify-between"><span>状态</span><span className={STATUS_META[ev.status].cls} style={{ padding: '0 6px', fontSize: 10 }}>{STATUS_META[ev.status].label}</span></div>
          </div>
        </div>
      </div>
      <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <button className="hum-btn is-sm flex-1 justify-center"><Eye size={11} /> 预览</button>
        <button className="hum-btn is-sm flex-1 justify-center"><ExternalLink size={11} /> 打开</button>
        <button className="hum-btn is-sm is-primary flex-1 justify-center"><Download size={11} /> 下载</button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className="hum-eyebrow w-20 shrink-0">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: 'success' | 'warning' }) {
  const c = color === 'success' ? 'text-success' : color === 'warning' ? 'text-warning' : 'text-neutral-900';
  return (
    <div className="hum-card p-3">
      <div className="hum-eyebrow">{label}</div>
      <div className={`text-[22px] font-semibold mt-1 hum-tabular ${c}`}>{value}</div>
    </div>
  );
}
