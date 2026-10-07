import type { RuntimeEnvironmentStatus } from './runtime-environment-doctor.js';
import {
  writeDiagnosticBundle,
  type DiagnosticBundleInput,
  type VerifiedDiagnosticBundle,
} from './diagnostic-bundle.js';

export interface DesktopDiagnosticExportInput {
  destinationPath: string;
  generatedAt: string;
  appVersion: string;
  tenantRef: string;
  nodeRef: string;
  authToken: string;
  environment: RuntimeEnvironmentStatus;
}

export type DesktopDiagnosticExportReceipt = VerifiedDiagnosticBundle & { path: string };

/**
 * Builds diagnostics from an explicit allowlist of generated summaries. It
 * deliberately never walks userData, the workspace, or a customer directory.
 */
export function createDesktopDiagnosticInput(input: Omit<DesktopDiagnosticExportInput, 'destinationPath'>): DiagnosticBundleInput {
  const environmentSummary = {
    schema: 'hummer.desktop-runtime-summary',
    version: 1,
    generatedAt: input.generatedAt,
    ready: input.environment.ready,
    node: {
      available: input.environment.node.available,
      version: input.environment.node.version,
      source: input.environment.node.source,
    },
    codex: {
      available: input.environment.codex.available,
      compatible: input.environment.codex.compatible,
      expectedVersion: input.environment.codex.expectedVersion,
      ...(input.environment.codex.version ? { version: input.environment.codex.version } : {}),
    },
    container: {
      available: input.environment.container.available,
      runtime: input.environment.container.runtime,
      preferredRuntime: input.environment.container.preferredRuntime,
      productionRecommended: input.environment.container.productionRecommended,
    },
  };
  const exportReceipt = {
    schema: 'hummer.diagnostic-export-receipt',
    version: 1,
    generatedAt: input.generatedAt,
    source: 'packaged-desktop-main',
    scope: 'generated-runtime-summary-only',
    policy: 'allowlist-v1',
  };
  return {
    generatedAt: input.generatedAt,
    appVersion: input.appVersion,
    platform: process.platform,
    nodeVersion: process.versions.node,
    tenantRef: input.tenantRef,
    nodeRef: input.nodeRef,
    runtimeStatus: [
      {
        runtime: 'codex',
        status: input.environment.codex.available
          ? (input.environment.codex.compatible ? 'available-compatible' : 'available-incompatible')
          : 'unavailable',
        ...(input.environment.codex.version ? { version: input.environment.codex.version } : {}),
      },
      {
        runtime: 'workspace-exec',
        status: input.environment.container.available ? 'available' : 'unavailable',
        version: input.environment.container.runtime,
      },
    ],
    recentEvents: [],
    files: [
      {
        path: 'config/runtime-summary.json',
        category: 'config-summary',
        contents: `${JSON.stringify(environmentSummary, null, 2)}\n`,
      },
      {
        path: 'receipts/diagnostic-export.json',
        category: 'receipt',
        contents: `${JSON.stringify(exportReceipt, null, 2)}\n`,
      },
    ],
    // The live token is supplied only to the reject scanner; it is never
    // serialized into the archive or returned to the renderer.
    explicitSecrets: [input.authToken],
  };
}

export async function exportDesktopDiagnosticBundle(input: DesktopDiagnosticExportInput): Promise<DesktopDiagnosticExportReceipt> {
  return writeDiagnosticBundle(input.destinationPath, createDesktopDiagnosticInput(input));
}
