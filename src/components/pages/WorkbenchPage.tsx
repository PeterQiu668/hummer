import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  CircleStop,
  ClipboardCheck,
  FileText,
  FolderOpen,
  GitFork,
  Keyboard,
  Laptop,
  MessageSquare,
  Monitor,
  Orbit,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  Workflow,
  X,
} from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import SessionPlanCard from '../../features/sessions/components/SessionPlanCard';
import WorkbenchComposer from '../../features/sessions/components/WorkbenchComposer';
import {
  draftPlanFromPrompt,
  type ApprovalMode,
  type ExecutionSession,
  type SessionPlan,
  type TrajectoryStep,
} from '../../features/sessions/model/session';
import type { RuntimeAdapter, RuntimeEvent, RuntimeHandle } from '../../features/sessions/runtime/adapter';
import { desktopOrganizationPort } from '../../features/organization/organizationClient';
import { desktopApprovalPolicyPort, type ApprovalEvidence, type ApprovalPreviewResult } from '../../features/approvals/approvalPolicyClient';
import { projectRuntimeSession } from '../../features/sessions/runtime/projection';
import { createDefaultRuntimeAdapter } from '../../features/sessions/runtime/runtimeFactory';
import { actorDisplayName, runtimeDisplayName } from '../../features/sessions/runtime/runtimeDisplay';
import { createDefaultSessionStore, type SessionStore } from '../../features/sessions/persistence/sessionStore';
import { useAppStore } from '../../store/useAppStore';
import { browserEngineProfiles, engineProfileForLabel, listEngineProfiles, type CustomerEngineProfile } from '../../features/engines/engineProfileClient';

const DEFAULT_RUNTIME = createDefaultRuntimeAdapter();

const approvalModes: Record<ApprovalMode, { label: string; detail: string }> = {
  L1: { label: '只查看和起草', detail: '可以读取指定资料并起草结果，不会修改任何系统。' },
  L2: { label: '执行前确认', detail: '可以准备变更，真正写入或发送前会停下来问你。' },
  L3: { label: '范围内自动完成', detail: '在你设定的范围、时限和费用内自动推进。' },
};

interface RuntimeRecord {
  handle: RuntimeHandle;
  plan: SessionPlan;
  events: RuntimeEvent[];
}

