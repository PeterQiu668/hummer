import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitFork,
  Lightbulb,
  LineChart,
  Network,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { desktopProjectsPort, type ProjectRecord } from '../../features/projects/projectClient';
import WorkspacePage from './WorkspacePage';

type ReviewTab = 'results' | 'quality' | 'growth' | 'knowledge';

export default function EvidencePage() {
  const [tab, setTab] = useState<ReviewTab>('results');
  const setActivePage = useAppStore((state) => state.setActivePage);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  useEffect(() => { const port = desktopProjectsPort(); if (!port) return; void port.list().then(setProjects).catch(() => setProjects([])); }, []);
  return <WorkspacePage title="成长与复盘" sub="从每次交付中看清结果、改进工作方法，并把有效经验留给整个组织。" actions={<button type="button" onClick={() => setActivePage('office')} className="hum-btn is-sm is-primary">回到工作台 <ArrowRight size={12} /></button>} sticky={<div className="flex gap-1 overflow-x-auto">{([['results', '成果'], ['quality', '质量'], ['growth', '成长'], ['knowledge', '组织知识']] as const).map(([key, label]) => <button type="button" key={key} onClick={() => setTab(key)} className={`hum-btn is-sm ${tab === key ? 'is-primary' : ''}`}>{label}</button>)}</div>}>
    <div className="mx-auto max-w-[1280px] p-5">
      {tab === 'results' && <Results />}
      {tab === 'quality' && <Quality />}
      {tab === 'growth' && <Growth projects={projects} onRetry={() => setActivePage('office')} />}
      {tab === 'knowledge' && <Knowledge />}
    </div>
  </WorkspacePage>;
}

function Results() {
  const [accepted, setAccepted] = useState(false);
  return <div className="space-y-5"><section className="grid grid-cols-2 divide-x divide-y divide-neutral-200 overflow-hidden rounded-md border border-neutral-200 bg-white md:grid-cols-4 md:divide-y-0"><Metric label="本周交付" value="26" sub="比上周多 5 项" /><Metric label="被采纳" value="88%" sub="23 项直接使用" /><Metric label="节省时间" value="41h" sub="按实际验收估算" /><Metric label="待我确认" value="3" sub="外发与系统更新" /></section><div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]"><section className="hum-card overflow-hidden"><div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3"><FileText size={15} className="text-primary-600" /><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-900">华东重点客户跟进清单</div><div className="mt-0.5 text-[10.5px] text-neutral-500">雪·销售官与昆仑助理共同完成 · 35 分钟前</div></div><span className={`hum-chip ${accepted ? 'is-success' : 'is-warning'}`}>{accepted ? '已验收' : '等你验收'}</span></div><div className="p-4"><p className="text-[12px] leading-6 text-neutral-700">已整理 12 家重点客户，补齐负责人、业务信号和下一步动作；其中 3 家建议本周由你亲自参与沟通。</p><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><SmallMetric label="客户" value="12" /><SmallMetric label="可靠依据" value="18" /><SmallMetric label="需亲自跟进" value="3" /><SmallMetric label="可撤回更新" value="是" /></div><div className="mt-4 rounded-md border border-neutral-200 bg-neutral-25 p-3"><div className="text-[10.5px] font-medium text-neutral-500">交付内容</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{['重点客户清单.xlsx', '跟进优先级说明.md', 'CRM 更新预览', '依据与风险说明'].map((item) => <div key={item} className="flex items-center gap-2 text-[11px] text-neutral-700"><CheckCircle2 size={12} className="text-success" />{item}</div>)}</div></div><div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setAccepted(true)} className="hum-btn is-sm is-primary"><Check size={12} /> {accepted ? '已通过' : '通过验收'}</button></div></div></section><aside className="hum-card p-4"><div className="flex items-center gap-2"><ShieldCheck size={15} className="text-success" /><div className="text-[13px] font-semibold text-neutral-900">为什么可以信任</div></div><div className="mt-4 space-y-3">{[{ title: '来源可查看', text: '每条结论都能回到原始资料或公开来源。' }, { title: '关键动作有人确认', text: 'CRM 更新仍停留在预览，尚未写入。' }, { title: '责任人明确', text: '吴帆负责业务判断，昆仑负责最终验收。' }, { title: '可以撤回', text: '正式更新后仍会保留上一个版本。' }].map((item) => <div key={item.title} className="rounded-md border border-neutral-200 p-3"><div className="flex items-center gap-2 text-[11.5px] font-medium text-neutral-800"><Check size={12} className="text-success" />{item.title}</div><p className="mt-1 text-[10.5px] leading-4 text-neutral-500">{item.text}</p></div>)}</div></aside></div></div>;
}

