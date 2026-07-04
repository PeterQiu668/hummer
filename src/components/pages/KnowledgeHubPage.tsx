/**
 * 企业知识中枢 — 4 步工作流：接入 → 整理 → 归档 → 图谱
 */
import { useState } from 'react';
import {
  FileText, Upload, Brain, Network, RefreshCw, CheckCircle2, AlertCircle, Clock, Search, ChevronRight,
} from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import { useAppStore } from '../../store/useAppStore';

const STEPS = [
  { id: 'ingest',   label: '知识接入',  icon: Upload,  desc: '上传企业资料 / 连接外部知识源' },
  { id: 'process',  label: '知识整理',  icon: Brain,   desc: '自动分类 + 实体抽取 + 冲突检测' },
  { id: 'archive',  label: '知识归档',  icon: FileText,desc: '形成企业长期记忆 · 按业务流程浏览' },
  { id: 'graph',    label: '图谱可视化',icon: Network, desc: '节点 + 关系 + Agent 调用入口' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export default function KnowledgeHubPage() {
  const [step, setStep] = useState<StepId>('ingest');
  const setShowKG = useAppStore((s) => s.setShowKG);

  return (
    <WorkspacePage
      title="企业知识中枢"
      sub="上传资料 → 系统清洗归档 → 形成企业长期记忆 → Agent 执行任务时调用"
      sticky={
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => {
            const isActive = step === s.id;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => setStep(s.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-[12.5px] font-medium transition ${
                  isActive ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'hum-card-soft text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <span className="font-mono text-[10px] opacity-60">{`0${i + 1}`}</span>
                <Icon size={13} />
                {s.label}
                {i < STEPS.length - 1 && <ChevronRight size={11} className="opacity-40" />}
              </button>
            );
          })}
        </div>
      }
    >
      <div className="p-6">
        {step === 'ingest' && <IngestStep onNext={() => setStep('process')} />}
        {step === 'process' && <ProcessStep onNext={() => setStep('archive')} />}
        {step === 'archive' && <ArchiveStep onNext={() => setStep('graph')} />}
        {step === 'graph' && <GraphStep onOpen={() => setShowKG(true)} />}
      </div>
    </WorkspacePage>
  );
}

/* ───── Step 1 · 接入 ───── */
function IngestStep({ onNext }: { onNext: () => void }) {
  const sources = [
    { name: '飞书文档', type: '协同', count: 1428, status: 'ok', sync: '2 分钟前' },
    { name: '企业微信',  type: '协同', count: 8920, status: 'ok', sync: '7 分钟前' },
    { name: 'Notion',   type: '知识', count: 612,  status: 'ok', sync: '1 小时前' },
    { name: 'Salesforce CRM', type: '业务', count: 3104, status: 'ok', sync: '24 分钟前' },
    { name: '公司官网',   type: '网页', count: 142,  status: 'warning', sync: '失败 · 重试中' },
    { name: 'Google Drive', type: '文件', count: 0, status: 'idle', sync: '未连接' },
  ];

  return (
    <div className="space-y-5">
      <SectionCard
        title="上传企业资料"
        sub="支持 PDF / Word / Excel / PPT / 图片，最大 100MB / 文件"
      >
        <div className="hum-card-soft p-8 border-2 border-dashed text-center" style={{ borderColor: 'var(--border)' }}>
          <Upload size={28} className="mx-auto mb-2 text-neutral-400" />
          <div className="text-[13px] text-neutral-700">点击或拖拽文件到这里</div>
          <div className="text-[11px] hum-faint mt-1">本月已上传 142 份资料 · 还可上传 858 份</div>
          <button className="hum-btn is-sm is-primary mt-3 mx-auto">选择文件</button>
        </div>
      </SectionCard>

      <SectionCard title="外部知识源" sub="连接已有系统，自动同步增量">
        <div className="grid grid-cols-2 gap-2">
          {sources.map((s) => (
            <div key={s.name} className="hum-card p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-neutral-100 grid place-items-center">
                <FileText size={14} className="text-neutral-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium text-neutral-900">{s.name}</div>
                <div className="text-[10.5px] hum-faint">{s.type} · {s.count.toLocaleString()} 文档</div>
              </div>
              <div className="text-right">
                {s.status === 'ok' && <span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}><CheckCircle2 size={10} /> 同步中</span>}
                {s.status === 'warning' && <span className="hum-chip is-warning" style={{ padding: '1px 6px', fontSize: 10 }}><AlertCircle size={10} /> 失败</span>}
                {s.status === 'idle' && <span className="hum-chip is-muted" style={{ padding: '1px 6px', fontSize: 10 }}>未连接</span>}
                <div className="text-[10px] hum-faint mt-1">{s.sync}</div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <button onClick={onNext} className="hum-btn is-primary">进入下一步：知识整理 <ChevronRight size={12} /></button>
      </div>
    </div>
  );
}

/* ───── Step 2 · 整理 ───── */
function ProcessStep({ onNext }: { onNext: () => void }) {
  const categories = [
    { name: '公司介绍',   count: 23,  conflict: 0, color: '#0F70B7' },
    { name: '产品资料',   count: 168, conflict: 2, color: '#0F766E' },
    { name: '客户案例',   count: 92,  conflict: 1, color: '#7E22CE' },
    { name: '销售话术',   count: 421, conflict: 4, color: '#B07706' },
    { name: '合同法务',   count: 88,  conflict: 0, color: '#C13D3D' },
    { name: '流程 SOP',   count: 56,  conflict: 0, color: '#1E8F5C' },
    { name: 'FAQ',       count: 314, conflict: 6, color: '#6B6B65' },
    { name: '组织制度',   count: 41,  conflict: 1, color: '#0F70B7' },
  ];
  return (
    <div className="space-y-5">
      <SectionCard title="抽取进度" sub="系统正在自动分类 · 实体抽取 · 摘要生成">
        <div className="hum-card-soft p-3 space-y-2">
          {[
            { label: '文档分块', pct: 100 },
            { label: '实体抽取', pct: 86 },
            { label: '关系构建', pct: 58 },
            { label: '冲突检测', pct: 34 },
          ].map((row) => (
            <div key={row.label}>
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-neutral-700">{row.label}</span>
                <span className="font-mono hum-tabular hum-muted">{row.pct}%</span>
              </div>
              <div className="h-1 mt-1 rounded-full bg-neutral-100 overflow-hidden">
                <div className="h-full rounded-full bg-primary-500" style={{ width: `${row.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="自动分类结果" sub="点击类别查看待人工确认的条目">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {categories.map((c) => (
            <button key={c.name} className="hum-card p-3 text-left hover:hum-elev-2 transition">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="hum-dot" style={{ background: c.color }} />
                <span className="text-[12.5px] font-medium text-neutral-900">{c.name}</span>
              </div>
              <div className="text-[20px] font-semibold text-neutral-900 hum-tabular">{c.count}</div>
              <div className="text-[10.5px] hum-faint mt-0.5">
                {c.conflict > 0 ? <span className="text-warning">{c.conflict} 条待确认</span> : '已就绪'}
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      <div className="flex justify-between">
        <button className="hum-btn">返回</button>
        <button onClick={onNext} className="hum-btn is-primary">进入下一步：知识归档 <ChevronRight size={12} /></button>
      </div>
    </div>
  );
}

/* ───── Step 3 · 归档 ───── */
function ArchiveStep({ onNext }: { onNext: () => void }) {
  const items = [
    { title: '蓝血军团企业介绍 2026 版', source: '公司官网', dept: '战略', cite: 142, conf: 99 },
    { title: '产品标准报价单 v3.2',     source: '飞书文档', dept: '销售', cite: 88,  conf: 96 },
    { title: '鲲鹏制造主合同 v4',       source: '合同库',   dept: '法务', cite: 12,  conf: 92 },
    { title: '618 复盘报告 v4.1',       source: 'BI 系统',  dept: '运营', cite: 47,  conf: 98 },
    { title: '客服 FAQ 集合 2026Q2',    source: '工单系统', dept: '客服', cite: 1840, conf: 94 },
  ];
  return (
    <div className="space-y-5">
      <SectionCard title="按业务流程浏览" sub="知识条目已结构化 · 含来源 / 可信度 / 引用次数 / 关联 Agent">
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.title} className="hum-card p-3 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-neutral-100 grid place-items-center shrink-0">
                <FileText size={14} className="text-neutral-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-neutral-900">{it.title}</div>
                <div className="text-[11px] hum-faint mt-0.5">{it.source} · {it.dept}</div>
              </div>
              <div className="text-right text-[11px] hum-muted hum-tabular shrink-0">
                <div>引用 {it.cite}</div>
                <div>可信度 {it.conf}%</div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="flex justify-between">
        <button className="hum-btn">返回</button>
        <button onClick={onNext} className="hum-btn is-primary">进入下一步：图谱可视化 <ChevronRight size={12} /></button>
      </div>
    </div>
  );
}

/* ───── Step 4 · 图谱 ───── */
function GraphStep({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="space-y-5">
      <SectionCard title="企业知识图谱" sub="资料 → 整理 → 沉淀 → 图谱 · 这是最终的可视化结果">
        <div className="hum-card-soft p-8 flex flex-col items-center justify-center text-center min-h-[40vh]">
          <div className="w-16 h-16 rounded-full bg-primary-50 grid place-items-center text-primary-700 mb-3">
            <Network size={28} />
          </div>
          <div className="text-[15px] font-semibold text-neutral-900">9,632 条边 · 2,108 个实体</div>
          <div className="text-[12.5px] hum-muted mt-1 max-w-md">
            节点类型包括人、部门、产品、客户、项目、流程、文档、技能、Agent、风险点；
            边类型包括负责、引用、依赖、审批、服务、竞争、归属、触发。
          </div>
          <button onClick={onOpen} className="hum-btn is-primary mt-4">
            打开企业知识图谱 <ChevronRight size={12} />
          </button>
        </div>
      </SectionCard>

      <div className="hum-card-soft p-3 text-[11.5px] text-neutral-600">
        <Search size={11} className="inline -mt-0.5 mr-1" />
        Agent 在执行任务时会自动检索这张图谱：例如「雪·销售官」起草 BD 邮件前，会先查询客户实体 + 互动史 + 法务条款。
      </div>
    </div>
  );
}

function SectionCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <h3 className="hum-h2">{title}</h3>
        {sub && <p className="text-[12px] hum-muted mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