export default function WorkbenchPage({ runtime = DEFAULT_RUNTIME, sessionStore }: { runtime?: RuntimeAdapter; sessionStore?: SessionStore }) {
  const [defaultSessionStore] = useState(createDefaultSessionStore);
  const store = sessionStore ?? defaultSessionStore;
  const personalSettings = useAppStore((state) => state.personalSettings);
  const [composerText, setComposerText] = useState('');
  const [assignee, setAssignee] = useState('自动推荐');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(personalSettings.defaultPermission);
  const [attachmentNames, setAttachmentNames] = useState<string[]>([]);
  const [modelProfile, setModelProfile] = useState<string>(personalSettings.preferredModel);
  const [engineProfiles, setEngineProfiles] = useState<readonly CustomerEngineProfile[]>(browserEngineProfiles);
  const [organizationAssignees, setOrganizationAssignees] = useState<string[]>([]);
  const [workContext, setWorkContext] = useState<string>(personalSettings.defaultWorkspace);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [records, setRecords] = useState<RuntimeRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'collab' | 'capability' | 'sop'>('collab');
  const [sopDraft, setSopDraft] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [takeover, setTakeover] = useState(false);
  const [takeoverNote, setTakeoverNote] = useState('');
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [approvalPreview, setApprovalPreview] = useState<ApprovalPreviewResult | null>(null);
  const [approvalEvidence, setApprovalEvidence] = useState<ApprovalEvidence | null>(null);
  const [approvalEvidenceOpen, setApprovalEvidenceOpen] = useState(false);
  const subscriptions = useRef(new Map<string, () => void>());
  const persistenceQueues = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    let cancelled = false;
    void store.listSessions().then((persisted) => {
      if (cancelled || !persisted.length) return;
      setRecords(persisted);
      setActiveSessionId(persisted[0].handle.sessionId);
    });
    return () => { cancelled = true; };
  }, [store]);

  useEffect(() => {
    let active = true;
    void listEngineProfiles().then((profiles) => {
      if (!active || !profiles.length) return;
      setEngineProfiles(profiles);
      setModelProfile((current) => engineProfileForLabel(profiles, current).label);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const organization = desktopOrganizationPort();
    if (!organization) return;
    let active = true;
    void organization.listDigitalEmployees().then((employees) => {
      if (active) setOrganizationAssignees(employees.map((employee) => `${employee.name} · ${employee.id}`));
    }).catch(() => {
      if (active) setOrganizationAssignees([]);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    subscriptions.current.forEach((unsubscribe) => unsubscribe());
    subscriptions.current.clear();
  }, [runtime]);

  const activeRecord = records.find((record) => record.handle.sessionId === activeSessionId);
  const projection = useMemo(
    () => activeRecord ? projectRuntimeSession(activeRecord.plan, activeRecord.handle, activeRecord.events) : undefined,
    [activeRecord],
  );
  const session = projection?.session;
  const pendingApproval = projection?.pendingApproval;
  const lastApprovalResolution = [...(activeRecord?.events ?? [])].reverse().find((event): event is Extract<RuntimeEvent, { type: 'approval_resolved' }> => event.type === 'approval_resolved');
  const lastStep = session?.steps.at(-1);
  const selectedStep = session?.steps.find((item) => item.id === selectedStepId) ?? lastStep;
  const hasDesktopAction = activeRecord?.events.some((event) => event.type === 'tool' && /browser|desktop/i.test(event.tool)) ?? false;
  const isPrototypeRuntime = runtime.id.startsWith('mock');
  const nodeDirectory = isPrototypeRuntime ? '演示工作区' : window.hummerDesktop?.cwd ?? activeRecord?.plan.workContext ?? '桌面宿主工作目录';
  const activeEngineProfile = engineProfileForLabel(engineProfiles, activeRecord?.plan.modelProfile ?? modelProfile);
  const nodeBar = (
    <RuntimeNodeBar
      runtimeId={runtime.id}
      directory={nodeDirectory}
      fallbackReason={runtime.fallbackReason}
      canStop={Boolean(activeRecord && session?.status !== 'cancelled' && session?.status !== 'delivered' && session?.status !== 'interrupted')}
      onStop={() => activeRecord ? runtime.stop(activeRecord.handle) : Promise.resolve()}
    />
  );

  useEffect(() => {
    if (!activeRecord || !pendingApproval) {
      setApprovalPreview(null);
      return;
    }
    const policy = desktopApprovalPolicyPort();
    if (!policy) {
      setApprovalPreview(null);
      return;
    }
    let active = true;
    void policy.preview({
      action: pendingApproval.tool,
      requestedBy: pendingApproval.actorRef,
      estimatedCostCny: pendingApproval.costCny,
    }).then((preview) => {
      if (active) setApprovalPreview(preview);
    }).catch((error) => {
      if (active) setPolicyError(error instanceof Error ? error.message : '未能读取审批策略');
    });
    return () => { active = false; };
  }, [activeRecord?.handle.sessionId, pendingApproval?.approvalId]);

  useEffect(() => {
    if (lastStep) setSelectedStepId(lastStep.id);
  }, [lastStep?.id]);

  useEffect(() => {
    if (session) setSopDraft(session.sopMarkdown);
  }, [session?.id]);

  const appendEvent = (sessionId: string, event: RuntimeEvent) => {
    setRecords((current) => current.map((record) => {
      if (record.handle.sessionId !== sessionId || record.events.some((item) => item.sequence === event.sequence)) return record;
      return { ...record, events: [...record.events, event].sort((left, right) => left.sequence - right.sequence) };
    }));
  };

  const persistAndAppend = (record: RuntimeRecord, event: RuntimeEvent) => {
    const previous = persistenceQueues.current.get(record.handle.sessionId) ?? Promise.resolve();
    const next = previous
      .then(() => store.appendEvent(record.handle, record.plan, event))
      .then((persisted) => appendEvent(record.handle.sessionId, persisted));
    persistenceQueues.current.set(record.handle.sessionId, next);
    const cleanup = () => {
      if (persistenceQueues.current.get(record.handle.sessionId) === next) persistenceQueues.current.delete(record.handle.sessionId);
    };
    void next.then(cleanup, cleanup);
  };

  const attachHandle = async (nextPlan: SessionPlan, handle: RuntimeHandle) => {
    await store.saveSession(nextPlan, handle);
    const replayed: RuntimeEvent[] = [];
    let attached = false;
    const record: RuntimeRecord = { handle, plan: nextPlan, events: [] };
    const unsubscribe = runtime.subscribe(handle, (event) => {
      if (!attached) replayed.push(event);
      else persistAndAppend(record, event);
    });
    subscriptions.current.set(handle.sessionId, unsubscribe);
    const persistedReplay: RuntimeEvent[] = [];
    for (let index = 0; index < replayed.length; index += 1) {
      persistedReplay.push(await store.appendEvent(handle, nextPlan, replayed[index]));
    }
    record.events = persistedReplay;
    setRecords((current) => [...current.filter((item) => item.handle.sessionId !== handle.sessionId), record]);
    setActiveSessionId(handle.sessionId);
    attached = true;
  };

  const draftPlan = (prompt = composerText) => {
    if (!prompt.trim()) return;
    setComposerText(prompt);
    setPlan(draftPlanFromPrompt(prompt, { assignee, approvalMode, attachmentNames, modelProfile, workContext }));
  };

  const delegateToTwin = (prompt: string) => {
    setComposerText(prompt);
    setAssignee(`我的分身 · ${personalSettings.twinName}`);
  };

  const startPlannedSession = async () => {
    if (!plan) return;
    const handle = await runtime.startSession(plan);
    await attachHandle(plan, handle);
    setPlan(null);
    setComposerText('');
    setTakeover(false);
    setContextOpen(false);
  };

  const newTask = () => {
    setActiveSessionId(null);
    setPlan(null);
    setComposerText('');
    setTakeover(false);
    setContextOpen(false);
  };

  const forkFrom = async (sequence: number) => {
    if (!activeRecord) return;
    const handle = await runtime.forkFromCheckpoint(activeRecord.handle, sequence, sopDraft);
    await attachHandle(activeRecord.plan, handle);
    setTakeover(false);
  };

  const resolveApproval = async (approved: boolean) => {
    if (!activeRecord || !pendingApproval) return;
    try {
      const policy = desktopApprovalPolicyPort();
      let finalApproved = approved;
      if (policy) {
        const authorization = await policy.authorize({
          sessionId: activeRecord.handle.sessionId,
          approvalId: pendingApproval.approvalId,
          action: pendingApproval.tool,
          requestedBy: pendingApproval.actorRef,
          estimatedCostCny: pendingApproval.costCny,
          approved,
          occurredAt: new Date().toISOString(),
        });
        finalApproved = authorization.approved;
        if (approved && !finalApproved) setPolicyError(`企业审批策略已拒绝：${authorization.reason}`);
      }
      await runtime.respondToApproval(activeRecord.handle, pendingApproval.approvalId, finalApproved);
      if (policy) void openApprovalEvidence(pendingApproval.approvalId);
      if (!approved || finalApproved) setPolicyError(null);
    } catch (error) {
      setPolicyError(error instanceof Error ? error.message : '审批策略校验失败，已停止回传');
    }
  };

  const openApprovalEvidence = async (approvalId: string) => {
    if (!activeRecord) return;
    const policy = desktopApprovalPolicyPort();
    if (!policy) {
      setPolicyError('当前为演示运行时，未连接企业审批证据账本');
      return;
    }
    try {
      const evidence = await policy.evidence({ sessionId: activeRecord.handle.sessionId, approvalId });
      setApprovalEvidence(evidence);
      setApprovalEvidenceOpen(true);
    } catch (error) {
      setPolicyError(error instanceof Error ? error.message : '审批证据读取失败');
    }
  };

  const sendFollowUp = async () => {
    if (!activeRecord || !followUp.trim()) return;
    const text = followUp.trim();
    setFollowUp('');
    await runtime.sendHumanMessage(activeRecord.handle, text);
  };

  const takeControl = async () => {
    if (!activeRecord) return;
    setTakeover(true);
    await runtime.sendHumanMessage(activeRecord.handle, '真人操作中');
    await runtime.pause(activeRecord.handle);
  };

  const returnControl = async () => {
    if (!activeRecord || !takeoverNote.trim()) return;
    await runtime.sendHumanMessage(activeRecord.handle, takeoverNote.trim());
    await runtime.resume(activeRecord.handle);
    setTakeover(false);
    setTakeoverNote('');
  };

  const prototypeBadge = (
    <span className={`hum-chip ${isPrototypeRuntime ? 'is-warning' : 'is-success'}`}>
      {isPrototypeRuntime ? '产品演示 · 当前使用示例数据' : '真实工作环境已连接'}
    </span>
  );

  if (!session) {
    return (
      <WorkspacePage title="工作台" sub="看清今天的重点，再和你的分身及数字同事一起推进。" actions={prototypeBadge}>
        <div className="min-h-full px-4 py-5 sm:px-6">
          {plan ? (
            <div className="mx-auto w-full max-w-[920px] space-y-4 py-4">
              {nodeBar}
              <SessionPlanCard
                plan={plan}
                onChange={setPlan}
                engineProfiles={engineProfiles}
                onRevise={() => setPlan(null)}
                onStart={startPlannedSession}
              />
              <WorkbenchComposer
                compact
                value={composerText}
                onChange={setComposerText}
                onSubmit={() => draftPlan()}
                assignee={assignee}
                assigneeOptions={organizationAssignees}
                onAssigneeChange={setAssignee}
                approvalMode={approvalMode}
                onApprovalModeChange={setApprovalMode}
                attachmentNames={attachmentNames}
                onAttachmentNamesChange={setAttachmentNames}
                modelProfile={modelProfile}
                onModelProfileChange={setModelProfile}
                engineProfiles={engineProfiles}
                workContext={workContext}
                onWorkContextChange={setWorkContext}
              />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[1180px] space-y-6">
              {nodeBar}
              <WorkdayContext onDelegate={delegateToTwin} mentorEnabled={personalSettings.mentorEnabled} />
              <WorkbenchComposer
                value={composerText}
                onChange={setComposerText}
                onSubmit={() => draftPlan()}
                assignee={assignee}
                assigneeOptions={organizationAssignees}
                onAssigneeChange={setAssignee}
                approvalMode={approvalMode}
                onApprovalModeChange={setApprovalMode}
                attachmentNames={attachmentNames}
                onAttachmentNamesChange={setAttachmentNames}
                modelProfile={modelProfile}
                onModelProfileChange={setModelProfile}
                engineProfiles={engineProfiles}
                workContext={workContext}
                onWorkContextChange={setWorkContext}
                onRecentSelect={draftPlan}
              />
            </div>
          )}
        </div>
      </WorkspacePage>
    );
  }

  const sessionStateText = {
    running: '执行中',
    awaiting_approval: '等待确认',
    paused: '已暂停',
    blocked: lastApprovalResolution?.approved === false ? '已被拒绝' : '被策略阻断',
    delivered: '已交付',
    cancelled: '已停止',
    interrupted: '已中断',
  }[session.status];
  const currentApproval = approvalModes[session.approvalMode];

  return (
    <WorkspacePage
      title="工作台"
      sub="计划、工作进展、实时成果和确认都在同一个任务中。"
      actions={
        <>
          {prototypeBadge}
          <button type="button" onClick={() => setContextOpen((open) => !open)} aria-label="展开协作与能力" className={`hum-btn is-sm ${contextOpen ? 'is-primary' : ''}`}><PanelRightOpen size={13} /></button>
          <button
            type="button"
            onClick={() => activeRecord && runtime.stop(activeRecord.handle)}
            disabled={session.status === 'cancelled' || session.status === 'delivered' || session.status === 'interrupted'}
            className="hum-btn is-sm is-danger disabled:opacity-50"
            aria-label="停止当前会话"
          >
            <CircleStop size={13} /> 停止
          </button>
        </>
      }
    >
      <div className="min-h-full px-3 py-3 sm:px-4 lg:px-5">
        <div className="mx-auto max-w-[1500px] space-y-3">
          {nodeBar}
          <section className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 shadow-sm">
            <span className={`hum-chip ${session.status === 'blocked' || session.status === 'cancelled' || session.status === 'interrupted' ? 'is-error' : session.status === 'awaiting_approval' ? 'is-warning' : session.status === 'delivered' ? 'is-success' : 'is-brand'}`}>
              <span className="hum-dot" /> {sessionStateText}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-800">{activeRecord?.plan.prompt}</span>
            {records.length > 1 && (
              <select aria-label="切换会话" value={activeSessionId ?? ''} onChange={(event) => setActiveSessionId(event.target.value)} className="max-w-[220px] rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10.5px] text-neutral-600 outline-none">
                {records.map((record) => <option key={record.handle.sessionId} value={record.handle.sessionId}>{record.plan.prompt}</option>)}
              </select>
            )}
            <button type="button" onClick={newTask} className="hum-btn is-sm"><Plus size={12} /> 新任务</button>
          </section>

          <div className={`grid grid-cols-1 gap-3 ${contextOpen ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : ''}`}>
            <main className="min-w-0 space-y-3" aria-label="当前执行会话">
              <section className="hum-card overflow-hidden">
                <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-neutral-900 text-white"><Workflow size={16} /></div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-neutral-900">{activeRecord?.plan.assignees.join(' + ')}</div>
                      <div className="mt-0.5 truncate text-[10.5px] text-neutral-500">{currentApproval.detail}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                    <SandboxBadge icon={<FolderOpen size={11} />} label={session.sandbox.workspacePath} />
                    <SandboxBadge icon={<Keyboard size={11} />} label="联网范围已限定" />
                    <SandboxBadge icon={<Laptop size={11} />} label="桌面仅查看" />
                    <SandboxBadge icon={<ShieldCheck size={11} />} label={isPrototypeRuntime ? '示例数据' : '本地授权目录'} />
                    <span className="rounded border border-neutral-200 bg-neutral-25 px-2 py-1 text-neutral-500">已记录 {session.checkpointSequence} 步</span>
                    <span className="rounded border border-neutral-200 bg-neutral-25 px-2 py-1 text-neutral-500">费用上限 ¥{session.sandbox.budgetCny}</span>
                    <SandboxBadge icon={<Orbit size={11} />} label={'数据流向：' + activeEngineProfile.dataDomain} />
                    {session.status === 'running' && <button type="button" onClick={() => activeRecord && runtime.pause(activeRecord.handle)} className="hum-btn is-sm"><Pause size={11} /> 暂停</button>}
                    {session.status === 'paused' && <button type="button" onClick={() => activeRecord && runtime.resume(activeRecord.handle)} className="hum-btn is-sm is-primary"><Play size={11} /> 恢复</button>}
                  </div>
                </div>
              </section>

              <section className="hum-card overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
                  <div>
                    <div className="text-[13px] font-semibold text-neutral-900">工作进展</div>
                    <div className="mt-0.5 text-[10.5px] text-neutral-500">每一步都会留下结果和依据；展开可查看使用了什么、花了多久以及产出了什么。</div>
                  </div>
                  <span className="hum-chip is-muted">{session.steps.length} 步</span>
                </div>
                {session.steps.length === 0 ? (
                  <div className="flex items-center gap-2 px-4 py-8 text-[12px] text-neutral-500"><span className="h-2 w-2 animate-pulse rounded-full bg-primary-500" /> 正在建立受控会话…</div>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {session.steps.map((item) => (
                      <TrajectoryRow
                        key={item.id}
                        item={item}
                        isPrototypeRuntime={isPrototypeRuntime}
                        expanded={selectedStep?.id === item.id}
                        onToggle={() => setSelectedStepId(selectedStep?.id === item.id ? '' : item.id)}
                        onFork={item.sequence >= 3 ? () => forkFrom(item.sequence) : undefined}
                      />
                    ))}
                  </div>
                )}
                {pendingApproval && activeRecord && (
                  <div className="m-3 flex flex-col gap-3 rounded-md border border-warning/40 bg-warning-soft p-3">
                    <div className="flex min-w-0 gap-2">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-neutral-800">{pendingApproval.title}</div>
                        <div className="mt-0.5 text-[11px] text-neutral-600">{pendingApproval.message}</div>
                        {pendingApproval.diffRef && <div className="mt-1 text-[9.5px] text-neutral-400">已生成更新前后差异，可确认后继续</div>}
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10.5px] text-neutral-600 sm:grid-cols-4">
                      <div><dt className="text-neutral-400">请求人</dt><dd>{actorDisplayName(pendingApproval.actorRef)}</dd></div>
                      <div><dt className="text-neutral-400">必须批准</dt><dd>{approvalPreview?.approverDisplayName ?? (approvalPreview?.approverActorRef ? actorDisplayName(approvalPreview.approverActorRef) : '正在确认')}</dd></div>
                      <div><dt className="text-neutral-400">审批策略</dt><dd className="truncate" title={approvalPreview?.policyId ?? undefined}>{approvalPreview?.policyId ?? '正在确认'}</dd></div>
                      <div><dt className="text-neutral-400">预估费用</dt><dd>{pendingApproval.costCny === null ? '未提供' : `¥${pendingApproval.costCny.toFixed(4)}`}</dd></div>
                    </dl>
                    {policyError && <div role="alert" className="text-[10.5px] text-danger">{policyError}</div>}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => { void resolveApproval(false); }} className="hum-btn is-sm is-danger">拒绝本次操作</button>
                      <button type="button" onClick={() => { void resolveApproval(true); }} className="hum-btn is-sm is-primary"><ClipboardCheck size={12} /> 确认更新</button>
                    </div>
                  </div>
                )}
                {lastApprovalResolution?.approved === false && (
                  <div className="mx-3 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-[11px] text-danger">
                    <span>本次受保护操作已被拒绝，执行已停止。</span>
                    <button type="button" onClick={() => { void openApprovalEvidence(lastApprovalResolution.approvalId); }} className="hum-btn is-sm">查看审批证据</button>
                  </div>
                )}
              </section>

              {hasDesktopAction && (
                <DesktopKeyframe onTakeover={takeControl} disabled={takeover} />
              )}

              {takeover && (
                <section className="hum-card border-primary-200 bg-primary-50 p-3">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-primary-800"><UserRound size={14} /> 你已接管，数字同事正在等待</div>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input aria-label="接管结果说明" value={takeoverNote} onChange={(event) => setTakeoverNote(event.target.value)} placeholder="比如：我把 3 家排除了，因为已经在谈" className="min-w-0 flex-1 rounded-md border border-primary-200 bg-white px-3 py-2 text-[12px] outline-none" />
                    <button type="button" onClick={returnControl} disabled={!takeoverNote.trim()} className="hum-btn is-sm is-primary disabled:opacity-40">我做完了，你继续</button>
                  </div>
                </section>
              )}

              {approvalEvidenceOpen && approvalEvidence && (
                <section role="dialog" aria-modal="true" aria-label="审批证据" className="hum-card border-neutral-300 p-4 shadow-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="text-[13px] font-semibold text-neutral-900">审批证据</div><div className="mt-0.5 text-[10.5px] text-neutral-500">该记录来自当前租户的不可篡改事件账本。</div></div>
                    <button type="button" aria-label="关闭审批证据" onClick={() => setApprovalEvidenceOpen(false)} className="hum-btn is-sm"><X size={13} /></button>
                  </div>
                  <dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2 text-[11px] text-neutral-700 sm:grid-cols-2">
                    <div><dt className="text-neutral-400">结论事件</dt><dd>{approvalEvidence.decisionEventType ?? '等待记录'}</dd></div>
                    <div><dt className="text-neutral-400">作出决定</dt><dd>{approvalEvidence.decisionActorDisplayName ?? approvalEvidence.decisionActorRef ?? '未知'}</dd></div>
                    <div><dt className="text-neutral-400">适用策略</dt><dd>{approvalEvidence.policyId ?? '默认拒绝'}</dd></div>
                    <div><dt className="text-neutral-400">指定审批人</dt><dd>{approvalEvidence.approverDisplayName ?? approvalEvidence.approverActorRef ?? '未知'}</dd></div>
                    <div><dt className="text-neutral-400">动作</dt><dd>{approvalEvidence.action}</dd></div>
                    <div><dt className="text-neutral-400">账本哈希</dt><dd className="truncate font-mono text-[10px]" title={approvalEvidence.eventHash ?? undefined}>{approvalEvidence.eventHash ?? '等待记录'}</dd></div>
                  </dl>
                </section>
              )}
              {session.resultPackage && <ResultPanel session={session} onFork={() => forkFrom(Math.max(1, session.checkpointSequence))} />}

              <ExecutionComposer value={followUp} onChange={setFollowUp} onSubmit={sendFollowUp} disabled={session.status === 'cancelled' || session.status === 'delivered' || session.status === 'interrupted'} />
            </main>

            {contextOpen && (
              <ContextRail
                activeTab={rightTab}
                onTabChange={setRightTab}
                sopDraft={sopDraft}
                onSopChange={setSopDraft}
                onFork={() => forkFrom(Math.max(1, session.checkpointSequence))}
                lastStep={lastStep}
                modelProfile={activeRecord?.plan.modelProfile ?? '标准'}
              />
            )}
          </div>
        </div>
      </div>
    </WorkspacePage>
  );
}

function RuntimeNodeBar({ runtimeId, directory, fallbackReason, canStop, onStop }: { runtimeId: string; directory: string; fallbackReason?: string; canStop: boolean; onStop: () => Promise<void> }) {
  const isMock = runtimeId.startsWith('mock');
  return (
    <section aria-label="执行节点状态" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-[10.5px] text-neutral-600">
      <div className="flex items-center gap-2 text-[11.5px] font-semibold text-neutral-900"><Monitor size={13} className="text-primary-600" /> 执行节点</div>
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success" /> 节点在线</span>
      <span className={`hum-chip ${isMock ? 'is-warning' : 'is-success'}`}>{isMock ? '演示运行时' : runtimeDisplayName(runtimeId)}</span>
      {fallbackReason && <span className="text-warning">真实执行内核暂不可用，已切换演示运行时：{fallbackReason}</span>}
      <span className="min-w-0 flex-1 truncate"><span className="text-neutral-400">当前目录：</span>{directory}</span>
      <button type="button" aria-label="停止执行节点" onClick={() => void onStop()} disabled={!canStop} className="hum-btn is-sm is-danger disabled:cursor-not-allowed disabled:opacity-40"><CircleStop size={11} /> 停止</button>
    </section>
  );
}

function WorkdayContext({ onDelegate, mentorEnabled }: { onDelegate: (prompt: string) => void; mentorEnabled: boolean }) {
  const assignedPrompt = '整理华东重点客户跟进清单，补齐负责人、下一步动作和本周截止时间，更新前先给我确认';
  return (
    <section className="overflow-hidden rounded-md border border-neutral-200 bg-white" aria-label="今日工作上下文">
      <div className="grid divide-y divide-neutral-200 lg:grid-cols-[0.9fr_1.2fr_0.9fr] lg:divide-x lg:divide-y-0">
        <div className="p-4">
          <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-500"><Target size={13} className="text-primary-600" /> 公司本季重点</div>
          <div className="mt-2 text-[13px] font-semibold leading-5 text-neutral-900">新增 12 家行业标杆客户</div>
          <div className="mt-1 text-[11px] leading-4 text-neutral-500">你负责华东区域，本月目标 4 家。</div>
          <div className="mt-3 h-1.5 overflow-hidden rounded bg-neutral-100"><div className="h-full w-[67%] rounded bg-primary-600" /></div>
          <div className="mt-1.5 flex justify-between text-[10px] text-neutral-400"><span>当前 8 / 12</span><span>67%</span></div>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-500"><BriefcaseBusiness size={13} className="text-warning" /> 交给我的工作 <span className="ml-auto rounded bg-warning-soft px-1.5 py-0.5 text-[9.5px] text-warning">今天</span></div>
          <div className="mt-2 text-[13px] font-semibold text-neutral-900">整理华东重点客户跟进清单</div>
          <div className="mt-1 text-[11px] text-neutral-500">吴帆 · 销售负责人交办 · 18:00 前</div>
          <button type="button" aria-label="交给分身：整理华东重点客户跟进清单" onClick={() => onDelegate(assignedPrompt)} className="hum-btn is-sm mt-3"><Orbit size={12} /> 交给我的分身</button>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-500"><Orbit size={13} className="text-success" /> 分身建议</div>
          <p className="mt-2 text-[11.5px] leading-5 text-neutral-700">{mentorEnabled ? '先完成客户清单，再准备 16:00 经营会。你上周在“跟进节奏”上有两次延迟，今天建议提前设确认点。' : '已整理今天的目标、交办与会议安排。导师建议可在“我的设置”中开启。'}</p>
          <button type="button" onClick={() => onDelegate('根据公司本季目标和今天的交办，帮我排出今日优先级、时间块和需要我亲自确认的节点')} className="mt-2 flex items-center gap-1 text-[10.5px] font-medium text-primary-700 hover:text-primary-900">按建议安排今天 <ArrowRight size={11} /></button>
        </div>
      </div>
    </section>
  );
}

function TrajectoryRow({ item, expanded, isPrototypeRuntime, onToggle, onFork }: { item: TrajectoryStep; expanded: boolean; isPrototypeRuntime: boolean; onToggle: () => void; onFork?: () => void }) {
  const icon = item.kind === 'tool' ? <Bot size={14} /> : item.kind.includes('human') || item.kind === 'approval' ? <UserRound size={14} /> : item.kind === 'result' ? <FileText size={14} /> : <Workflow size={14} />;
  const statusClass = item.status === 'blocked' || item.status === 'cancelled' ? 'text-error bg-error-soft' : item.status === 'awaiting_human' ? 'text-warning bg-warning-soft' : 'text-success bg-success-soft';
  return (
    <div data-runtime-event-kind={item.kind} data-runtime-tool={item.tool ?? ''} data-runtime-sequence={item.sequence}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-25">
        <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${statusClass}`}>{icon}</div>
        <span className="w-5 shrink-0 font-mono text-[11px] text-neutral-400">{item.sequence}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-neutral-900">{item.title}</span>
          <span className="mt-0.5 block truncate text-[10.5px] text-neutral-500">{actorName(item.actorRef)} · {item.status === 'awaiting_human' ? '等待你确认' : item.result ?? '已记录'}</span>
        </span>
        <span className={`hum-chip ${item.status === 'awaiting_human' ? 'is-warning' : item.status === 'blocked' ? 'is-error' : 'is-muted'}`} style={{ padding: '1px 6px', fontSize: 10 }}>{item.status === 'awaiting_human' ? '待审' : item.status === 'blocked' ? '阻断' : '可追溯'}</span>
        <ChevronDown size={14} className={`text-neutral-400 transition ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mx-4 mb-3 grid gap-2 rounded-md border border-neutral-200 bg-neutral-25 p-3 text-[11px] text-neutral-600 sm:grid-cols-2">
          <Detail label="使用的能力" value={toolName(item.tool)} />
          <Detail label="耗时 / 成本" value={runtimeUsageText(item, isPrototypeRuntime)} />
          <Detail label="工作范围" value={businessArgs(item.args)} />
          <Detail label="结果" value={item.result ?? '无'} />
          <Detail label="交付物" value={outputName(item.output)} />
          <Detail label="可核验记录" value={evidenceNames(item.evidenceRefs)} />
          {onFork && <div className="sm:col-span-2"><button type="button" onClick={(event) => { event.stopPropagation(); onFork(); }} className="hum-btn is-sm"><GitFork size={12} /> 从这里重新尝试</button></div>}
        </div>
      )}
    </div>
  );
}