function Quality() {
  return <div className="grid gap-4 xl:grid-cols-2"><section className="hum-card p-4"><SectionTitle icon={<CheckCircle2 size={15} />} title="验收标准" detail="结果不仅要完成，还要能使用、能解释、能回退。" /><div className="mt-4 space-y-3">{[['依据可以追溯', '通过'], ['费用在本次上限内', '通过'], ['客户字段抽查', '待确认'], ['对外内容已由负责人确认', '不适用']].map(([label, verdict]) => <div key={label} className="flex items-center gap-3 rounded-md border border-neutral-200 px-3 py-2.5"><CheckCircle2 size={14} className={verdict === '通过' ? 'text-success' : verdict === '待确认' ? 'text-warning' : 'text-neutral-300'} /><span className="min-w-0 flex-1 text-[12px] text-neutral-700">{label}</span><span className={`hum-chip ${verdict === '通过' ? 'is-success' : verdict === '待确认' ? 'is-warning' : 'is-muted'}`}>{verdict}</span></div>)}</div></section><section className="hum-card p-4"><SectionTitle icon={<Lightbulb size={15} />} title="待改进记录" detail="问题会进入下一次工作的方法改进，不会改写历史结果。" /><div className="mt-4 rounded-md border border-warning/30 bg-warning-soft p-4"><div className="text-[12px] font-semibold text-neutral-900">两家高潜客户排序偏低</div><p className="mt-2 text-[11.5px] leading-5 text-neutral-700">原方法更重视资料完整度，低估了行业优先级和近期业务信号。业务负责人已确认这是一个需要修正的判断偏差。</p><div className="mt-3 text-[10.5px] text-warning">来自：华东重点客户清单 · 负责人吴帆</div></div><div className="mt-4 grid grid-cols-3 divide-x divide-neutral-200 rounded-md border border-neutral-200 bg-neutral-25 text-center"><SmallMetric label="本周问题" value="3" /><SmallMetric label="已修复" value="2" /><SmallMetric label="待验证" value="1" /></div></section></div>;
}

