import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  ChevronRight,
  CircleUserRound,
  Network,
  Orbit,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import { employees } from '../../data/employees';
import { desktopOrganizationPort, type DigitalEmployeeRecord } from '../../features/organization/organizationClient';
import { marketEmployees } from '../../data/marketplace';
import { useAppStore } from '../../store/useAppStore';
import AgentAvatar from '../ui/AgentAvatar';
import WorkspacePage from './WorkspacePage';

type TeamTab = 'mine' | 'organization' | 'relations';

const humanColleagues = [
  { name: '吴帆', role: '销售负责人', relation: '向你汇报', focus: '华东标杆客户与销售节奏', work: '2 项需要你确认' },
  { name: '陈若澜', role: '产品与交付负责人', relation: '协作伙伴', focus: '客户实施与交付质量', work: '1 项跨部门协作' },
  { name: '小周', role: '销售专员', relation: '团队成员', focus: '重点客户跟进与会议准备', work: '今天有 3 项工作' },
];

const departments = [
  { name: '增长与销售', owner: '吴帆', people: '4 位真人', twins: '4 个个人分身', digital: '5 位数字同事', current: '华东标杆客户计划', health: '节奏正常' },
  { name: '产品与交付', owner: '陈若澜', people: '6 位真人', twins: '5 个个人分身', digital: '4 位数字同事', current: '客户实施验收', health: '1 项风险' },
  { name: '组织与管理', owner: '昆仑', people: '3 位真人', twins: '3 个个人分身', digital: '2 位数字同事', current: 'Q3 经营复盘', health: '等待确认' },
];

export default function EmployeesPage() {
  const [tab, setTab] = useState<TeamTab>('mine');
  const [query, setQuery] = useState('');
  const [hireOpen, setHireOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hiredEmployees, setHiredEmployees] = useState<DigitalEmployeeRecord[]>([]);
  const [organizationError, setOrganizationError] = useState<string | null>(null);
  const settings = useAppStore((state) => state.personalSettings);
  const filtered = useMemo(() => employees.filter((employee) => !query || `${employee.name} ${employee.role} ${employee.currentTask ?? ''}`.includes(query)), [query]);
  const selected = employees.find((employee) => employee.id === selectedId);

  useEffect(() => {
    const organization = desktopOrganizationPort();
    if (!organization) {
      setOrganizationError('浏览器原型未连接本地组织事实源；请在 HUMMER 桌面版中管理团队。');
      return;
    }
    let active = true;
    void organization.listDigitalEmployees('tenant_demo').then((records) => {
      if (active) setHiredEmployees(records);
    }).catch((error: unknown) => {
      if (active) setOrganizationError(error instanceof Error ? error.message : '读取团队事实源失败');
    });
    return () => { active = false; };
  }, []);

  const hireEmployee = async (candidateId: string) => {
    const organization = desktopOrganizationPort();
    const candidate = marketEmployees.find((item) => item.id === candidateId);
    if (!organization || !candidate) {
      setOrganizationError('当前环境没有可写的组织事实源，未创建数字同事。');
      return;
    }
    try {
      const record = await organization.hireDigitalEmployee({ id: `employee_${candidate.id}`, tenantId: 'tenant_demo', sponsorActorRef: 'human:owner', departmentId: candidate.category.includes('销售') ? 'department_sales' : 'department_operations', name: candidate.name, jobTitle: candidate.category, runtimeProfile: 'standard', autonomyLevel: 'L2', idempotencyKey: `hire-${candidate.id}` });
      setHiredEmployees((current) => current.some((employee) => employee.id === record.id) ? current : [...current, record]);
      setOrganizationError(null);
      setHireOpen(false);
    } catch (error) {
      setOrganizationError(error instanceof Error ? error.message : '数字同事未能写入组织事实源');
    }
  };

  return <WorkspacePage title="团队协作" sub="看清真人、个人分身、数字同事与专家之间的责任和协作关系。" actions={<button type="button" onClick={() => setHireOpen(true)} className="hum-btn is-sm is-primary"><Plus size={12} /> 添加数字同事</button>} sticky={<div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="flex flex-1 gap-1"><Tab active={tab === 'mine'} onClick={() => setTab('mine')} icon={<UsersRound size={12} />} label="我的团队" /><Tab active={tab === 'organization'} onClick={() => setTab('organization')} icon={<Building2 size={12} />} label="组织协作" /><Tab active={tab === 'relations'} onClick={() => setTab('relations')} icon={<Network size={12} />} label="协作关系" /></div><div className="relative w-full sm:w-72"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" /><input aria-label="搜索团队成员" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索同事、职责或当前工作" className="hum-input pl-7" /></div></div>}>
    <div className="mx-auto max-w-[1320px] p-5">
      {organizationError && <div role="status" className="mb-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] text-neutral-700">{organizationError}</div>}
      {tab === 'mine' && <MyTeam twinName={settings.twinName} employees={filtered} hiredEmployees={hiredEmployees} onSelect={setSelectedId} />}
      {tab === 'organization' && <OrganizationView />}
      {tab === 'relations' && <RelationsView />}
    </div>
    {selected && <MemberDrawer member={selected} onClose={() => setSelectedId(null)} />}
    {hireOpen && <HireDrawer onClose={() => setHireOpen(false)} onHire={(id) => { void hireEmployee(id); }} />}
  </WorkspacePage>;
}