function ContextRail({ activeTab, onTabChange, sopDraft, onSopChange, onFork, lastStep, modelProfile }: {
  activeTab: 'collab' | 'capability' | 'sop';
  onTabChange: (tab: 'collab' | 'capability' | 'sop') => void;
  sopDraft: string;
  onSopChange: (value: string) => void;
  onFork: () => void;
  lastStep?: TrajectoryStep;
  modelProfile: string;
}) {
  return (
    <aside className="hum-card h-fit overflow-hidden xl:sticky xl:top-12">
      <div className="grid grid-cols-3 border-b border-neutral-200">
        {([['collab', '协作'], ['capability', '资源'], ['sop', '工作方法']] as const).map(([key, label]) => (
          <button type="button" key={key} onClick={() => onTabChange(key)} className={`px-2 py-2.5 text-[11.5px] font-medium ${activeTab === key ? 'border-b-2 border-primary-600 text-primary-700' : 'text-neutral-500 hover:text-neutral-900'}`}>{label}</button>
        ))}
      </div>
      {activeTab === 'collab' && (
        <div className="space-y-3 p-3">
          <RailMessage name="数字同事" role="协作者" text={lastStep?.result ?? '正在准备第一步工作。'} />
          <RailMessage name="你" role="真人" text="可以从页面底部随时补充要求。" human />
        </div>
      )}
      {activeTab === 'capability' && (
        <div className="space-y-3 p-3">
          <Capability title="模型" value={`${modelProfile}档 · 以计划确认时的选择为准`} />
          <Capability title="可用技能" value="客户研究 · 文档分析 · 跟进清单生成" />
          <Capability title="工作应用" value="工作空间 · 受控浏览器 · CRM" />
          <Capability title="当前环境" value="产品演示使用示例数据，不会访问真实文件或业务系统" />
        </div>
      )}
      {activeTab === 'sop' && (
        <div className="space-y-3 p-3">
          <div className="text-[11px] leading-4 text-neutral-500">修改后会创建一个新的尝试，当前结果不会被覆盖。</div>
          <textarea aria-label="本次工作方法" value={sopDraft} onChange={(event) => onSopChange(event.target.value)} className="min-h-[260px] w-full resize-y rounded-md border border-neutral-200 bg-neutral-25 p-2.5 text-[11px] leading-5 text-neutral-700 outline-none focus:border-primary-400" />
          <button type="button" onClick={onFork} className="hum-btn is-sm w-full"><RotateCcw size={12} /> 保存并重新尝试</button>
        </div>
      )}
    </aside>
  );
}