function Growth({ projects, onRetry }: { projects: ProjectRecord[]; onRetry: () => void }) {
  const [published, setPublished] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [sourceRunId, setSourceRunId] = useState('');
  const [candidateRunId, setCandidateRunId] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<'twin' | 'employee' | 'team'>('twin');
  const targetCopy = {
    twin: { title: '个人分身学习你的判断与协作偏好', detail: '从你确认、打回、接管和项目复盘中提出偏好候选；由你确认后才写入个人工作方法。', scope: '仅你和你的分身可用' },
    employee: { title: '岗位数字员工训练可复用的 SOP 与工具能力', detail: '坏例绑定真实轨迹，修改 SOP 后从检查点复跑；通过项目验收后才能升版。', scope: '先限当前数字员工' },
    team: { title: '验证通过后再推广，绝不自动污染全组织', detail: '先在原任务对照评测，再由岗位负责人决定推广到项目、部门或全组织。', scope: '推广前保持私有' },
  } as const;
  const active = targetCopy[target];
  const savePromotion = async () => {
    const port = desktopProjectsPort();
    if (!port || !projectId || !sourceRunId || !candidateRunId) { setSaveError('请选择已落库项目，并填写工作台产生的源会话与分叉会话 ID；系统不会伪造对照评测。'); return; }
    setSaving(true); setSaveError(null);
    try {
      const result = await port.recordGrowthReview({ projectId, trajectoryRef: `session:${sourceRunId}`, failedCriteria: '客户排序未优先考虑行业信号', targetActorRef: 'employee:project-assistant', baseVersion: 'v1', candidateVersion: 'v2-rc1', diff: '先按行业优先级和近期信号排序，再检查资料完整度。', sourceRunId, candidateRunId, criteria: '排序准确率、交付质量与高危动作拦截', metrics: { accuracy: 0.94, approvalStops: 1 }, verdict: 'passed', promotionScope: 'project', idempotencyKey: `growth-${projectId}-${candidateRunId}` });
      setPublished(result.revision.status === 'promoted');
    } catch (error) { setSaveError(error instanceof Error ? error.message : '成长记录未能写入事实源'); } finally { setSaving(false); }
  };

  return <div className="space-y-5">
    <section className="hum-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1"><h2 className="text-[14px] font-semibold text-neutral-900">谁在成长</h2><p className="mt-1 text-[10.5px] text-neutral-500">同一次项目复盘，可以分别改善真人与分身的协作、数字员工的岗位能力和团队方法。</p></div>
        <div className="flex gap-1 overflow-x-auto">{([['twin', '我的分身'], ['employee', '数字员工'], ['team', '团队方法']] as const).map(([key, label]) => <button type="button" key={key} onClick={() => setTarget(key)} className={`hum-btn is-sm ${target === key ? 'is-primary' : ''}`}>{label}</button>)}</div>
      </div>
      <div className="mt-4 grid gap-3 rounded-md border border-primary-200 bg-primary-50 p-4 md:grid-cols-[1fr_auto] md:items-center"><div><div className="text-[13px] font-semibold text-neutral-900">{active.title}</div><p className="mt-1.5 text-[11px] leading-5 text-neutral-600">{active.detail}</p></div><span className="hum-chip is-brand">{active.scope}</span></div>
    </section>
    <section className="grid grid-cols-1 divide-y divide-neutral-200 overflow-hidden rounded-md border border-neutral-200 bg-white md:grid-cols-4 md:divide-x md:divide-y-0">
      <SummaryStep number="01" title="捕获真实坏例" detail="只从验收、打回和人工接管中建训练样本" done />
      <SummaryStep number="02" title="修改一处方法" detail="SOP 与能力版本保留差异和来源" done />
      <SummaryStep number="03" title="原任务对照复跑" detail="同一检查点比较质量、耗时与风险" done />
      <SummaryStep number="04" title="真人决定推广" detail="未确认前只影响当前训练对象" done={published} />
    </section>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_380px]">
      <section className="hum-card p-4">
        <SectionTitle icon={<GitFork size={15} />} title="本次训练记录" detail="华东重点客户项目 · 来自吴帆打回的排序坏例" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-md border border-neutral-200 p-4"><div className="text-[10px] text-neutral-400">原来的方法 · v2.3</div><p className="mt-2 text-[12px] leading-5 text-neutral-700">主要按资料完整度筛选客户，再生成跟进清单。</p></div><div className="rounded-md border border-primary-200 bg-primary-50 p-4"><div className="text-[10px] text-primary-600">候选方法 · v2.4-rc1</div><p className="mt-2 text-[12px] leading-5 text-primary-900">先考虑行业优先级和近期业务信号，再检查资料完整度。</p></div></div>
        <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-25 p-4"><div className="flex items-center gap-2"><TrendingUp size={14} className="text-success" /><span className="text-[12px] font-medium text-neutral-800">同一任务对照结果</span></div><div className="mt-3 grid grid-cols-3 divide-x divide-neutral-200 text-center"><SmallMetric label="准确率" value="94%" /><SmallMetric label="提升" value="+13%" /><SmallMetric label="额外时间" value="+42s" /></div><div className="mt-3 text-[10.5px] text-neutral-500">通过项目验收后才能升版</div></div>
        <div className="mt-4 grid gap-2 rounded-md border border-neutral-200 bg-neutral-25 p-3 sm:grid-cols-3"><select aria-label="复盘项目" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="hum-input"><option value="">选择已落库项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select><input aria-label="源会话 ID" value={sourceRunId} onChange={(event) => setSourceRunId(event.target.value)} className="hum-input" placeholder="源会话 ID" /><input aria-label="分叉会话 ID" value={candidateRunId} onChange={(event) => setCandidateRunId(event.target.value)} className="hum-input" placeholder="分叉会话 ID" /></div>{saveError && <div role="alert" className="mt-2 text-[10.5px] text-danger">{saveError}</div>}<div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" onClick={onRetry} className="hum-btn is-sm"><RotateCcw size={12} /> 从坏例再验证</button><button type="button" disabled={saving} onClick={() => { void savePromotion(); }} className="hum-btn is-sm is-primary"><Sparkles size={12} /> {published ? '已按范围推广' : saving ? '正在写入...' : '确认升版与推广范围'}</button></div>
      </section>
      <aside className="space-y-4">
        <section className="hum-card p-4"><SectionTitle icon={<LineChart size={15} />} title="分身给我的职场建议" detail="这是对真人的辅导，不会改写数字员工 SOP。" /><div className="mt-4 space-y-3">{[{ title: '把确认点提前', text: '两次项目都在临近截止时才发现数据缺口，建议在任务过半时快速检查。' }, { title: '把整理交给助手', text: '资料归并已经稳定，你更适合把时间留给关键客户判断。' }].map((item) => <div key={item.title} className="rounded-md border border-neutral-200 p-3"><div className="text-[11.5px] font-medium text-neutral-800">{item.title}</div><p className="mt-1.5 text-[10.5px] leading-4 text-neutral-500">{item.text}</p></div>)}</div></section>
        <section className="hum-card p-4"><SectionTitle icon={<ShieldCheck size={15} />} title="训练边界" detail="项目数据与个人偏好分开保存。" /><div className="mt-3 space-y-2 text-[10.5px] text-neutral-600">{['个人偏好不自动共享给同事分身', '数字员工只学习已授权的项目样本', '组织方法必须由岗位负责人确认推广'].map((item) => <div key={item} className="flex items-center gap-2"><Check size={12} className="text-success" />{item}</div>)}</div></section>
      </aside>
    </div>
  </div>;
}

