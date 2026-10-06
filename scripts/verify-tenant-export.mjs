#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  readJsonExport,
  updateChainHeadProjection,
  verifyArtifactFiles,
  verifyAuditManifest,
  verifyChainHead,
  writeJsonProjection,
} from './lib/tenant-export-verifier.mjs';

try {
  const { kind, options } = parseArguments(process.argv.slice(2));
  const input = readJsonExport(options.input, options.input === '-' ? readFileSync(0) : undefined);
  if (kind === 'chain-head') {
    const chainHead = verifyChainHead(input, {
      tenantId: options.tenant,
      deviceId: options.device,
      position: options.expectedPosition === undefined ? undefined : parsePosition(options.expectedPosition),
      hash: options.expectedHash,
    });
    const projection = options.output ? updateChainHeadProjection(options.output, chainHead, {
      expectedCurrentHash: options.expectedCurrentHash,
    }) : undefined;
    writeResult({
      ok: true,
      kind,
      tenantId: chainHead.tenant_id,
      deviceId: chainHead.device_id,
      position: chainHead.position,
      hash: chainHead.hash,
      outputPath: projection?.path,
      projectionAction: projection?.action,
    });
  } else {
    if (!options.expectedSha256) throw new Error('--expected-sha256 is required for audit-manifest');
    if (!options.artifactsRoot) throw new Error('--artifacts-root is required for full offline audit verification');
    const verified = verifyAuditManifest(input, {
      tenantId: options.tenant,
      sha256: options.expectedSha256,
    });
    const files = verifyArtifactFiles(verified.manifest, options.artifactsRoot);
    const outputPath = options.output ? writeJsonProjection(options.output, verified.manifest) : undefined;
    writeResult({
      ok: true,
      kind,
      tenantId: verified.manifest.tenantId,
      exportId: verified.manifest.exportId,
      range: verified.manifest.range,
      chainHead: verified.manifest.chainHead,
      manifestSha256: verified.manifestSha256,
      filesVerified: files.length,
      outputPath,
    });
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const kind = args.shift();
  if (kind !== 'chain-head' && kind !== 'audit-manifest') throw new Error(usage());
  const allowed = new Set(kind === 'chain-head'
    ? ['input', 'tenant', 'device', 'expected-position', 'expected-hash', 'expected-current-hash', 'output']
    : ['input', 'tenant', 'expected-sha256', 'artifacts-root', 'output']);
  const options = {};
  while (args.length > 0) {
    const raw = args.shift();
    if (!raw?.startsWith('--')) throw new Error(`Unexpected argument: ${raw ?? ''}`);
    const key = raw.slice(2);
    if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
    if (Object.hasOwn(options, camelCase(key))) throw new Error(`Duplicate option: --${key}`);
    const value = args.shift();
    if (value === undefined || value.startsWith('--')) throw new Error(`Option --${key} requires a value`);
    options[camelCase(key)] = value;
  }
  if (!options.input || !options.tenant) throw new Error('--input and --tenant are required');
  return { kind, options };
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function parsePosition(value) {
  if (!/^\d+$/.test(value)) throw new Error('--expected-position must be a positive safe integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('--expected-position must be a positive safe integer');
  return parsed;
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function usage() {
  return [
    'Usage:',
    '  verify-tenant-export.mjs chain-head --input <file.json|-> --tenant <tenantId>',
    '    [--device <deviceId>] [--expected-position <n>] [--expected-hash <sha256>]',
    '    [--expected-current-hash <sha256>] [--output <projection.json>]',
    '  verify-tenant-export.mjs audit-manifest --input <file.json|-> --tenant <tenantId>',
    '    --expected-sha256 <sha256> --artifacts-root <directory> [--output <new.json>]',
  ].join('\n');
}