function DesktopKeyframe({ onTakeover, disabled }: { onTakeover: () => void; disabled: boolean }) {
  return (
    <section className="hum-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
        <Monitor size={14} className="text-primary-600" />
        <div className="flex-1 text-[13px] font-semibold text-neutral-900">桌面操作预览</div>
        <span className="hum-chip is-muted" style={{ padding: '1px 6px', fontSize: 10 }}>演示环境</span>
      </div>
      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-center">
        <div className="aspect-[16/6] overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 p-2 text-white">
          <div className="flex h-4 items-center gap-1 rounded-sm bg-neutral-800 px-1.5 text-[8px] text-neutral-400"><span className="h-1.5 w-1.5 rounded-full bg-error" /><span className="h-1.5 w-1.5 rounded-full bg-warning" /><span className="h-1.5 w-1.5 rounded-full bg-success" /><span className="ml-2">客户管理系统 · 更新前预览</span></div>
          <div className="mt-2 grid h-[calc(100%-24px)] grid-cols-[0.55fr_1fr] gap-2">
            <div className="rounded-sm bg-neutral-800 p-2 text-[8px] text-neutral-400"><div>本次任务资料</div><div className="mt-2 text-primary-300">授权资料索引</div><div className="mt-1">工作草稿</div></div>
            <div className="rounded-sm bg-white p-2 text-[8px] text-neutral-700"><div className="font-semibold">更新内容预览</div><div className="mt-2 space-y-1"><div className="h-2 rounded bg-success-soft" /><div className="h-2 rounded bg-primary-50" /><div className="h-2 rounded bg-warning-soft" /></div></div>
          </div>
        </div>
        <div>
          <div className="text-[11px] leading-5 text-neutral-500">当前应用：客户管理系统<br />访问方式：只读预览<br />数据：产品演示数据</div>
          <button type="button" onClick={onTakeover} disabled={disabled} className="hum-btn is-sm mt-3 w-full disabled:opacity-40"><UserRound size={12} /> 我来接管</button>
        </div>
      </div>
    </section>
  );
}

