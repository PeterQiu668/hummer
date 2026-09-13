import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
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
import { createInvitation, listMembers, type InvitationRecord, type MemberRecord } from '../../features/identity/identityClient';
import { useOptionalIdentity } from '../../features/identity/IdentityProvider';
import { marketEmployees } from '../../data/marketplace';
import { desktopProjectsPort, type ProjectRecord } from '../../features/projects/projectClient';
import { useAppStore } from '../../store/useAppStore';
import AgentAvatar from '../ui/AgentAvatar';
import WorkspacePage from './WorkspacePage';

type TeamTab = 'mine' | 'projects' | 'organization' | 'relations';

function employeeDisplayCopy(value: string | undefined): string | undefined {
  return value
    ?.replaceAll('Manager·', '')
    .replaceAll('MCP Server', '工作连接')
    .replaceAll('Worker', '数字同事')
    .replaceAll('Agent', '数字同事')
    .replaceAll('Skill', '岗位能力');
}

function employeeRoleLabel(value: string): string { return value.replace(' Worker', '执行').replace(' Manager', '统筹'); }

export default function EmployeesPage() {
  const [tab, setTab] = useState<TeamTab>('mine');
  const [query, setQuery] = useState('');
  const [hireOpen, setHireOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hiredEmployees, setHiredEmployees] = useState<DigitalEmployeeRecord[]>([]);
  const [organizationError, setOrganizationError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const identityState = useOptionalIdentity();
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [latestInvitation, setLatestInvitation] = useState<InvitationRecord | null>(null);
  const settings = useAppStore((state) => state.personalSettings);
  const openWorkbenchForEmployee = useAppStore((state) => state.openWorkbenchForEmployee);
  const filtered = useMemo(() => employees.filter((employee) => !query || `${employee.name} ${employee.role} ${employee.currentTask ?? ''}`.includes(query)), [query]);
  const displayEmployees = useMemo(() => filtered.map((employee) => ({ ...employee, name: employeeDisplayCopy(employee.name) ?? employee.name, role: employeeRoleLabel(employee.role), currentTask: employeeDisplayCopy(employee.currentTask) })), [filtered]);
  const selected = displayEmployees.find((employee) => employee.id === selectedId);

  useEffect(() => {
    if (!identityState) return;
    let active = true;
    void listMembers().then((records) => { if (active) setMembers(records); });
    return () => { active = false; };
  }, [identityState?.identity.tenant.id]);

  useEffect(() => {
    const organization = desktopOrganizationPort();
    if (!organization) {
      setOrganizationError('浏览器原型未连接本地组织事实源；请在 HUMMER 桌面版中管理团队。');
      return;
    }
    let active = true;
    void organization.listDigitalEmployees().then((records) => {
      if (active) setHiredEmployees(records);
    }).catch((error: unknown) => {
      if (active) setOrganizationError(error instanceof Error ? error.message : '读取团队事实源失败');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const projectsPort = desktopProjectsPort();
    if (!projectsPort) return;
    let active = true;
    void projectsPort.list().then((records) => { if (active) setProjects(records); }).catch((error: unknown) => { if (active) setOrganizationError(error instanceof Error ? error.message : '读取项目事实源失败'); });
    return () => { active = false; };
  }, [identityState?.identity.tenant.id]);
  const hireEmployee = async (candidateId: string) => {
    const organization = desktopOrganizationPort();
    const candidate = marketEmployees.find((item) => item.id === candidateId);
    if (!organization || !candidate) {
      setOrganizationError('当前环境没有可写的组织事实源，未创建数字同事。');
      return;
    }
    try {
      const record = await organization.hireDigitalEmployee({ id: `employee_${candidate.id}`, departmentId: candidate.category.includes('销售') ? 'department_sales' : 'department_operations', name: candidate.name, jobTitle: candidate.category, runtimeProfile: 'standard', autonomyLevel: 'L2', idempotencyKey: `hire-${candidate.id}` });
      setHiredEmployees((current) => current.some((employee) => employee.id === record.id) ? current : [...current, record]);
      setOrganizationError(null);
      setHireOpen(false);
    } catch (error) {
      setOrganizationError(error instanceof Error ? error.message : '数字同事未能写入组织事实源');
    }
  };

  return <WorkspacePage title="团队协作" sub="真人与个人分身共同承担责任，数字同事按项目提供专业协作。" actions={<div className="flex gap-2"><button type="button" onClick={() => setInviteOpen(true)} disabled={!identityState} className="hum-btn is-sm"><UsersRound size={12} /> 邀请真人同事</button><button type="button" onClick={() => setHireOpen(true)} className="hum-btn is-sm is-primary"><Plus size={12} /> 添加数字同事</button></div>} sticky={<div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="flex flex-1 gap-1 overflow-x-auto"><Tab active={tab === 'mine'} onClick={() => setTab('mine')} icon={<UsersRound size={12} />} label="我的团队" /><Tab active={tab === 'projects'} onClick={() => setTab('projects')} icon={<BriefcaseBusiness size={12} />} label="项目小队" /><Tab active={tab === 'organization'} onClick={() => setTab('organization')} icon={<Building2 size={12} />} label="组织协作" /><Tab active={tab === 'relations'} onClick={() => setTab('relations')} icon={<Network size={12} />} label="协作关系" /></div><div className="relative w-full sm:w-72"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" /><input aria-label="搜索团队成员" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索同事、职责或当前工作" className="hum-input pl-7" /></div></div>}>
    <div className="mx-auto max-w-[1320px] p-5">
      {identityState && <RealMembers members={members} tenantName={identityState.identity.tenant.name} />}
      {organizationError && <div role="status" className="mb-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] text-neutral-700">{organizationError}</div>}
      {tab === 'mine' && <MyTeam twinName={settings.twinName} members={members} employees={displayEmployees} hiredEmployees={hiredEmployees} onSelect={setSelectedId} />}
      {tab === 'projects' && <ProjectTeams projects={projects} onCreate={() => setProjectOpen(true)} />}
      {tab === 'organization' && <OrganizationView members={members} employees={hiredEmployees} />}
      {tab === 'relations' && <RelationsView />}
    </div>
    {selected && <MemberDrawer member={selected} onClose={() => setSelectedId(null)} onAssign={() => openWorkbenchForEmployee(selected.name)} />}
    {hireOpen && <HireDrawer onClose={() => setHireOpen(false)} onHire={(id) => { void hireEmployee(id); }} />}
    {projectOpen && <ProjectTeamDrawer twinName={settings.twinName} members={members} employees={hiredEmployees} onCreated={(project) => setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)])} onClose={() => setProjectOpen(false)} />}
    {inviteOpen && <InviteMemberDialog invitation={latestInvitation} onInvitation={setLatestInvitation} onClose={() => { setInviteOpen(false); setLatestInvitation(null); }} />}
  </WorkspacePage>;
}

