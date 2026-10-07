import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MCPAppsPage from './MCPAppsPage';
import {
  configureRemoteCapabilityCatalog,
  type CapabilityCatalogItem,
  type CapabilityInstallerBoundary,
} from '../../features/capabilities/capabilityCatalogClient';
import { RemoteRelayError } from '../../features/execution-nodes/remoteRelayClient';

let disposeCapability: (() => void) | undefined;

afterEach(() => {
  disposeCapability?.();
  disposeCapability = undefined;
  delete window.hummerRuntimeConnectors;
  delete window.hummerToolRegistry;
  localStorage.removeItem('hummer.auth.session');
});

describe('Capabilities and connections page', () => {
  it('combines experts, skills, knowledge, models and workplace connections', () => {
    render(<MCPAppsPage />);

    expect(screen.getByRole('heading', { name: '能力与连接' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '专家' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '技能' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '企业知识' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '工作应用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '能力网络' })).toBeInTheDocument();
    expect(screen.getByText('飞书')).toBeInTheDocument();
    expect(screen.getByText('钉钉')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '未来规划' })).toBeInTheDocument();
    const feishuCard = screen.getByText('飞书').closest<HTMLElement>('[aria-disabled="true"]');
    expect(feishuCard).not.toBeNull();
    expect(within(feishuCard as HTMLElement).getByText('路线图')).toBeInTheDocument();
    expect(within(feishuCard as HTMLElement).queryByRole('button')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '技能' }));
    expect(screen.getByText(/能力仓未配置 Remote Relay/)).toBeInTheDocument();
  });

  it('does not substitute sample skills when the capability Relay is unconfigured', () => {
    render(<MCPAppsPage />);
    fireEvent.click(screen.getByRole('button', { name: '技能' }));

    expect(screen.getByText(/当前不会展示样例数据，也不能安装/)).toBeInTheDocument();
    expect(screen.queryByText('线索整理与跟进')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加到团队' })).not.toBeInTheDocument();
  });

  it.each([
    [401, 'invalid_token', '工牌缺失、无效或已过期'],
    [403, 'scope_denied', '当前工牌没有所需能力范围'],
  ])('shows Relay %s catalog rejection without falling back to sample data', async (status, code, expected) => {
    disposeCapability = configureRemoteCapabilityCatalog({
      listCapabilities: vi.fn().mockRejectedValue(new RemoteRelayError(status, code, 'unsafe server detail')),
    });

    render(<MCPAppsPage />);
    fireEvent.click(screen.getByRole('button', { name: '技能' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen.queryByText('unsafe server detail')).not.toBeInTheDocument();
    expect(screen.queryByText('线索整理与跟进')).not.toBeInTheDocument();
  });

  it('renders a 390px-safe read-only package without edit or copy controls', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const item = capabilityFixture();
    disposeCapability = configureRemoteCapabilityCatalog({ listCapabilities: vi.fn().mockResolvedValue([item]) });

    render(<MCPAppsPage />);
    fireEvent.click(screen.getByRole('button', { name: '技能' }));

    const card = (await screen.findByText('客户研究复核')).closest<HTMLElement>('[data-testid="capability-card"]');
    expect(card).not.toBeNull();
    expect(card).toHaveClass('min-w-0', 'overflow-hidden');
    expect(within(card as HTMLElement).getByText('团队只读')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText(/不可编辑、复制为本租户资产/)).toBeInTheDocument();
    expect(within(card as HTMLElement).queryByRole('button', { name: /编辑|复制/ })).not.toBeInTheDocument();
    expect(within(card as HTMLElement).getByRole('button', { name: '安装器未连接' })).toBeDisabled();
    expect(within(card as HTMLElement).getByRole('button', { name: '安装器未连接' })).toHaveClass('w-full');
    expect(screen.getByText('5 成功 / 0 失败 / 5 次影子运行 · 回归通过')).toBeInTheDocument();
    expect(screen.getByText('receipt-research')).toBeInTheDocument();
    expect(screen.getByText(/fs\.read · read/)).toBeInTheDocument();
  });

  it('shows a negative install-gate result as failure and never as success', async () => {
    const item = capabilityFixture();
    const installer: CapabilityInstallerBoundary = {
      evaluateAndInstall: vi.fn().mockResolvedValue({
        installed: false,
        requestDigest: 'c'.repeat(64),
        decision: installDecision('denied'),
      }),
    };
    disposeCapability = configureRemoteCapabilityCatalog({ listCapabilities: vi.fn().mockResolvedValue([item]) }, installer);

    render(<MCPAppsPage />);
    fireEvent.click(screen.getByRole('button', { name: '技能' }));
    fireEvent.click(await screen.findByRole('button', { name: '经门禁安装' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/安装门禁拒绝：static_check_failed/);
    expect(screen.queryByText(/门禁已批准并完成安装/)).not.toBeInTheDocument();
    expect(installer.evaluateAndInstall).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('installedSkills')).toBeNull();
  });

  it('labels only a host-observed MCP handshake as connected', async () => {
    window.hummerRuntimeConnectors = {
      list: vi.fn().mockResolvedValue([{
        id: 'node_repl',
        runtimeId: 'codex-cli',
        technicalName: 'node_repl',
        transport: 'mcp',
        status: 'connected',
        checkedAt: '2026-08-28T06:28:55.354Z',
        sessionId: 'thread-1',
        error: null,
      }]),
      subscribe: vi.fn(() => () => undefined),
    };

    render(<MCPAppsPage />);

    expect(await screen.findByText('本地工具连接器')).toBeInTheDocument();
    expect(screen.getAllByText('已验证连接').length).toBeGreaterThan(0);
    expect(screen.getByText(/技术名称：node_repl/)).toBeInTheDocument();
    expect(screen.getByText('飞书')).toBeInTheDocument();
    expect(screen.getAllByText('路线图').length).toBeGreaterThan(0);
  });

  it('marks fs.read verified only after the desktop handshake succeeds', async () => {
    const pending = {
      id: 'tool_fs_read', tenantId: 'tenant_1', capabilityId: 'fs.read', displayName: '工作区文件读取',
      transport: 'mcp' as const, riskLevel: 'low' as const, policyActionPattern: 'fs.read',
      endpoint: { serverName: 'hummer_local', toolName: 'fs_read' }, status: 'pending' as const, verifiedAt: null,
    };
    const verifyLocalMcp = vi.fn().mockResolvedValue({ ...pending, status: 'verified', verifiedAt: '2026-09-11T05:00:00.000Z' });
    window.hummerToolRegistry = {
      list: vi.fn().mockResolvedValue([pending]),
      verifyLocalMcp,
      createExternalSendDraft: vi.fn(),
      chooseEgressDirectory: vi.fn(),
      exportApprovedArtifact: vi.fn(),
      listEgressDeliveries: vi.fn().mockResolvedValue([]),
    };
    window.hummerRuntimeConnectors = {
      list: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn(() => () => undefined),
    };
    localStorage.setItem('hummer.auth.session', 'test-token');

    render(<MCPAppsPage />);

    const card = (await screen.findByText('工作区文件读取')).closest<HTMLElement>('.hum-card');
    if (!card) throw new Error('Tool card was not rendered');
    expect(within(card).getByText('待接入')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '验证连接' }));
    await waitFor(() => expect(verifyLocalMcp).toHaveBeenCalled());
    await waitFor(() => expect(within(card).getByText('已验证连接')).toBeInTheDocument());
  });
});

