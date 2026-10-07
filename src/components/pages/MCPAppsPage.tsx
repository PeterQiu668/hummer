import { useEffect, useMemo, useState } from 'react';
import {
  Blocks,
  BookOpen,
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleUserRound,
  Link2,
  Globe2,
  Network,
  Search,
  ShieldCheck,
  UsersRound,
  Wrench,
} from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import { useAppStore } from '../../store/useAppStore';
import { desktopRuntimeConnectorPort, type RuntimeConnectorRecord } from '../../features/connectors/runtimeConnectorClient';
import { desktopToolRegistryPort, type ToolDefinitionRecord } from '../../features/tools/toolRegistryClient';
import {
  CapabilityInstallError,
  capabilityCatalogPort,
  type CapabilityCatalogItem,
} from '../../features/capabilities/capabilityCatalogClient';
import { RemoteRelayError } from '../../features/execution-nodes/remoteRelayClient';
import PublicMarketPanel from '../../features/capabilities/PublicMarketPanel';

type CapabilityTab = 'apps' | 'public' | 'experts' | 'skills' | 'knowledge' | 'models';

const tabs: Array<{ key: CapabilityTab; label: string; icon: typeof Blocks }> = [
  { key: 'apps', label: '工作应用', icon: Link2 },
  { key: 'public', label: '能力网络', icon: Globe2 },
  { key: 'experts', label: '专家', icon: CircleUserRound },
  { key: 'skills', label: '技能', icon: Wrench },
  { key: 'knowledge', label: '企业知识', icon: BookOpen },
  { key: 'models', label: '模型', icon: BrainCircuit },
];

const featuredAppIds = ['feishu', 'dingtalk', 'wework', 'salesforce', 'mail', 'github', 'notion', 'kingdee'];

const experts = [
  { name: '林知远', role: '企业销售增长顾问', focus: '账户策略、销售方法与复杂客户推进', availability: '今天 16:30 可约', supported: '支持 8 位数字同事' },
  { name: '黄谨言', role: '合同与数据合规专家', focus: '合同风险、数据边界与对外发布审查', availability: '明天 10:00 可约', supported: '支持法务与交付团队' },
  { name: '吴琳', role: '经营分析专家', focus: '指标体系、归因分析和管理复盘', availability: '本周四可约', supported: '支持 3 个部门' },
  { name: '苏娜', role: '组织发展顾问', focus: '岗位设计、人才评估和人机分工', availability: '在线答疑', supported: '支持人力与管理层' },
];

const knowledgeNodes = [
  { id: 'goals', name: '公司目标', count: '12 项', detail: '经营目标、部门承诺和负责人关系' },
  { id: 'customers', name: '客户知识', count: '286 条', detail: '客户背景、沟通记录和关键关系' },
  { id: 'methods', name: '工作方法', count: '56 套', detail: '已验证流程、模板和检查清单' },
  { id: 'projects', name: '项目经验', count: '94 个', detail: '项目结果、问题、决定和复盘' },
  { id: 'people', name: '组织能力', count: '41 人', detail: '真人、分身、数字同事和专家能力' },
];

