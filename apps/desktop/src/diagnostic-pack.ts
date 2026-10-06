import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface DiagnosticEventInput {
  occurredAt: string;
  component: string;
  code: string;
  message: string;
}

export interface DiagnosticFileInput {
  path: string;
  bytes: number;
  sha256: string;
  category: 'log' | 'config-summary' | 'receipt' | 'evidence';
}

export interface DiagnosticPackInput {
  generatedAt: string;
  appVersion: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  tenantRef?: string;
  nodeRef?: string;
  runtimeStatus: ReadonlyArray<{ runtime: string; status: string; version?: string; diagnostic?: string }>;
  recentEvents: ReadonlyArray<DiagnosticEventInput>;
  files: ReadonlyArray<DiagnosticFileInput>;
  explicitSecrets?: ReadonlyArray<string>;
}

export interface DiagnosticPack {
  schema: 'hummer.diagnostic-pack';
  version: 1;
  generatedAt: string;
  appVersion: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  tenantRefHash?: string;
  nodeRefHash?: string;
  runtimeStatus: ReadonlyArray<{ runtime: string; status: string; version?: string; diagnostic?: string }>;
  recentEvents: ReadonlyArray<DiagnosticEventInput>;
  files: ReadonlyArray<DiagnosticFileInput>;
  redaction: { policy: 'allowlist-v1'; explicitSecretCount: number };
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const FORBIDDEN_PATH_SEGMENTS = /(?:^|[\\/])(?:credentials?|secrets?|recordings?|raw[-_ ]?(?:capture|video|audio)|hummer\.sqlite3|.*\.(?:db|sqlite3?|key|pem))(?:$|[\\/])/i;

function hashRef(value: string | undefined): string | undefined {
  return value ? createHash('sha256').update(value, 'utf8').digest('hex') : undefined;
}

function redactText(raw: string, explicitSecrets: readonly string[]): string {
  let value = raw;
  for (const secret of explicitSecrets) {
    if (secret.length >= 4) value = value.split(secret).join('[REDACTED:EXPLICIT]');
  }
  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}\b/gi, 'Bearer [REDACTED:TOKEN]');
  value = value.replace(/\b(?:sk|pk|api|token|secret)[-_][A-Za-z0-9_-]{8,}\b/gi, '[REDACTED:SECRET]');
  value = value.replace(/\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[=:]\s*[^\s,;]+/gi, (match) => {
    const separator = match.includes('=') ? '=' : ':';
    return `${match.split(/[=:]/, 1)[0]}${separator}[REDACTED:VALUE]`;
  });
  value = value.replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s,;"']+/g, '[REDACTED:PATH]');
  value = value.replace(/(^|\s)\/(?:Users|home|tmp|var|private|etc)(?:\/[^\s,;"']*)?/g, '$1[REDACTED:PATH]');
  return value;
}

function requireText(value: string, field: string, maxLength: number): string {
  if (!value.trim() || value.length > maxLength) throw new Error(`${field} is required and must be <= ${maxLength} characters`);
  return value;
}

function sanitizeFile(file: DiagnosticFileInput, secrets: readonly string[]): DiagnosticFileInput {
  const requested = file.path.replaceAll('\\', '/');
  if (!requested || requested.startsWith('/') || /^[A-Za-z]:\//.test(requested) || requested.split('/').includes('..')) {
    throw new Error('diagnostic file paths must be workspace-relative');
  }
  if (FORBIDDEN_PATH_SEGMENTS.test(requested)) throw new Error(`diagnostic file category is forbidden: ${requested}`);
  if (!Number.isInteger(file.bytes) || file.bytes < 0) throw new Error('diagnostic file bytes must be a non-negative integer');
  if (!HASH_PATTERN.test(file.sha256)) throw new Error('diagnostic file sha256 is invalid');
  const normalized = redactText(requested, secrets);
  return { ...file, path: normalized };
}

export function createDiagnosticPack(input: DiagnosticPackInput): DiagnosticPack {
  if (!ISO_UTC_PATTERN.test(input.generatedAt)) throw new Error('diagnostic generatedAt must be UTC ISO-8601');
  const explicitSecrets = (input.explicitSecrets ?? []).filter((secret) => secret.length > 0);
  const secrets = [...explicitSecrets, input.tenantRef, input.nodeRef]
    .filter((secret): secret is string => typeof secret === 'string' && secret.length > 0);
  return {
    schema: 'hummer.diagnostic-pack',
    version: 1,
    generatedAt: input.generatedAt,
    appVersion: requireText(input.appVersion, 'appVersion', 128),
    platform: input.platform,
    nodeVersion: requireText(input.nodeVersion, 'nodeVersion', 128),
    ...(input.tenantRef ? { tenantRefHash: hashRef(input.tenantRef) } : {}),
    ...(input.nodeRef ? { nodeRefHash: hashRef(input.nodeRef) } : {}),
    runtimeStatus: input.runtimeStatus.slice(0, 32).map((runtime) => ({
      runtime: requireText(runtime.runtime, 'runtime', 128),
      status: redactText(requireText(runtime.status, 'runtime status', 512), secrets),
      ...(runtime.version ? { version: redactText(requireText(runtime.version, 'runtime version', 128), secrets) } : {}),
      ...(runtime.diagnostic ? { diagnostic: redactText(runtime.diagnostic.slice(0, 2048), secrets) } : {}),
    })),
    recentEvents: input.recentEvents.slice(-200).map((event) => ({
      occurredAt: event.occurredAt,
      component: requireText(event.component, 'event component', 128),
      code: requireText(event.code, 'event code', 128),
      message: redactText(event.message.slice(0, 4096), secrets),
    })),
    files: input.files.slice(0, 256).map((file) => sanitizeFile(file, secrets)),
    redaction: { policy: 'allowlist-v1', explicitSecretCount: explicitSecrets.length },
  };
}

export function writeDiagnosticPack(path: string, input: DiagnosticPackInput): { path: string; sha256: string; bytes: number } {
  const absolutePath = resolve(path);
  const pack = createDiagnosticPack(input);
  const contents = `${JSON.stringify(pack, null, 2)}\n`;
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, { encoding: 'utf8', flag: 'wx' });
  return {
    path: absolutePath,
    sha256: createHash('sha256').update(contents, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(contents, 'utf8'),
  };
}
