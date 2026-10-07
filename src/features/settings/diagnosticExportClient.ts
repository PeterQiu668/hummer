import { currentSessionToken } from '../identity/identityClient';

export interface DiagnosticExportReceipt {
  archiveSha256: string;
  archiveBytes: number;
  fileCount: number;
}

export interface DesktopDiagnosticExportHost {
  exportBundle(token: string): Promise<DiagnosticExportReceipt | null>;
}

declare global {
  interface Window { hummerDiagnostics?: DesktopDiagnosticExportHost }
}

export function hasDiagnosticExportBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.hummerDiagnostics);
}

export async function exportDiagnosticBundle(): Promise<DiagnosticExportReceipt | null> {
  const token = currentSessionToken();
  if (!token || !window.hummerDiagnostics) throw new Error('诊断包导出仅在已登录的 HUMMER 桌面版中可用。');
  return window.hummerDiagnostics.exportBundle(token);
}