export default function MCPAppsPage() {
  const [tab, setTab] = useState<CapabilityTab>('apps');
  const [query, setQuery] = useState('');
  const [runtimeConnectors, setRuntimeConnectors] = useState<RuntimeConnectorRecord[]>([]);
  const [toolDefinitions, setToolDefinitions] = useState<ToolDefinitionRecord[]>([]);
  const [verifyingTool, setVerifyingTool] = useState(false);
  const [capabilityItems, setCapabilityItems] = useState<readonly CapabilityCatalogItem[]>([]);
  const [capabilityLoad, setCapabilityLoad] = useState<'unconfigured' | 'loading' | 'ready' | 'error'>('loading');
  const [capabilityLoadMessage, setCapabilityLoadMessage] = useState('');
  const [capabilityInstallState, setCapabilityInstallState] = useState<Record<string, { status: 'installing' | 'installed' | 'failed'; message: string }>>({});
  const mcpApps = useAppStore((state) => state.mcpApps);
  const settings = useAppStore((state) => state.personalSettings);
  const updateSettings = useAppStore((state) => state.updatePersonalSettings);
  const connectorPort = desktopRuntimeConnectorPort();
  const toolRegistry = useMemo(() => desktopToolRegistryPort(), []);
  const capabilityPort = useMemo(() => capabilityCatalogPort(), []);
  const connectedCount = runtimeConnectors.filter((connector) => connector.status === 'connected').length;

  useEffect(() => {
    if (!connectorPort) return;
    let active = true;
    void connectorPort.list().then((records) => { if (active) setRuntimeConnectors(records); });
    const unsubscribe = connectorPort.subscribe((records) => { if (active) setRuntimeConnectors(records); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [connectorPort]);

  useEffect(() => {
    let active = true;
    if (toolRegistry) void toolRegistry.list().then((records) => { if (active) setToolDefinitions(records); });
    return () => { active = false; };
  }, [toolRegistry]);

  useEffect(() => {
    let active = true;
    if (!capabilityPort) {
      setCapabilityLoad('unconfigured');
      setCapabilityLoadMessage('能力仓未配置 Remote Relay；当前不会展示样例数据，也不能安装。');
      return () => { active = false; };
    }
    setCapabilityLoad('loading');
    void capabilityPort.listCapabilities().then((items) => {
      if (!active) return;
      setCapabilityItems(items);
      setCapabilityLoad('ready');
      setCapabilityLoadMessage('');
    }).catch((error: unknown) => {
      if (!active) return;
      setCapabilityItems([]);
      setCapabilityLoad('error');
      setCapabilityLoadMessage(capabilityFailureMessage(error, '读取能力仓失败'));
    });
    return () => { active = false; };
  }, [capabilityPort]);

  const installCapability = async (item: CapabilityCatalogItem) => {
    if (!capabilityPort) return;
    const key = capabilityItemKey(item);
    setCapabilityInstallState((current) => ({ ...current, [key]: { status: 'installing', message: '正在调用可信安装门禁…' } }));
    try {
      const installed = await capabilityPort.install(item);
      setCapabilityInstallState((current) => ({
        ...current,
        [key]: { status: 'installed', message: `门禁已批准并完成安装 · 请求摘要 ${installed.requestDigest.slice(0, 12)}…` },
      }));
    } catch (error) {
      setCapabilityInstallState((current) => ({
        ...current,
        [key]: { status: 'failed', message: capabilityFailureMessage(error, '安装失败') },
      }));
    }
  };

  const verifyLocalMcp = async () => {
    if (!toolRegistry || verifyingTool) return;
    setVerifyingTool(true);
    try {
      const verified = await toolRegistry.verifyLocalMcp();
      setToolDefinitions((current) => [...current.filter((tool) => tool.id !== verified.id), verified].sort((left, right) => left.capabilityId.localeCompare(right.capabilityId)));
    } finally {
      setVerifyingTool(false);
    }
  };

  return <WorkspacePage title="能力与连接" sub="把专家经验、可复用技能、企业知识、模型和日常工作应用装进团队。" actions={<span className={`hum-chip ${connectedCount ? 'is-success' : 'is-muted'}`}><Check size={11} /> {connectedCount ? `${connectedCount} 个运行连接已验证` : '尚无已验证连接'}</span>} sticky={<div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">{tabs.map((item) => { const Icon = item.icon; return <button type="button" key={item.key} onClick={() => setTab(item.key)} className={`hum-btn is-sm ${tab === item.key ? 'is-primary' : ''}`}><Icon size={12} /> {item.label}</button>; })}</div><div className="relative w-full sm:w-64"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" /><input aria-label="搜索能力与连接" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索专家、技能或应用" className="hum-input pl-7" /></div></div>}>
    <div className="mx-auto max-w-[1280px] p-5">
      {tab === 'apps' && <AppsPanel query={query} apps={mcpApps} connectors={runtimeConnectors} tools={toolDefinitions} hostAvailable={Boolean(connectorPort && toolRegistry)} verifyingTool={verifyingTool} onVerifyLocalMcp={verifyLocalMcp} />}
      {tab === 'public' && <PublicMarketPanel query={query} />}
      {tab === 'experts' && <ExpertsPanel query={query} />}
      {tab === 'skills' && <SkillsPanel query={query} items={capabilityItems} load={capabilityLoad} loadMessage={capabilityLoadMessage} installerAvailable={Boolean(capabilityPort?.installerAvailable)} installState={capabilityInstallState} onInstall={installCapability} />}
      {tab === 'knowledge' && <KnowledgePanel query={query} />}
      {tab === 'models' && <ModelsPanel selected={settings.preferredModel} onSelect={(preferredModel) => updateSettings({ preferredModel })} />}
    </div>
  </WorkspacePage>;
}

function AppsPanel({ query, apps, connectors, tools, hostAvailable, verifyingTool, onVerifyLocalMcp }: { query: string; apps: Record<string, { id: string; name: string; kind: string }>; connectors: RuntimeConnectorRecord[]; tools: ToolDefinitionRecord[]; hostAvailable: boolean; verifyingTool: boolean; onVerifyLocalMcp: () => Promise<void> }) {
  const items = featuredAppIds.map((id) => apps[id]).filter(Boolean).filter((app) => matches(query, `${app.name} ${app.kind}`));
  const visibleConnectors = connectors.filter((connector) => matches(query, `${connectorDisplayName(connector)} ${connector.technicalName} ${connector.runtimeId}`));
  const verified = connectors.filter((connector) => connector.status === 'connected').length;
  return <div className="space-y-5">
    <section className="grid grid-cols-1 divide-y divide-neutral-200 overflow-hidden rounded-md border border-neutral-200 bg-white md:grid-cols-3 md:divide-x md:divide-y-0">
      <Summary icon={<Link2 size={15} />} label="已验证连接" value={`${verified} 个`} detail={hostAvailable ? '来自桌面运行时的实际握手' : '浏览器原型未连接桌面宿主'} />
      <Summary icon={<ShieldCheck size={15} />} label="需要我确认" value="3 类操作" detail="外发、写回和权限变化" />
      <Summary icon={<BriefcaseBusiness size={15} />} label="当前可执行范围" value="本地文件 · 隔离产物" detail="外部应用尚未在当前版本开放" />
    </section>
    <section>
      <SectionTitle icon={<Wrench size={15} />} title="可执行能力" detail="能力来自租户工具注册表；握手成功前不会显示为已验证。" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{tools.map((tool) => <div key={tool.id} className="hum-card flex min-h-[126px] flex-col p-4">
        <div className="flex items-start gap-3"><AppMark name={tool.displayName} /><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-900">{tool.displayName}</div><div className="mt-0.5 font-mono text-[10.5px] text-neutral-500">{tool.capabilityId} · {tool.transport.toUpperCase()}</div></div><span className={`hum-chip ${tool.status === 'verified' ? 'is-success' : 'is-muted'}`}>{tool.status === 'verified' ? '已验证连接' : '待接入'}</span></div>
        <div className="mt-auto flex items-end gap-3 pt-3"><div className="min-w-0 flex-1 text-[10.5px] text-neutral-500">风险：{tool.riskLevel} · 策略：{tool.policyActionPattern}</div>{tool.transport === 'mcp' && tool.status !== 'verified' && <button type="button" disabled={!hostAvailable || verifyingTool} onClick={() => { void onVerifyLocalMcp(); }} className="hum-btn is-sm is-primary">{verifyingTool ? '正在验证' : '验证连接'}</button>}</div>
      </div>)}</div>
    </section>
    <section>
      <SectionTitle icon={<Link2 size={15} />} title="运行连接" detail="这里只显示桌面执行内核实际观察到的 MCP 握手状态，技术名称保留用于安全审计。" />
      {visibleConnectors.length ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleConnectors.map((connector) => <div key={connector.id} className="hum-card flex min-h-[132px] flex-col p-4">
        <div className="flex items-start gap-3"><AppMark name={connectorDisplayName(connector)} /><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-900">{connectorDisplayName(connector)}</div><div className="mt-0.5 text-[10.5px] text-neutral-500">技术名称：{connector.technicalName} · {connector.transport.toUpperCase()}</div></div><span className={`hum-chip ${connector.status === 'connected' ? 'is-success' : connector.status === 'failed' ? 'is-danger' : 'is-muted'}`}>{connectorStatusLabel(connector.status)}</span></div>
        <div className="mt-3 text-[10.5px] leading-4 text-neutral-500">运行时：{connector.runtimeId} · 核验时间：{new Date(connector.checkedAt).toLocaleString('zh-CN')}{connector.error ? ` · ${connector.error}` : ''}</div>
      </div>)}</div> : <div className="rounded-md border border-dashed border-neutral-300 bg-white px-4 py-5 text-[11px] text-neutral-500">{hostAvailable ? '当前桌面运行时尚未完成连接握手。启动一次真实任务后，这里会刷新实际状态。' : '当前是浏览器原型，无法核验本机连接状态。'}</div>}
    </section>
    <section>
      <SectionTitle icon={<Blocks size={15} />} title="未来规划" detail="以下外部工作环境仅用于说明产品路线，当前版本不提供连接、授权或投递能力。" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((app) => <div key={app.id} aria-disabled="true" className="hum-card flex min-h-[132px] flex-col bg-neutral-50 p-4 opacity-65"><div className="flex items-start gap-3"><AppMark name={app.name} /><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-700">{app.name}</div><div className="mt-0.5 text-[10.5px] text-neutral-500">{app.kind}</div></div><span className="hum-chip is-muted">路线图</span></div><div className="mt-3 text-[10.5px] leading-4 text-neutral-500">当前版本不提供；无法点击、授权或连接。</div></div>)}</div>
    </section>
  </div>;
}

function connectorDisplayName(connector: RuntimeConnectorRecord): string {
  if (connector.technicalName === 'node_repl') return '本地工具连接器';
  if (connector.technicalName === 'codex_apps') return '企业应用连接器';
  return '运行时连接器';
}

function connectorStatusLabel(status: RuntimeConnectorRecord['status']): string {
  if (status === 'connected') return '已验证连接';
  if (status === 'failed') return '连接失败';
  return '正在核验';
}

function ExpertsPanel({ query }: { query: string }) {
  return <section><SectionTitle icon={<UsersRound size={15} />} title="专家支持" detail="专家负责定义方法、处理复杂例外并辅导数字同事，不直接获得你的业务数据。" /><div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{experts.filter((expert) => matches(query, `${expert.name} ${expert.role} ${expert.focus}`)).map((expert) => <div key={expert.name} className="hum-card p-4"><div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-neutral-900 text-[12px] font-semibold text-white">{expert.name.slice(0, 1)}</div><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-900">{expert.name}</div><div className="mt-0.5 text-[11px] text-neutral-500">{expert.role}</div></div><span className="hum-chip is-muted">预约未开放</span></div><p className="mt-3 text-[11.5px] leading-5 text-neutral-600">{expert.focus}</p><div className="mt-3 flex flex-wrap gap-2 text-[10.5px]"><span className="hum-chip is-brand">{expert.availability}</span><span className="hum-chip">{expert.supported}</span></div></div>)}</div></section>;
}

function SkillsPanel({
  query,
  items,
  load,
  loadMessage,
  installerAvailable,
  installState,
  onInstall,
}: {
  query: string;
  items: readonly CapabilityCatalogItem[];
  load: 'unconfigured' | 'loading' | 'ready' | 'error';
  loadMessage: string;
  installerAvailable: boolean;
  installState: Record<string, { status: 'installing' | 'installed' | 'failed'; message: string }>;
  onInstall: (item: CapabilityCatalogItem) => Promise<void>;
}) {
  const visible = items.filter((item) => matches(query, capabilitySearchText(item)));
  return <section>
    <SectionTitle icon={<Wrench size={15} />} title="团队能力仓" detail="这里仅展示 Relay 返回的真实能力包与团队只读分享；安装必须经过可信门禁和本地安装器。" />
    {load !== 'ready' && <div role={load === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-md border px-4 py-3 text-[11px] leading-5 ${load === 'error' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-neutral-200 bg-white text-neutral-600'}`}>{load === 'loading' ? '正在从 Remote Relay 读取能力仓…' : loadMessage}</div>}
    {load === 'ready' && !installerAvailable && <div role="status" className="mb-3 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-[11px] leading-5 text-neutral-700">可信安装器未连接。能力仓保持只读；不会把按钮点击写入 localStorage，也不会显示假成功。</div>}
    {load === 'ready' && visible.length === 0 && <div className="rounded-md border border-dashed border-neutral-300 bg-white px-4 py-5 text-[11px] text-neutral-500">{items.length ? '没有匹配当前搜索条件的能力包。' : '当前租户能力仓为空。'}</div>}
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{visible.map((item) => {
      const { record } = item;
      const author = record.author;
      const trial = record.trialRecord;
      const state = installState[capabilityItemKey(item)];
      const readOnly = item.access === 'read_only';
      return <article data-testid="capability-card" key={capabilityItemKey(item)} className="hum-card min-w-0 overflow-hidden p-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary-50 text-primary-700"><Wrench size={15} /></div><div className="min-w-0"><h3 className="break-words text-[13px] font-semibold text-neutral-900">{author.title}</h3><div className="mt-0.5 break-all font-mono text-[10px] text-neutral-500">{record.packageId} · v{record.packageVersion}</div></div></div>
          <div className="flex shrink-0 flex-wrap gap-1.5"><span className={`hum-chip ${record.status === 'verified' || record.status === 'shared' ? 'is-success' : 'is-muted'}`}>{capabilityStatusLabel(record.status)}</span><span className={`hum-chip ${readOnly ? 'is-brand' : 'is-muted'}`}>{readOnly ? '团队只读' : '我拥有'}</span></div>
        </div>
        <p className="mt-3 break-words text-[11px] leading-5 text-neutral-600">{author.goal}</p>
        <div className="mt-3 grid grid-cols-1 gap-2 text-[10.5px] text-neutral-600 sm:grid-cols-2">
          <CapabilityFact label="来源" value={`${author.provenance.expertActorRef} · ${author.provenance.device} · ${author.provenance.runtime} ${author.provenance.runtimeVersion}`} />
          <CapabilityFact label="边界" value={sourceBoundaryLabel(author.sourceBoundary)} />
          <CapabilityFact label="试运行" value={trial ? `${trial.success} 成功 / ${trial.failure} 失败 / ${trial.shadowRuns} 次影子运行${trial.regressionPassed ? ' · 回归通过' : ' · 回归未通过'}` : '尚无受信试运行记录'} />
          <CapabilityFact label="回执" value={author.receiptRef} mono />
        </div>
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <div className="text-[10px] font-semibold text-neutral-700">声明权限</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{author.declaredPermissions.length ? author.declaredPermissions.map((permission) => <span key={`${permission.capability}:${permission.access}:${permission.paths.join('|')}`} className="hum-chip break-all">{permission.capability} · {permission.access}{permission.paths.length ? ` · ${permission.paths.join(', ')}` : ''}</span>) : <span className="text-[10.5px] text-neutral-500">未声明额外权限</span>}</div>
        </div>
        <div className="mt-3 rounded-md bg-neutral-25 px-3 py-2 text-[10.5px] leading-4 text-neutral-600"><span className="font-semibold text-neutral-700">失败说明：</span>{author.failureNotes.length ? author.failureNotes.join('；') : '无已记录失败说明'}</div>
        <div className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 break-words text-[10.5px] text-neutral-500">{readOnly ? '来源边界与内容只读，不可编辑、复制为本租户资产或改写出处。' : `包摘要 ${record.packageDigest.slice(0, 16)}…`}</div>
          {readOnly && <button type="button" disabled={!installerAvailable || state?.status === 'installing'} onClick={() => { void onInstall(item); }} className="hum-btn is-sm is-primary w-full sm:w-auto">{state?.status === 'installing' ? '门禁校验中' : installerAvailable ? '经门禁安装' : '安装器未连接'}</button>}
        </div>
        {state && <div role={state.status === 'failed' ? 'alert' : 'status'} className={`mt-2 break-words rounded-md px-3 py-2 text-[10.5px] ${state.status === 'failed' ? 'bg-danger-soft text-danger' : state.status === 'installed' ? 'bg-success-soft text-success' : 'bg-neutral-50 text-neutral-600'}`}>{state.message}</div>}
      </article>;
    })}</div>
  </section>;
}

function CapabilityFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0 rounded-md border border-neutral-100 bg-neutral-25 px-3 py-2"><div className="text-[9.5px] font-semibold text-neutral-500">{label}</div><div className={`mt-1 break-words leading-4 ${mono ? 'break-all font-mono' : ''}`}>{value}</div></div>;
}

function capabilityItemKey(item: CapabilityCatalogItem): string {
  return `${item.record.packageId}:${item.record.packageVersion}:${item.record.packageDigest}`;
}

function capabilitySearchText(item: CapabilityCatalogItem): string {
  const author = item.record.author;
  return [author.title, author.goal, author.preset, item.record.packageId, item.record.status, item.access,
    ...author.failureNotes, ...author.declaredPermissions.flatMap((permission) => [permission.capability, permission.access, ...permission.paths])].join(' ');
}

function sourceBoundaryLabel(boundary: CapabilityCatalogItem['record']['author']['sourceBoundary']): string {
  const parts = [
    boundary.apps.length ? `应用 ${boundary.apps.join('、')}` : '',
    boundary.windows.length ? `窗口 ${boundary.windows.join('、')}` : '',
    boundary.includePaths.length ? `包含 ${boundary.includePaths.join('、')}` : '',
    boundary.excludePaths.length ? `排除 ${boundary.excludePaths.join('、')}` : '',
  ].filter(Boolean);
  return parts.join('；') || '未声明采集范围';
}

function capabilityStatusLabel(status: CapabilityCatalogItem['record']['status']): string {
  if (status === 'draft') return '草稿';
  if (status === 'shadow') return '影子验证';
  if (status === 'verified') return '已验证';
  return '已分享';
}

function capabilityFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof RemoteRelayError) {
    if (error.status === 401) return `${fallback}：工牌缺失、无效或已过期。`;
    if (error.status === 403) return `${fallback}：当前工牌没有所需能力范围。`;
    return `${fallback}：Relay 返回 ${error.code}。`;
  }
  if (error instanceof CapabilityInstallError) return `${fallback}：${error.message}`;
  return `${fallback}：连接或可信边界不可用。`;
}

function KnowledgePanel({ query }: { query: string }) {
  const nodes = useMemo(() => knowledgeNodes.filter((node) => matches(query, `${node.name} ${node.detail}`)), [query]);
  const [selected, setSelected] = useState('goals');
  const active = knowledgeNodes.find((node) => node.id === selected) ?? knowledgeNodes[0];
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"><section><SectionTitle icon={<Network size={15} />} title="组织知识关系" detail="目标、客户、项目、工作方法和团队能力彼此关联，分身会按当前任务找到有权限的上下文。" /><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{nodes.map((node, index) => <button type="button" key={node.id} onClick={() => setSelected(node.id)} className={`min-h-[120px] rounded-md border p-4 text-left transition ${selected === node.id ? 'border-primary-300 bg-primary-50' : 'border-neutral-200 bg-white hover:border-neutral-300'}`}><div className="flex items-center gap-2"><span className={`grid h-7 w-7 place-items-center rounded-md ${index % 3 === 0 ? 'bg-primary-100 text-primary-700' : index % 3 === 1 ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}><Network size={13} /></span><span className="text-[12.5px] font-semibold text-neutral-900">{node.name}</span></div><div className="mt-3 text-[18px] font-semibold text-neutral-900">{node.count}</div><div className="mt-1 text-[10.5px] leading-4 text-neutral-500">{node.detail}</div></button>)}</div></section><aside className="hum-card h-fit p-4 xl:sticky xl:top-3"><div className="text-[10.5px] font-medium text-primary-700">当前选中</div><div className="mt-1 text-[16px] font-semibold text-neutral-900">{active.name}</div><p className="mt-2 text-[11.5px] leading-5 text-neutral-600">{active.detail}</p><div className="mt-4 space-y-2">{['与公司目标相关', '最近 7 天有更新', '仅向已授权成员开放'].map((text) => <div key={text} className="flex items-center gap-2 rounded-md bg-neutral-25 px-3 py-2 text-[11px] text-neutral-600"><Check size={12} className="text-success" />{text}</div>)}</div><div className="mt-4 text-[10.5px] text-neutral-500">选择左侧对象即可查看对应关系摘要。</div></aside></div>;
}

function ModelsPanel({ selected, onSelect }: { selected: string; onSelect: (model: '标准' | '增强' | '旗舰') => void }) {
  const models = [{ name: '标准' as const, detail: '适合整理、提取、分类和高频日常工作。', use: '默认档位' }, { name: '增强' as const, detail: '适合跨资料分析、方案起草与多步骤协作。', use: '复杂工作' }, { name: '旗舰' as const, detail: '适合重要决策、深度研究和高要求交付。', use: '关键成果' }];
  return <section><SectionTitle icon={<BrainCircuit size={15} />} title="模型策略" detail="选择的是企业模型策略，不把底层供应商和版本写死在员工工作方式中。" /><div className="grid grid-cols-1 gap-3 md:grid-cols-2">{models.map((model) => <button type="button" key={model.name} onClick={() => onSelect(model.name)} className={`rounded-md border p-4 text-left ${selected === model.name ? 'border-primary-300 bg-primary-50' : 'border-neutral-200 bg-white hover:border-neutral-300'}`}><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-md bg-neutral-900 text-white"><BrainCircuit size={16} /></div><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-900">{model.name}</div><div className="mt-0.5 text-[10.5px] text-neutral-500">{model.use}</div></div>{selected === model.name && <span className="hum-chip is-success"><Check size={10} /> 默认</span>}</div><p className="mt-3 text-[11.5px] leading-5 text-neutral-600">{model.detail}</p></button>)}</div></section>;
}

function Summary({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) { return <div className="p-4"><div className="flex items-center gap-2 text-[10.5px] text-neutral-500">{icon}{label}</div><div className="mt-2 text-[19px] font-semibold text-neutral-900">{value}</div><div className="mt-1 text-[10.5px] text-neutral-500">{detail}</div></div>; }
function SectionTitle({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="mb-3 flex items-start gap-2"><span className="mt-0.5 text-primary-600">{icon}</span><div><h2 className="text-[14px] font-semibold text-neutral-900">{title}</h2><p className="mt-0.5 text-[11px] text-neutral-500">{detail}</p></div></div>; }
function AppMark({ name }: { name: string }) { return <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-neutral-200 bg-neutral-25 text-[11px] font-semibold text-neutral-700">{name.slice(0, 1)}</div>; }
function matches(query: string, value: string): boolean { return !query.trim() || value.toLowerCase().includes(query.trim().toLowerCase()); }
