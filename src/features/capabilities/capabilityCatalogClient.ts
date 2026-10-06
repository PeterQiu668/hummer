import type {
  CapabilityInstallGateDecision,
  CapabilityPackageAuthorInput,
  TeamReadOnlyShare,
  TrialRecord,
} from '@hummer/contracts';

export interface CapabilityRegistryRecord {
  tenantId: string;
  packageId: string;
  packageVersion: number;
  packageDigest: string;
  author: CapabilityPackageAuthorInput;
  trialRecord: TrialRecord | null;
  status: 'draft' | 'shadow' | 'verified' | 'shared';
  sourceTaskId: string;
  artifactEventId: string;
  completedEventId: string;
  createdAt: string;
}

export interface CapabilityCatalogItem {
  access: 'owner' | 'read_only';
  record: CapabilityRegistryRecord;
  share: TeamReadOnlyShare | null;
}

export interface CapabilityInstallRequest {
  packageId: string;
  packageVersion: number;
  packageDigest: string;
  shareId: string;
  shareDigest: string;
  targetTenantId: string;
}

export interface CapabilityInstallBoundaryResult {
  /** True only after the local installer has committed the verified package. */
  installed: boolean;
  /** Digest of the exact install-gate request evaluated by the trusted boundary. */
  requestDigest: string;
  decision: CapabilityInstallGateDecision;
}

export interface CapabilityCatalogReader {
  listCapabilities(): Promise<readonly CapabilityCatalogItem[]>;
}

/**
 * This port belongs to a trusted local installer or install-gate service. The
 * renderer deliberately cannot manufacture static-check or source-verification
 * evidence and therefore submits only immutable package/share identifiers.
 */
export interface CapabilityInstallerBoundary {
  evaluateAndInstall(request: CapabilityInstallRequest): Promise<CapabilityInstallBoundaryResult>;
}

export interface CapabilityCatalogPort extends CapabilityCatalogReader {
  readonly installerAvailable: boolean;
  install(item: CapabilityCatalogItem): Promise<VerifiedCapabilityInstall>;
}

export interface VerifiedCapabilityInstall {
  packageId: string;
  packageVersion: number;
  packageDigest: string;
  shareId: string;
  requestDigest: string;
  evaluatedAt: string;
}

export class CapabilityInstallError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CapabilityInstallError';
  }
}

let configured: { reader: CapabilityCatalogReader; installer: CapabilityInstallerBoundary | null } | null = null;

export function configureRemoteCapabilityCatalog(
  reader: CapabilityCatalogReader,
  installer?: CapabilityInstallerBoundary,
): () => void {
  const current = { reader, installer: installer ?? null };
  configured = current;
  return () => {
    if (configured === current) configured = null;
  };
}

export function capabilityCatalogPort(): CapabilityCatalogPort | undefined {
  const current = configured;
  if (!current) return undefined;
  const { reader, installer } = current;
  return {
    listCapabilities: () => reader.listCapabilities(),
    installerAvailable: Boolean(installer),
    install: async (item) => {
      if (!installer) {
        throw new CapabilityInstallError('installer_unavailable', '可信安装器未连接，当前只能查看能力包。');
      }
      const request = installRequestFor(item);
      const result = await installer.evaluateAndInstall(request);
      return verifyInstallBoundaryResult(request, result);
    },
  };
}

export function installRequestFor(item: CapabilityCatalogItem): CapabilityInstallRequest {
  if (item.access !== 'read_only' || !item.share) {
    throw new CapabilityInstallError('not_installable', '只有经过团队只读分享的能力包可以安装。');
  }
  const { record, share } = item;
  if (share.access !== 'read_only'
    || share.allowEdit !== false
    || share.allowCopyToTenant !== false
    || share.packageId !== record.packageId
    || share.packageVersion !== record.packageVersion
    || share.packageDigest !== record.packageDigest) {
    throw new CapabilityInstallError('share_binding_invalid', '能力包与只读分享的摘要绑定不一致。');
  }
  return {
    packageId: record.packageId,
    packageVersion: record.packageVersion,
    packageDigest: record.packageDigest,
    shareId: share.shareId,
    shareDigest: share.shareDigest,
    targetTenantId: share.targetTenantId,
  };
}

export function verifyInstallBoundaryResult(
  request: CapabilityInstallRequest,
  result: CapabilityInstallBoundaryResult,
): VerifiedCapabilityInstall {
  const decision = result.decision;
  const bound = decision.schema === 'hummer.capability-install-gate-decision'
    && decision.version === 1
    && decision.decidedBy === 'system:capability-install-gate'
    && decision.shareId === request.shareId
    && decision.targetTenantId === request.targetTenantId
    && decision.packageDigest === request.packageDigest
    && decision.shareDigest === request.shareDigest
    && decision.requestDigest === result.requestDigest
    && /^[a-f0-9]{64}$/.test(result.requestDigest);
  if (!bound) {
    throw new CapabilityInstallError('decision_binding_invalid', '安装门禁决定与所选能力包、分享或请求摘要不一致。');
  }
  if (decision.decision !== 'approved' || !result.installed) {
    throw new CapabilityInstallError(
      'install_denied',
      `安装门禁拒绝：${decision.reasons.join('、') || '未通过可信校验'}`,
    );
  }
  return {
    packageId: request.packageId,
    packageVersion: request.packageVersion,
    packageDigest: request.packageDigest,
    shareId: request.shareId,
    requestDigest: result.requestDigest,
    evaluatedAt: decision.evaluatedAt,
  };
}