function MyTeam({ twinName, members, employees: team, hiredEmployees, onSelect }: { twinName: string; members: MemberRecord[]; employees: Array<(typeof employees)[number]>; hiredEmployees: DigitalEmployeeRecord[]; onSelect: (id: string) => void }) {
  const colleagues = members.map((member) => ({ name: member.displayName, role: member.role === 'owner' ? '企业负责人' : member.role === 'admin' ? '管理员' : '协作成员', relation: '真人责任搭档', focus: '与个人分身共同承担项目内的明确分工。', work: '权限与项目范围以事实源为准' }));
  return <div className="space-y-6"><section className="grid overflow-hidden rounded-md border border-neutral-200 bg-white lg:grid-cols-[1.15fr_0.85fr]"><div className="p-5"><div className="flex items-start gap-4"><div className="grid h-12 w-12 place-items-center rounded-full bg-neutral-900 text-white"><Orbit size={21} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-[16px] font-semibold text-neutral-900">{twinName}</h2><span className="hum-chip is-success">我的分身 · 在线</span></div><p className="mt-1 text-[11.5px] text-neutral-500">代表你协调内部工作，也会根据目标和复盘给出职场建议。</p></div></div><div className="mt-5 grid grid-cols-3 divide-x divide-neutral-200 rounded-md border border-neutral-200 bg-neutral-25 text-center"><MiniMetric value="4" label="正在协调" /><MiniMetric value="2" label="等你确认" /><MiniMetric value="92%" label="建议采纳" /></div></div><div className="border-t border-neutral-200 bg-neutral-25 p-5 lg:border-l lg:border-t-0"><div className="text-[11px] font-medium text-neutral-500">当前代表范围</div><div className="mt-3 space-y-2">{['接受内部工作并安排优先级', '协调数字同事并汇总结果', '外发、付款和权限变化前必须问你'].map((item, index) => <div key={item} className="flex items-center gap-2 text-[11.5px] text-neutral-700">{index === 2 ? <ShieldCheck size={13} className="text-warning" /> : <Check size={13} className="text-success" />}{item}</div>)}</div></div></section>

    <section className="rounded-md border border-primary-200 bg-primary-50 p-4"><div className="flex flex-wrap items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-neutral-900 text-white"><UsersRound size={15} /></div><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-900">我和我的分身</div><div className="mt-0.5 text-[11px] text-neutral-600">真人负责结果，分身代表协同</div><div className="mt-1 text-[10px] text-primary-700">当前搭档：{twinName}</div></div><span className="hum-chip is-brand">固定责任搭档</span></div></section>
    <section><SectionTitle icon={<CircleUserRound size={15} />} title="真人同事" detail="你仍然和真人共同负责结果，分身只承担明确授权的协调工作。" /><div className="grid grid-cols-1 gap-3 lg:grid-cols-3">{colleagues.map((person) => <div key={person.name} className="hum-card p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-neutral-800 text-[11px] text-white">{person.name.slice(0, 1)}</div><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-900">{person.name}</div><div className="text-[10.5px] text-neutral-500">{person.role} · {person.relation}</div></div></div><div className="mt-3 text-[11.5px] leading-5 text-neutral-600">{person.focus}</div><div className="mt-3 rounded-md bg-neutral-25 px-3 py-2 text-[10.5px] text-neutral-500">{person.work}</div></div>)}</div></section>

    <section><SectionTitle icon={<Bot size={15} />} title="数字同事" detail="每位数字同事都有岗位、负责人、能力范围和需要真人确认的事项。" /><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{team.map((employee) => <button type="button" key={employee.id} onClick={() => onSelect(employee.id)} className="hum-card min-h-[156px] p-4 text-left transition hover:border-neutral-300 hover:shadow-sm"><div className="flex items-start gap-3"><AgentAvatar id={employee.id} size={40} status={employee.status} ringWidth={2} /><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate text-[13px] font-semibold text-neutral-900">{employee.name}</span><span className={`hum-chip ${employee.status === 'working' ? 'is-brand' : 'is-muted'}`} style={{ padding: '1px 5px', fontSize: 10 }}>{employee.status === 'working' ? '工作中' : '待命'}</span></div><div className="mt-0.5 text-[11px] text-neutral-500">{employee.role}</div></div><ChevronRight size={14} className="mt-1 text-neutral-300" /></div><div className="mt-3 line-clamp-2 text-[11px] leading-4 text-neutral-700">{employee.currentTask ?? '等待新的工作安排'}</div><div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2.5 text-[10.5px] text-neutral-500"><span>负责人：昆仑</span><span>本周交付 {2 + employee.id.length % 5} 项</span></div></button>)}</div></section>

    {hiredEmployees.length > 0 && <section><SectionTitle icon={<Sparkles size={15} />} title="试用中的数字同事" detail="试用期间只获得当前任务需要的最小权限。" /><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{hiredEmployees.map((employee) => <div key={employee.id} data-employee-id={employee.id} className="hum-card p-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-md bg-primary-600 text-white"><Bot size={16} /></div><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold text-neutral-900">{employee.name}</div><div className="text-[11px] text-neutral-500">{employee.jobTitle} · 7 天试用</div><div className="mt-1 font-mono text-[9px] text-neutral-400">{employee.id}</div></div><Check size={15} className="text-success" /></div></div>)}</div></section>}
  </div>;
}

function ProjectTeams({ projects, onCreate }: { projects: ProjectRecord[]; onCreate: () => void }) {
  return <div className="space-y-5">
    <section className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-neutral-900 text-white"><BriefcaseBusiness size={17} /></div><div className="min-w-0 flex-1"><h2 className="text-[14px] font-semibold text-neutral-900">按项目组队，不改组织编制</h2><p className="mt-1 text-[11px] leading-4 text-neutral-500">邀请真人时默认带上其个人分身；数字同事以临时助手身份加入，项目结束或到期后自动释放权限。</p></div><button type="button" onClick={onCreate} className="hum-btn is-sm is-primary"><Plus size={12} /> 组建项目小队</button></section>
    <section><SectionTitle icon={<UsersRound size={15} />} title="正在推进的项目" detail="项目事实、责任搭档和临时授权保存在 HUMMER 桌面版。" /><div className="mt-3 grid gap-3 xl:grid-cols-2">{projects.length ? projects.map((project) => <article key={project.id} data-project-id={project.id} className="hum-card p-4"><div className="flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-md bg-primary-50 text-primary-700"><BriefcaseBusiness size={15} /></div><div className="min-w-0 flex-1"><h3 className="text-[13px] font-semibold text-neutral-900">{project.title}</h3><p className="mt-0.5 text-[10.5px] text-neutral-500">{project.goal}</p></div><span className="hum-chip is-success">{project.status === 'active' ? '推进中' : project.status}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><ProjectRole title="责任搭档" value={`${project.memberCount} 位项目成员`} note="真人负责人和个人分身分别留痕" /><ProjectRole title="临时助手" value={`${project.activeAssignmentCount} 项有效授权`} note="到期自动释放最小权限" /><ProjectRole title="项目编号" value={project.id.slice(0, 18)} note="可在审计中关联事实链" /><ProjectRole title="保护动作" value="按审批策略拦截" note="仅指定真人可以批准" /></div></article>) : <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-25 p-5 text-[11px] text-neutral-500">还没有持久化项目。创建小队后，责任搭档和临时助手授权会写入本机事实源。</div>}</div></section>
  </div>;
}

function ProjectTeamDrawer({ twinName, members, employees, onCreated, onClose }: { twinName: string; members: MemberRecord[]; employees: DigitalEmployeeRecord[]; onCreated: (project: ProjectRecord) => void; onClose: () => void }) {
  const [selectedHumans, setSelectedHumans] = useState<string[]>([]); const [selectedAssistants, setSelectedAssistants] = useState<string[]>([]); const [title, setTitle] = useState('新的协作项目'); const [goal, setGoal] = useState('明确目标、交付标准与需要真人确认的动作。'); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const identity = useOptionalIdentity(); const owner = identity?.identity.membership; const ownerTwin = members.find((member) => member.humanUserId === owner?.humanUserId)?.twinId;
  const collaborators = members.filter((member) => member.humanUserId !== owner?.humanUserId); const assistants = employees;
  const toggle = (value: string, values: string[], update: (next: string[]) => void) => update(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const create = async () => { const port = desktopProjectsPort(); if (!port || !owner || !ownerTwin) { setError('请在已登录的 HUMMER 桌面版中创建项目；浏览器原型不会伪造项目事实。'); return; } setBusy(true); setError(null); try { const project = await port.create({ title, goal, coordinatorTwinId: ownerTwin, collaborators: collaborators.filter((member) => selectedHumans.includes(member.humanUserId)).map((member) => ({ humanUserId: member.humanUserId, twinId: member.twinId })), assignments: assistants.filter((employee) => selectedAssistants.includes(employee.id)).map((employee) => ({ employeeId: employee.id, sponsorHumanId: owner.humanUserId, permissionScope: 'project.read; project.draft', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })), idempotencyKey: `project-${Date.now()}` }); onCreated(project); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : '项目未能写入事实源'); } finally { setBusy(false); } };
  return <div className="absolute inset-0 z-40 bg-white/70" onClick={onClose}><aside className="absolute bottom-0 right-0 top-0 flex w-full max-w-[520px] flex-col border-l border-neutral-200 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start gap-3 border-b border-neutral-200 p-5"><div className="grid h-9 w-9 place-items-center rounded-md bg-neutral-900 text-white"><BriefcaseBusiness size={16} /></div><div className="min-w-0 flex-1"><h2 className="text-[16px] font-semibold text-neutral-900">组建项目小队</h2><p className="mt-1 text-[11px] text-neutral-500">先确定谁对结果负责，再补齐协作者和临时助手。</p></div><button type="button" aria-label="关闭组建项目小队" onClick={onClose} className="text-neutral-400"><X size={18} /></button></div><div className="flex-1 space-y-5 overflow-y-auto p-5"><label className="block text-[11px] font-semibold text-neutral-800">项目名称<input aria-label="项目名称" value={title} onChange={(event) => setTitle(event.target.value)} className="hum-input mt-2" /></label><label className="block text-[11px] font-semibold text-neutral-800">目标与验收<textarea aria-label="项目目标" value={goal} onChange={(event) => setGoal(event.target.value)} className="hum-input mt-2 min-h-20" /></label><section><div className="text-[11px] font-semibold text-neutral-800">最终责任</div><div className="mt-2 rounded-md border border-primary-200 bg-primary-50 p-3"><div className="text-[12.5px] font-semibold text-neutral-900">我（最终负责人） + {twinName}</div><div className="mt-1 text-[10.5px] text-neutral-600">真人做最终判断；分身代表协调、汇总进展和提醒风险。</div></div></section><section><div className="text-[11px] font-semibold text-neutral-800">邀请真人协作者</div><p className="mt-1 text-[10.5px] text-neutral-500">选中真人时，其活跃分身同步以责任搭档加入。</p><div className="mt-2 space-y-2">{collaborators.map((member) => { const selected = selectedHumans.includes(member.humanUserId); return <button type="button" aria-label={`邀请${member.displayName}`} key={member.membershipId} onClick={() => toggle(member.humanUserId, selectedHumans, setSelectedHumans)} className={`flex w-full items-center gap-3 rounded-md border p-3 text-left ${selected ? 'border-primary-300 bg-primary-50' : 'border-neutral-200'}`}><span className="grid h-8 w-8 place-items-center rounded-full bg-neutral-800 text-[11px] text-white">{member.displayName.slice(0, 1)}</span><span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-neutral-800">{member.displayName} + 个人分身</span><span className="mt-0.5 block text-[10px] text-neutral-500">真人与分身共同承担明确分工</span></span>{selected && <Check size={14} className="text-success" />}</button>; })}{!collaborators.length && <div className="rounded-md bg-neutral-25 p-3 text-[10.5px] text-neutral-500">邀请真人同事后会在这里出现。</div>}</div></section><section><div className="text-[11px] font-semibold text-neutral-800">添加数字助手</div><p className="mt-1 text-[10.5px] text-neutral-500">仅获得项目最小权限，七天后自动释放。</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{assistants.map((employee) => { const selected = selectedAssistants.includes(employee.id); return <button type="button" key={employee.id} onClick={() => toggle(employee.id, selectedAssistants, setSelectedAssistants)} className={`rounded-md border p-3 text-left ${selected ? 'border-success/40 bg-success-soft' : 'border-neutral-200'}`}><span className="block text-[12px] font-medium text-neutral-800">{employee.name}</span><span className="mt-1 block text-[10px] text-neutral-500">临时助手 · 不承担最终责任</span></button>; })}{!assistants.length && <div className="rounded-md bg-neutral-25 p-3 text-[10.5px] text-neutral-500">先添加数字同事，再分配项目临时工作。</div>}</div></section>{error && <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-3 text-[10.5px] text-danger">{error}</div>}</div><div className="border-t border-neutral-200 p-4"><button type="button" disabled={busy} onClick={() => { void create(); }} className="hum-btn is-primary w-full justify-center disabled:opacity-50">{busy ? '正在创建...' : '创建小队并进入项目'}</button></div></aside></div>;
}
function ProjectRole({ title, value, note }: { title: string; value: string; note: string }) {
  return <div className="rounded-md border border-neutral-200 bg-neutral-25 p-3"><div className="text-[9.5px] text-neutral-400">{title}</div><div className="mt-1 text-[11.5px] font-medium text-neutral-800">{value}</div><div className="mt-1 text-[10px] text-neutral-500">{note}</div></div>;
}
function OrganizationView({ members, employees }: { members: MemberRecord[]; employees: DigitalEmployeeRecord[] }) {
  return <div className="space-y-5"><section className="grid grid-cols-1 divide-y divide-neutral-200 overflow-hidden rounded-md border border-neutral-200 bg-white md:grid-cols-3 md:divide-x md:divide-y-0"><MiniMetric value={String(members.length)} label="真人成员" /><MiniMetric value={String(members.length)} label="个人分身" /><MiniMetric value={String(employees.length)} label="数字同事" /></section><section><SectionTitle icon={<Building2 size={15} />} title="当前组织结构" detail="真人与个人分身构成责任搭档；数字同事只在获得项目授权时执行。" /><div className="space-y-3">{members.length ? members.map((member) => <div key={member.membershipId} className="hum-card grid gap-4 p-4 lg:grid-cols-[1fr_1.4fr_auto] lg:items-center"><div><div className="text-[13px] font-semibold text-neutral-900">{member.displayName}</div><div className="mt-1 text-[10.5px] text-neutral-500">{member.role} · 真人责任搭档</div></div><div><div className="flex flex-wrap gap-2 text-[10.5px]"><span className="hum-chip">真人</span><span className="hum-chip is-brand">活跃个人分身</span><span className="hum-chip is-success">项目内最小权限</span></div><div className="mt-2 text-[11px] text-neutral-600">项目协作与审批身份均可在审计事实链中追溯。</div></div><span className="hum-chip is-success">有效</span></div>) : <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-25 p-4 text-[11px] text-neutral-500">在桌面版创建公司或接受邀请后，这里会显示真实组织成员。</div>}</div></section></div>;
}
function RelationsView() {
  const [selected, setSelected] = useState('昆仑');
  const nodes = [{ name: '昆仑', type: '真人负责人', tone: 'dark' }, { name: '昆仑助理', type: '个人分身', tone: 'brand' }, { name: '吴帆', type: '销售负责人', tone: 'neutral' }, { name: '雪·销售官', type: '数字同事', tone: 'success' }, { name: '林知远', type: '外部专家', tone: 'warning' }, { name: '华东客户知识', type: '共享知识', tone: 'neutral' }];
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"><section><SectionTitle icon={<Network size={15} />} title="协作关系" detail="点击成员可查看谁向谁负责、谁可以代表谁，以及共享了哪些知识。" /><div className="relative grid min-h-[430px] grid-cols-2 content-center gap-4 rounded-md border border-neutral-200 bg-white p-6 sm:grid-cols-3">{nodes.map((node) => <button type="button" key={node.name} onClick={() => setSelected(node.name)} className={`relative z-10 min-h-[88px] rounded-md border p-3 text-left ${selected === node.name ? 'border-primary-400 bg-primary-50 shadow-sm' : 'border-neutral-200 bg-white hover:bg-neutral-25'}`}><div className="flex items-center gap-2"><span className={`grid h-7 w-7 place-items-center rounded-full ${node.tone === 'dark' ? 'bg-neutral-900 text-white' : node.tone === 'brand' ? 'bg-primary-100 text-primary-700' : node.tone === 'success' ? 'bg-success-soft text-success' : node.tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-neutral-100 text-neutral-600'}`}>{node.type.includes('知识') ? <Network size={12} /> : node.type.includes('分身') ? <Orbit size={12} /> : <UsersRound size={12} />}</span><span className="text-[12px] font-semibold text-neutral-900">{node.name}</span></div><div className="mt-2 text-[10.5px] text-neutral-500">{node.type}</div></button>)}</div></section><aside className="hum-card h-fit p-4 xl:sticky xl:top-3"><div className="text-[10.5px] text-primary-700">当前查看</div><div className="mt-1 text-[16px] font-semibold text-neutral-900">{selected}</div><div className="mt-4 space-y-2 text-[11px] text-neutral-600"><Relation label="结果负责人" value={selected === '昆仑' ? '本人' : '昆仑'} /><Relation label="可代表范围" value={selected.includes('助理') ? '内部协调与信息汇总' : '按岗位授权'} /><Relation label="共享知识" value="公司目标 · 华东客户 · 销售方法" /><Relation label="必须确认" value="外发 · 写回 · 付款 · 权限变化" /></div></aside></div>;
}

function MemberDrawer({ member, onClose, onAssign }: { member: typeof employees[number]; onClose: () => void; onAssign: () => void }) {
  return <div className="absolute inset-0 z-40 bg-white/60" onClick={onClose}><aside className="absolute bottom-0 right-0 top-0 w-full max-w-[420px] border-l border-neutral-200 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start gap-3 border-b border-neutral-200 p-5"><AgentAvatar id={member.id} size={44} status={member.status} /><div className="min-w-0 flex-1"><h2 className="text-[16px] font-semibold text-neutral-900">{member.name}</h2><p className="mt-1 text-[11px] text-neutral-500">{member.role}</p></div><button type="button" aria-label="关闭成员详情" onClick={onClose} className="text-neutral-400"><X size={18} /></button></div><div className="space-y-5 p-5"><DetailBlock title="当前工作" value={member.currentTask ?? '等待新的工作安排'} /><DetailBlock title="向谁负责" value="昆仑 · 最终结果由真人负责人确认" /><DetailBlock title="可以做" value="读取授权资料、整理信息、生成草稿、调用已批准的工作应用" /><DetailBlock title="必须先问" value="客户外发、业务系统写回、付款、删除和权限变化" /><div className="grid grid-cols-2 gap-3"><MiniMetric value="94%" label="结果采纳率" /><MiniMetric value="3" label="本周交付" /></div><button type="button" onClick={onAssign} className="hum-btn is-primary w-full justify-center">交给他一项工作 <ArrowRight size={12} /></button></div></aside></div>;
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
function RealMembers({ members, tenantName }: { members: MemberRecord[]; tenantName: string }) {
  return (
    <section className="mb-4 overflow-hidden rounded-md border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div>
          <div className="text-[12.5px] font-semibold text-neutral-900">{tenantName} · 真人与分身</div>
          <div className="mt-0.5 text-[10.5px] text-neutral-500">每位真人仅有一个活跃分身，责任与审计身份一一对应。</div>
        </div>
        <span className="hum-chip">{members.length} 人</span>
      </div>
      <div className="grid gap-px bg-neutral-200 sm:grid-cols-2 xl:grid-cols-4">
        {members.map((member) => (
          <div key={member.membershipId} className="bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-neutral-900 text-[10px] text-white">
                {member.displayName.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-neutral-800">{member.displayName}</div>
                <div className="text-[9.5px] text-neutral-400">
                  {member.role === 'owner' ? '企业所有者' : member.role === 'admin' ? '管理员' : '成员'}
                </div>
              </div>
            </div>
            <div className="mt-2 truncate text-[9.5px] text-primary-700">个人分身 · {member.twinId}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function InviteMemberDialog({ invitation, onInvitation, onClose }: {
  invitation: InvitationRecord | null;
  onInvitation: (value: InvitationRecord) => void;
  onClose: () => void;
}) {
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [error, setError] = useState('');

  const send = async () => {
    try {
      const contactType = contact.includes('@') ? 'email' : 'phone';
      onInvitation(await createInvitation({ contactType, contactValue: contact, role }));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '邀请创建失败');
    }
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-neutral-950/30 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="invite-member-title" className="w-full max-w-md rounded-md border border-neutral-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 id="invite-member-title" className="text-[14px] font-semibold text-neutral-900">邀请真人同事</h2>
          <button type="button" onClick={onClose} className="hum-icon-btn" aria-label="关闭邀请窗口"><X size={14} /></button>
        </div>
        {invitation ? (
          <div className="space-y-4 p-4">
            <div className="rounded-md border border-success/30 bg-success-soft p-3">
              <div className="text-[11px] font-medium text-neutral-800">邀请已创建</div>
              <div className="mt-1 text-[10px] text-neutral-500">把以下邀请凭证发送给同事；接受后会自动创建个人分身。</div>
            </div>
            <label className="block text-[10.5px] text-neutral-500">
              邀请凭证
              <textarea readOnly value={invitation.token} className="hum-input mt-1 min-h-20 resize-none font-mono text-[10px]" />
            </label>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(invitation.token); }} className="hum-btn is-primary w-full justify-center">
              复制邀请凭证
            </button>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <label className="block text-[10.5px] text-neutral-600">
              邮箱或手机号
              <input aria-label="同事邮箱或手机号" value={contact} onChange={(event) => setContact(event.target.value)} className="hum-input mt-1" placeholder="name@company.com / 138..." />
            </label>
            <label className="block text-[10.5px] text-neutral-600">
              成员角色
              <select aria-label="成员角色" value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'member')} className="hum-input mt-1">
                <option value="member">成员</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            {error && <div role="alert" className="text-[10.5px] text-danger">{error}</div>}
            <button type="button" disabled={!contact.trim()} onClick={() => { void send(); }} className="hum-btn is-primary w-full justify-center disabled:opacity-40">
              创建邀请
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