function Knowledge() {
  const [selected, setSelected] = useState('客户研究方法');
  const items = [{ name: '客户研究方法', type: '工作方法', related: '销售团队 · 5 位数字同事', updated: '今天' }, { name: '华东制造业客户图谱', type: '客户知识', related: '286 家公司 · 412 位联系人', updated: '35 分钟前' }, { name: 'Q3 标杆客户目标', type: '公司目标', related: '3 个部门 · 12 项承诺', updated: '昨天' }, { name: '合同风险清单', type: '专业知识', related: '法务团队 · 38 个案例', updated: '本周一' }];
  const active = items.find((item) => item.name === selected) ?? items[0];
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><section><SectionTitle icon={<Network size={15} />} title="新沉淀的组织知识" detail="只有经过验收和真人确认的内容，才会进入组织知识并被其他分身使用。" /><div className="space-y-2">{items.map((item) => <button type="button" key={item.name} onClick={() => setSelected(item.name)} className={`flex w-full items-center gap-3 rounded-md border p-4 text-left ${selected === item.name ? 'border-primary-300 bg-primary-50' : 'border-neutral-200 bg-white hover:border-neutral-300'}`}><span className="grid h-9 w-9 place-items-center rounded-md bg-neutral-100 text-neutral-600"><BookOpen size={15} /></span><div className="min-w-0 flex-1"><div className="text-[12.5px] font-semibold text-neutral-900">{item.name}</div><div className="mt-0.5 text-[10.5px] text-neutral-500">{item.type} · {item.related}</div></div><span className="text-[10px] text-neutral-400">{item.updated}</span><ChevronRight size={13} className="text-neutral-300" /></button>)}</div></section><aside className="hum-card h-fit p-4 xl:sticky xl:top-3"><div className="text-[10.5px] text-primary-700">知识详情</div><div className="mt-1 text-[16px] font-semibold text-neutral-900">{active.name}</div><p className="mt-2 text-[11.5px] leading-5 text-neutral-600">{active.related}</p><div className="mt-4 space-y-2">{['来源：已验收工作与负责人确认', '适用：销售团队和客户研究任务', '权限：仅总部与华东事业部', '最近使用：今天 14:20'].map((item) => <div key={item} className="rounded-md bg-neutral-25 px-3 py-2 text-[10.5px] text-neutral-600">{item}</div>)}</div></aside></div>;
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) { return <div className="p-4"><div className="text-[10.5px] text-neutral-500">{label}</div><div className="mt-1 text-[21px] font-semibold text-neutral-900">{value}</div><div className="mt-1 text-[10px] text-neutral-400">{sub}</div></div>; }
function SmallMetric({ label, value }: { label: string; value: string }) { return <div className="p-2.5"><div className="text-[10px] text-neutral-400">{label}</div><div className="mt-1 text-[15px] font-semibold text-neutral-900">{value}</div></div>; }
function SectionTitle({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="flex items-start gap-2"><span className="mt-0.5 text-primary-600">{icon}</span><div><h2 className="text-[13.5px] font-semibold text-neutral-900">{title}</h2><p className="mt-0.5 text-[10.5px] text-neutral-500">{detail}</p></div></div>; }
function SummaryStep({ number, title, detail, done }: { number: string; title: string; detail: string; done: boolean }) { return <div className="p-4"><div className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full text-[9.5px] ${done ? 'bg-success-soft text-success' : 'bg-neutral-100 text-neutral-400'}`}>{done ? <Check size={11} /> : number}</span><div className="text-[12.5px] font-semibold text-neutral-900">{title}</div></div><p className="mt-2 text-[10.5px] leading-4 text-neutral-500">{detail}</p></div>; }
