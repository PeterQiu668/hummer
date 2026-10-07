import type { RemoteRelayError } from '../execution-nodes/remoteRelayClient';

export interface PublicCapabilityPermission {
  capability: string;
  access: string;
  paths: string[];
}

export interface PublicCapabilityListing {
  schema: 'hummer.public-capability-listing';
  version: 1;
  listingId: string;
  status: 'public';
  packageId: string;
  packageVersion: number;
  packageDigest: string;
  integrity: { kind: 'package_digest'; digest: string };
  title: string;
  goal: string;
  publisherRef: string;
  provenance: {
    capturedAt: string;
    runtime: string;
    runtimeVersion: string;
    agentVersion: string;
    demoSessionCount: number;
  };
  sourceBoundary: {
    applicationCount: number;
    windowPatternCount: number;
    includePathCount: number;
    excludePathCount: number;
  };
  trialRecord: {
    shadowRuns: number;
    success: number;
    failure: number;
    lastRunAt: string;
    regressionPassed: boolean;
    regressionEvidenceDigest: string;
  };
  failureNotes: Array<{ summary: 'Publisher-recorded failure note'; digest: string }>;
  declaredPermissions: PublicCapabilityPermission[];
  receiptRef: string;
  evidenceCount: number;
  publishedAt: string;
}

export interface PublicMarketplaceReaderReporter {
  listPublicCapabilities(): Promise<readonly PublicCapabilityListing[]>;
  getPublicCapability(listingId: string): Promise<PublicCapabilityListing>;
  reportPublicCapability(listingId: string, reason: string): Promise<{ reportId: string; status: 'open'; createdAt: string }>;
}

export interface PublicCapabilityInstallerBoundary {
  /** Trusted host boundary. The browser never manufactures package or install-gate evidence. */
  requestInstall(listing: PublicCapabilityListing): Promise<{ installed: boolean; message: string }>;
}

export interface PublicMarketplacePort extends PublicMarketplaceReaderReporter {
  readonly installerAvailable: boolean;
  requestInstall(listing: PublicCapabilityListing): Promise<{ installed: boolean; message: string }>;
}

let configured: {
  reader: PublicMarketplaceReaderReporter;
  installer: PublicCapabilityInstallerBoundary | null;
} | null = null;

export function configureRemotePublicMarketplace(
  reader: PublicMarketplaceReaderReporter,
  installer?: PublicCapabilityInstallerBoundary,
): () => void {
  const current = { reader, installer: installer ?? null };
  configured = current;
  return () => {
    if (configured === current) configured = null;
  };
}

export function publicMarketplacePort(): PublicMarketplacePort | undefined {
  if (!configured) return undefined;
  const { reader, installer } = configured;
  return {
    listPublicCapabilities: () => reader.listPublicCapabilities(),
    getPublicCapability: (listingId) => reader.getPublicCapability(listingId),
    reportPublicCapability: (listingId, reason) => reader.reportPublicCapability(listingId, reason),
    installerAvailable: Boolean(installer),
    async requestInstall(listing) {
      if (!installer) throw unavailableInstallError();
      return installer.requestInstall(listing);
    },
  };
}

export function publicMarketFailureMessage(error: unknown, fallback: string): string {
  const relay = error as Partial<RemoteRelayError>;
  if (relay.status === 401) return '工牌缺失、无效或已过期；公开能力仍可只读浏览，但不能举报或申请安装。';
  if (relay.status === 403) return '当前工牌没有举报或安装授权范围。';
  if (relay.status === 404) return '该公开能力已下架或不存在。';
  if (relay.status === 503) return 'Remote Relay 未配置公开能力服务。';
  return fallback;
}

function unavailableInstallError(): Error {
  const error = new Error('可信安装器未连接，当前只能查看和举报。');
  error.name = 'PublicInstallUnavailableError';
  return error;
}