function MyTeam({ twinName, employees: team, hiredEmployees, onSelect }: { twinName: string; employees: Array<(typeof employees)[number]>; hiredEmployees: DigitalEmployeeRecord[]; onSelect: (id: string) => void }) {
  return <div className="space-y-6"><section className="grid overflow-hidden rounded-md border border-neutral-200 bg-white lg:grid-cols-[1.15fr_0.85fr]"><div className="p-5"><div className="flex items-start gap-4"><div className="grid h-12 w-12 place-items-center rounded-full bg-neutral-900 text-white"><Orbit size={21} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-[16px] font-semibold text-neutral-900">{twinName}</h2><span className="hum-chip is-success">我的分身 · 在线</span></div><p className="mt-1 text-[11.5px] text-neutral-500">代表你协调内部工作，也会根据目标和复盘给出职场建议。</p></div></div><div className="mt-5 grid grid-cols-3 divide-x divide-neutral-200 rounded-md border border-neutral-200 bg-neutral-25 text-center"><MiniMetric value="4" label="正在协调" /><MiniMetric value="2" label="等你确认" /><MiniMetric value="92%" label="建议采纳" /></div></div><div className="border-t border-neutral-200 bg-neutral-25 p-5 lg:border-l lg:border-t-0"><div className="text-[11px] font-medium text-neutral-500">当前代表范围</div><div className="mt-3 space-y-2">{['接受内部工作并安排优先级', '协调数字同事并汇总结果', '外发、付款和权限变化前必须问你'].map((item, index) => <div key={item} className="flex items-center gap-2 text-[11.5px] text-neutral-700">{index === 2 ? <ShieldCheck size={13} className="text-warning" /> : <Check size={13} className="text-success" />}{item}</div>)}</div><button type="button" className="hum-btn is-sm mt-4">调整代表范围</button></div></section>

    <section><SectionTitle icon={<CircleUserRound size={15} />} title="真人同事" detail="你仍然和真人共同负责结果，分身只承担明确授权的协调工作。" /><div className="grid grid-cols-1 gap-3 lg:grid-cols-3">{humanColleagues.map((person) => <div key={person.name} className="hum-card p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-neutral-800 text-[11px] text-white">{person.name.slice(0, 1)}</div><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-900">{person.name}</div><div className="text-[10.5px] text-neutral-500">{person.role} · {person.relation}</div></div></div><div className="mt-3 text-[11.5px] leading-5 text-neutral-600">{person.focus}</div><div className="mt-3 rounded-md bg-neutral-25 px-3 py-2 text-[10.5px] text-neutral-500">{person.work}</div></div>)}</div></section>

    <section><SectionTitle icon={<Bot size={15} />} title="数字同事" detail="每位数字同事都有岗位、负责人、能力范围和需要真人确认的事项。" /><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{team.map((employee) => <button type="button" key={employee.id} onClick={() => onSelect(employee.id)} className="hum-card min-h-[156px] p-4 text-left transition hover:border-neutral-300 hover:shadow-sm"><div className="flex items-start gap-3"><AgentAvatar id={employee.id} size={40} status={employee.status} ringWidth={2} /><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate text-[13px] font-semibold text-neutral-900">{employee.name}</span><span className={`hum-chip ${employee.status === 'working' ? 'is-brand' : 'is-muted'}`} style={{ padding: '1px 5px', fontSize: 10 }}>{employee.status === 'working' ? '工作中' : '待命'}</span></div><div className="mt-0.5 text-[11px] text-neutral-500">{employee.role}</div></div><ChevronRight size={14} className="mt-1 text-neutral-300" /></div><div className="mt-3 line-clamp-2 text-[11px] leading-4 text-neutral-700">{employee.currentTask ?? '等待新的工作安排'}</div><div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2.5 text-[10.5px] text-neutral-500"><span>负责人：昆仑</span><span>本周交付 {2 + employee.id.length % 5} 项</span></div></button>)}</div></section>

    {hiredEmployees.length > 0 && <section><SectionTitle icon={<Sparkles size={15} />} title="试用中的数字同事" detail="试用期间只获得当前任务需要的最小权限。" /><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{hiredEmployees.map((employee) => <div key={employee.id} data-employee-id={employee.id} className="hum-card p-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-md bg-primary-600 text-white"><Bot size={16} /></div><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold text-neutral-900">{employee.name}</div><div className="text-[11px] text-neutral-500">{employee.jobTitle} · 7 天试用</div><div className="mt-1 font-mono text-[9px] text-neutral-400">{employee.id}</div></div><Check size={15} className="text-success" /></div></div>)}</div></section>}
  </div>;
}

function OrganizationView() {
  return <div className="space-y-5"><section className="grid grid-cols-1 divide-y divide-neutral-200 overflow-hidden rounded-md border border-neutral-200 bg-white md:grid-cols-3 md:divide-x md:divide-y-0"><MiniMetric value="13" label="真人成员" /><MiniMetric value="12" label="个人分身" /><MiniMetric value="11" label="数字同事" /></section><section><SectionTitle icon={<Building2 size={15} />} title="部门协作" detail="部门负责人对结果负责，分身负责跨团队协调，数字同事承担可验收工作。" /><div className="space-y-3">{departments.map((department) => <div key={department.name} className="hum-card grid gap-4 p-4 lg:grid-cols-[1fr_1.4fr_auto] lg:items-center"><div><div className="text-[13px] font-semibold text-neutral-900">{department.name}</div><div className="mt-1 text-[10.5px] text-neutral-500">负责人：{department.owner}</div></div><div><div className="flex flex-wrap gap-2 text-[10.5px]"><span className="hum-chip">{department.people}</span><span className="hum-chip is-brand">{department.twins}</span><span className="hum-chip is-success">{department.digital}</span></div><div className="mt-2 text-[11px] text-neutral-600">当前重点：{department.current}</div></div><span className={`hum-chip ${department.health.includes('风险') ? 'is-warning' : department.health.includes('等待') ? 'is-brand' : 'is-success'}`}>{department.health}</span></div>)}</div></section></div>;
}

function RelationsView() {
  const [selected, setSelected] = useState('昆仑');
  const nodes = [{ name: '昆仑', type: '真人负责人', tone: 'dark' }, { name: '昆仑助理', type: '个人分身', tone: 'brand' }, { name: '吴帆', type: '销售负责人', tone: 'neutral' }, { name: '雪·销售官', type: '数字同事', tone: 'success' }, { name: '林知远', type: '外部专家', tone: 'warning' }, { name: '华东客户知识', type: '共享知识', tone: 'neutral' }];
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"><section><SectionTitle icon={<Network size={15} />} title="协作关系" detail="点击成员可查看谁向谁负责、谁可以代表谁，以及共享了哪些知识。" /><div className="relative grid min-h-[430px] grid-cols-2 content-center gap-4 rounded-md border border-neutral-200 bg-white p-6 sm:grid-cols-3">{nodes.map((node) => <button type="button" key={node.name} onClick={() => setSelected(node.name)} className={`relative z-10 min-h-[88px] rounded-md border p-3 text-left ${selected === node.name ? 'border-primary-400 bg-primary-50 shadow-sm' : 'border-neutral-200 bg-white hover:bg-neutral-25'}`}><div className="flex items-center gap-2"><span className={`grid h-7 w-7 place-items-center rounded-full ${node.tone === 'dark' ? 'bg-neutral-900 text-white' : node.tone === 'brand' ? 'bg-primary-100 text-primary-700' : node.tone === 'success' ? 'bg-success-soft text-success' : node.tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-neutral-100 text-neutral-600'}`}>{node.type.includes('知识') ? <Network size={12} /> : node.type.includes('分身') ? <Orbit size={12} /> : <UsersRound size={12} />}</span><span className="text-[12px] font-semibold text-neutral-900">{node.name}</span></div><div className="mt-2 text-[10.5px] text-neutral-500">{node.type}</div></button>)}</div></section><aside className="hum-card h-fit p-4 xl:sticky xl:top-3"><div className="text-[10.5px] text-primary-700">当前查看</div><div className="mt-1 text-[16px] font-semibold text-neutral-900">{selected}</div><div className="mt-4 space-y-2 text-[11px] text-neutral-600"><Relation label="结果负责人" value={selected === '昆仑' ? '本人' : '昆仑'} /><Relation label="可代表范围" value={selected.includes('助理') ? '内部协调与信息汇总' : '按岗位授权'} /><Relation label="共享知识" value="公司目标 · 华东客户 · 销售方法" /><Relation label="必须确认" value="外发 · 写回 · 付款 · 权限变化" /></div></aside></div>;
}

function MemberDrawer({ member, onClose }: { member: typeof employees[number]; onClose: () => void }) {
  return <div className="absolute inset-0 z-40 bg-white/60" onClick={onClose}><aside className="absolute bottom-0 right-0 top-0 w-full max-w-[420px] border-l border-neutral-200 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start gap-3 border-b border-neutral-200 p-5"><AgentAvatar id={member.id} size={44} status={member.status} /><div className="min-w-0 flex-1"><h2 className="text-[16px] font-semibold text-neutral-900">{member.name}</h2><p className="mt-1 text-[11px] text-neutral-500">{member.role}</p></div><button type="button" aria-label="关闭成员详情" onClick={onClose} className="text-neutral-400"><X size={18} /></button></div><div className="space-y-5 p-5"><DetailBlock title="当前工作" value={member.currentTask ?? '等待新的工作安排'} /><DetailBlock title="向谁负责" value="昆仑 · 最终结果由真人负责人确认" /><DetailBlock title="可以做" value="读取授权资料、整理信息、生成草稿、调用已批准的工作应用" /><DetailBlock title="必须先问" value="客户外发、业务系统写回、付款、删除和权限变化" /><div className="grid grid-cols-2 gap-3"><MiniMetric value="94%" label="结果采纳率" /><MiniMetric value="3" label="本周交付" /></div><button type="button" className="hum-btn is-primary w-full justify-center">交给他一项工作 <ArrowRight size={12} /></button></div></aside></div>;
}

function HireDrawer({ onClose, onHire }: { onClose: () => void; onHire: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const candidates = marketEmployees.filter((candidate) => !query || `${candidate.name} ${candidate.category} ${candidate.tagline}`.includes(query)).slice(0, 6);
  return <div className="absolute inset-0 z-40 bg-white/70" onClick={onClose}><aside className="absolute bottom-0 right-0 top-0 flex w-full max-w-[440px] flex-col border-l border-neutral-200 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start gap-3 border-b border-neutral-200 p-5"><div className="grid h-9 w-9 place-items-center rounded-md bg-neutral-900 text-white"><Sparkles size={16} /></div><div className="flex-1"><h2 className="text-[16px] font-semibold text-neutral-900">添加数字同事</h2><p className="mt-1 text-[11.5px] leading-4 text-neutral-500">先用一项真实工作试用 7 天，通过验收后再加入团队。</p></div><button type="button" aria-label="关闭添加数字同事" onClick={onClose} className="text-neutral-400"><X size={18} /></button></div><div className="border-b border-neutral-200 p-4"><div className="relative"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" /><input aria-label="搜索数字同事" value={query} onChange={(event) => setQuery(event.target.value)} className="hum-input pl-7" placeholder="搜索岗位或能力" /></div></div><div className="flex-1 space-y-2 overflow-y-auto p-4">{candidates.map((candidate) => <div key={candidate.id} className="rounded-md border border-neutral-200 p-3"><div className="flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-md text-white" style={{ background: candidate.color }}>{candidate.avatar}</div><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-900">{candidate.name}</div><div className="mt-0.5 text-[11px] text-neutral-500">{candidate.category}</div><p className="mt-1.5 text-[11px] leading-4 text-neutral-600">{candidate.tagline}</p></div></div><button type="button" onClick={() => onHire(candidate.id)} className="hum-btn is-sm is-primary mt-3 w-full justify-center"><Plus size={12} /> 开始 7 天试用</button></div>)}</div></aside></div>;
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button type="button" onClick={onClick} className={`hum-btn is-sm ${active ? 'is-primary' : ''}`}>{icon}{label}</button>; }
function SectionTitle({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="mb-3 flex items-start gap-2"><span className="mt-0.5 text-primary-600">{icon}</span><div><h2 className="text-[14px] font-semibold text-neutral-900">{title}</h2><p className="mt-0.5 text-[11px] text-neutral-500">{detail}</p></div></div>; }
function MiniMetric({ value, label }: { value: string; label: string }) { return <div className="p-3"><div className="text-[17px] font-semibold text-neutral-900">{value}</div><div className="mt-0.5 text-[10px] text-neutral-500">{label}</div></div>; }
function Relation({ label, value }: { label: string; value: string }) { return <div className="rounded-md bg-neutral-25 p-3"><div className="text-[10px] text-neutral-400">{label}</div><div className="mt-1 leading-4 text-neutral-700">{value}</div></div>; }
function DetailBlock({ title, value }: { title: string; value: string }) { return <section><div className="text-[10.5px] font-medium text-neutral-400">{title}</div><div className="mt-1.5 rounded-md border border-neutral-200 bg-neutral-25 p-3 text-[11.5px] leading-5 text-neutral-700">{value}</div></section>; }