function capabilityFixture(): CapabilityCatalogItem {
  const digest = 'a'.repeat(64);
  const shareDigest = 'b'.repeat(64);
  const author = {
    schema: 'hummer.capability-package-author-input', version: 1, tenantId: 'tenant-a',
    packageId: 'cap-research', packageVersion: 1, title: '客户研究复核', goal: '核验公开来源并输出带回执的客户研究。',
    preset: 'expert-work', capabilityTrack: { responsibilities: [], workflows: [], standards: [], heuristics: [], pitfalls: [], examples: [] },
    behaviorTrack: { expressionPreferences: [], interactionRules: [], corrections: [] }, runtimeProfile: 'codex-default', toolIds: [],
    requiredCapabilities: ['fs.read'], acceptanceCriteria: ['结果有来源'],
    sourceBoundary: { apps: ['Browser'], windows: ['Research'], includePaths: ['inputs'], excludePaths: ['secrets'] },
    provenance: { demoSessionIds: ['demo-1'], expertActorRef: 'expert:lin', nodeId: 'node-a', device: 'Windows 工作站', runtime: 'codex', runtimeVersion: '0.153.4', agentVersion: '1.0.0', capturedAt: '2026-10-07T07:00:00.000Z' },
    evidenceRefs: ['evidence-1'], failureNotes: ['登录墙来源需人工补充'],
    declaredPermissions: [{ capability: 'fs.read', access: 'read', paths: ['inputs'] }], regressionSuiteRef: 'regression-1', receiptRef: 'receipt-research', status: 'team', deletionAudit: {},
  };
  const trialRecord = {
    tenantId: 'tenant-a', packageId: 'cap-research', packageVersion: 1, packageDigest: digest,
    trialIds: ['trial-1', 'trial-2', 'trial-3', 'trial-4', 'trial-5'], shadowRuns: 5, success: 5, failure: 0,
    lastRunAt: '2026-10-07T07:30:00.000Z', environments: [{ nodeId: 'node-a', os: 'windows', runtime: 'codex', runtimeVersion: '0.153.4', appVersions: {} }],
    regressionPassed: true, regressionEvidenceDigest: 'd'.repeat(64),
  };
  const pkg = { ...author, schema: 'hummer.capability-package', status: 'shared', trialRecord, packageDigest: digest };
  const share = {
    schema: 'hummer.capability-team-share', version: 1, shareId: 'share-research', sourceTenantId: 'tenant-a', targetTenantId: 'tenant-b',
    packageId: 'cap-research', packageVersion: 1, access: 'read_only', allowEdit: false, allowCopyToTenant: false,
    packageDigest: digest, shareDigest, package: pkg, sharedByActorRef: 'human:owner', sharedAt: '2026-10-07T07:45:00.000Z',
  };
  return {
    access: 'read_only',
    record: { tenantId: 'tenant-a', packageId: 'cap-research', packageVersion: 1, packageDigest: digest, author, trialRecord, status: 'shared', sourceTaskId: 'task-1', artifactEventId: 'event-artifact', completedEventId: 'event-completed', createdAt: '2026-10-07T07:00:00.000Z' },
    share,
  } as unknown as CapabilityCatalogItem;
}

function installDecision(decision: 'approved' | 'denied') {
  return {
    schema: 'hummer.capability-install-gate-decision', version: 1, gateId: 'gate-1', shareId: 'share-research', targetTenantId: 'tenant-b',
    decision, reasons: decision === 'approved' ? ['all_checks_passed'] : ['static_check_failed'], packageDigest: 'a'.repeat(64),
    shareDigest: 'b'.repeat(64), requestDigest: 'c'.repeat(64), decidedBy: 'system:capability-install-gate', evaluatedAt: '2026-10-07T08:00:00.000Z',
  };
}