function ResultPanel({ session, onFork }: { session: ExecutionSession; onFork: () => void }) {
  const result = session.resultPackage;
  if (!result) return null;
  return (
    <section className="hum-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
        <FileText size={14} className="text-primary-600" />
        <div className="flex-1 text-[13px] font-semibold text-neutral-900">交付结果</div>
        <span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}>已生成</span>
      </div>
      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <p className="text-[12px] leading-5 text-neutral-700">{result.summary}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><Detail label="交付物" value={result.deliverables[0]?.name ?? '--'} /><Detail label="证据与回滚" value={`${result.evidenceRefs.length} 条证据 · ${result.rollback.supported ? '支持回滚' : '不支持回滚'}`} /></div>
        </div>
        <div className="flex items-end gap-2"><button type="button" onClick={onFork} className="hum-btn is-sm flex-1"><GitFork size={12} /> 打回复跑</button></div>
      </div>
    </section>
  );
}

function ExecutionComposer({ value, onChange, onSubmit, disabled }: { value: string; onChange: (value: string) => void; onSubmit: () => void; disabled: boolean }) {
  return (
    <div className="sticky bottom-0 z-10 flex items-end gap-2 rounded-md border border-neutral-300 bg-white p-2 shadow-md">
      <MessageSquare size={14} className="mb-2.5 ml-1 shrink-0 text-neutral-400" />
      <textarea
        aria-label="在当前会话补充要求"
        rows={2}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(); } }}
        placeholder={disabled ? '本次会话已结束' : '随时插一句：等一下，先只做华东的'}
        className="min-h-[44px] min-w-0 flex-1 resize-none border-0 px-1 py-2 text-[12.5px] outline-none placeholder:text-neutral-400 disabled:bg-white"
      />
      <button type="button" onClick={onSubmit} disabled={disabled || !value.trim()} aria-label="发送补充要求" className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-neutral-900 text-white disabled:opacity-30"><Send size={13} /></button>
    </div>
  );
}

function SandboxBadge({ icon, label }: { icon: React.ReactNode; label: string }) { return <span className="flex max-w-[260px] items-center gap-1 truncate rounded border border-neutral-200 bg-white px-2 py-1 text-neutral-600">{icon}<span className="truncate">{label}</span></span>; }
function actorName(actorRef: string) {
  return actorDisplayName(actorRef);
}
function toolName(tool?: string) {
  const names: Record<string, string> = { 'workspace.read': '读取工作资料', 'document.analyze': '文档分析', 'browser.research': '网页研究', 'crm.write': '客户管理系统更新', 'agent.replay': '重新执行' };
  return tool ? names[tool] ?? '已授权工作能力' : '协作记录';
}
function businessArgs(args?: Record<string, unknown>) {
  if (!args) return '当前步骤无需额外范围';
  if (typeof args.scope === 'string') return `工作空间：${args.scope}${Array.isArray(args.attachments) ? ` · 资料 ${args.attachments.length} 份` : ''}`;
  if (typeof args.records === 'number') return `演示记录 ${args.records} 条`;
  if (args.checkpoint) return '从当前步骤重新执行，并保留原结果';
  return '仅限本次任务已确认的范围';
}
function outputName(output?: string) {
  if (!output) return '本步骤没有单独交付物';
  if (output.includes('input-index')) return '授权资料索引';
  if (output.includes('working-draft')) return '工作草稿';
  if (output.includes('receipt')) return '客户系统更新回执';
  if (output.includes('replay-report')) return '重新执行差异报告';
  if (output.includes('task-report')) return '任务交付报告';
  return '本步骤产出记录';
}
function runtimeUsageText(item: TrajectoryStep, isPrototypeRuntime: boolean) {
  const duration = item.durationMs !== undefined ? `${(item.durationMs / 1000).toFixed(2)}s` : '--';
  if (isPrototypeRuntime) return `${duration} / 演示数据`;
  if (item.costCny !== undefined) return `${duration} / ¥${item.costCny.toFixed(4)}`;
  if (item.usage) return `${duration} / ${item.usage.totalTokens.toLocaleString()} tokens · 价格未配置`;
  return `${duration} / 该 runtime 未提供用量`;
}
function evidenceNames(refs: string[]) {
  if (!refs.length) return '暂无';
  const labels = refs.map((ref) => ref.includes('workspace') ? '授权资料记录' : ref.includes('receipt') ? '更新回执' : ref.includes('diff') ? '更新差异记录' : ref.startsWith('policy:') ? '权限策略记录' : ref.includes('draft') || ref.includes('runtime') ? '工作草稿记录' : '操作日志');
  return [...new Set(labels)].join(' · ');
}
function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="min-w-0"><div className="text-[9.5px] text-neutral-400">{label}</div><div className={`mt-0.5 break-words text-[11px] text-neutral-700 ${mono ? 'font-mono' : ''}`}>{value || '无'}</div></div>; }
function RailMessage({ name, role, text, human = false }: { name: string; role: string; text: string; human?: boolean }) { return <div className={`rounded-md p-2.5 ${human ? 'bg-primary-50' : 'bg-neutral-25'}`}><div className="flex items-center gap-1.5 text-[10.5px] font-medium text-neutral-700"><span className={`h-1.5 w-1.5 rounded-full ${human ? 'bg-primary-500' : 'bg-success'}`} />{name}<span className="ml-auto text-[9.5px] text-neutral-400">{role}</span></div><p className="mt-1 text-[11px] leading-4 text-neutral-600">{text}</p></div>; }
function Capability({ title, value }: { title: string; value: string }) { return <div className="rounded-md border border-neutral-200 p-2.5"><div className="text-[10px] text-neutral-400">{title}</div><div className="mt-1 break-words text-[11px] leading-4 text-neutral-700">{value}</div></div>; }
