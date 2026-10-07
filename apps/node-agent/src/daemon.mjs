import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { createSharedFleetContractValidator } from './contract-validator.mjs';
import { NodeAgentError } from './errors.mjs';
import { FileExecutionJournal, canonicalJson } from './execution-journal.mjs';
import { FsReadAttestationExecutor } from './fs-read-attestation-executor.mjs';
import { HummerNodeAgent } from './node-agent.mjs';
import { portableOutcomeReceiptValidator } from './outcome-receipt-validator.mjs';
import { FileOutcomeReceiptStore } from './receipt-store.mjs';
import { RelayClientError, RelayHttpClient } from './relay-http-client.mjs';
import { probeAllRuntimes } from './runtime-probes.mjs';
import { assertExactRecord, requireIsoDate, requireNonEmptyString } from './validation.mjs';

const CONFIG_SCHEMA = 'hummer.node-agent-config';
const CONFIG_VERSION = 3;
const PROVIDERS = new Set(['codex', 'claude', 'deepseek', 'cli-other']);
const RISK_CLASSES = new Set(['egress', 'write', 'spend', 'delete', 'privilege', 'network', 'unknown']);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const ACTOR_SAFE_ID = /^[A-Za-z0-9_-]+$/u;

/**
 * @typedef {{
 * schema: 'hummer.node-agent-config', version: 3, nodeId: string, tenantId: string,
 * relayBaseUrl: string, badgeTokenEnv: string, grantTokenEnv: string,
 * grantExpiresAt: string, grantScopes: string[], journalPath: string, receiptRoot: string, workspaceRoot: string,
 * heartbeatIntervalMs: number, pollIntervalMs: number, approvalTtlMs: number,
 * runtime: {provider: 'codex'|'claude'|'deepseek'|'cli-other', executable?: string},
 * capabilities: string[], mcp: {endpoint: string, tools: string[]},
 * approval: {riskClass: 'egress'|'write'|'spend'|'delete'|'privilege'|'network'|'unknown'}
 * }} NodeDaemonConfig
 */

/** @param {string} configPath */
export async function readNodeDaemonConfig(configPath) {
  if (typeof configPath !== 'string' || !isAbsolute(configPath)) {
    throw new NodeAgentError('invalid_daemon_config_path', 'Node Agent config path must be absolute');
  }
  let value;
  try {
    value = JSON.parse(await readFile(resolve(configPath), 'utf8'));
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    throw new NodeAgentError(
      code === 'ENOENT' ? 'daemon_config_not_found' : 'invalid_daemon_config_json',
      code === 'ENOENT' ? 'Node Agent config file was not found' : 'Node Agent config must be valid UTF-8 JSON',
    );
  }
  return validateNodeDaemonConfig(value);
}

/** @param {unknown} value @returns {NodeDaemonConfig} */
export function validateNodeDaemonConfig(value) {
  const input = assertExactRecord(value, [
    'schema', 'version', 'nodeId', 'tenantId', 'relayBaseUrl', 'badgeTokenEnv', 'grantTokenEnv',
    'grantExpiresAt', 'grantScopes', 'journalPath', 'receiptRoot', 'workspaceRoot', 'heartbeatIntervalMs', 'pollIntervalMs',
    'approvalTtlMs', 'runtime', 'capabilities', 'mcp', 'approval',
  ], 'invalid_daemon_config', 'Node Agent daemon config');
  if (input.schema !== CONFIG_SCHEMA || input.version !== CONFIG_VERSION) {
    throw new NodeAgentError('unsupported_daemon_config', `Node Agent config must use ${CONFIG_SCHEMA} version ${CONFIG_VERSION}`);
  }
  const nodeId = requireNonEmptyString(input.nodeId, 'invalid_daemon_config', 'nodeId');
  const tenantId = requireNonEmptyString(input.tenantId, 'invalid_daemon_config', 'tenantId');
  if (!ACTOR_SAFE_ID.test(nodeId)) {
    throw new NodeAgentError('invalid_daemon_config', 'nodeId must contain only letters, digits, underscores, or hyphens');
  }
  const relayBaseUrl = validateRelayUrl(input.relayBaseUrl);
  const badgeTokenEnv = validateEnvName(input.badgeTokenEnv, 'badgeTokenEnv');
  const grantTokenEnv = validateEnvName(input.grantTokenEnv, 'grantTokenEnv');
  if (badgeTokenEnv === grantTokenEnv) {
    throw new NodeAgentError('invalid_daemon_config', 'badgeTokenEnv and grantTokenEnv must be different');
  }
  const grantExpiresAt = requireIsoDate(input.grantExpiresAt, 'invalid_daemon_config', 'grantExpiresAt');
  const grantScopes = stringList(input.grantScopes, 'grantScopes', 1, 64);
  for (const required of ['node.heartbeat', 'task.claim', 'approval.request', 'task.execute']) {
    if (!grantScopes.includes(required)) {
      throw new NodeAgentError('invalid_daemon_config', `grantScopes must include ${required}`);
    }
  }
  const journalPath = absolutePath(input.journalPath, 'journalPath');
  const receiptRoot = absolutePath(input.receiptRoot, 'receiptRoot');
  const workspaceRoot = absolutePath(input.workspaceRoot, 'workspaceRoot');
  if (normalizePath(receiptRoot) === normalizePath(journalPath)) {
    throw new NodeAgentError('invalid_daemon_config', 'receiptRoot must be separate from journalPath');
  }
  if (pathsOverlap(workspaceRoot, receiptRoot) || pathInside(workspaceRoot, journalPath)) {
    throw new NodeAgentError('invalid_daemon_config', 'workspaceRoot must be separate from journalPath and receiptRoot');
  }
  const heartbeatIntervalMs = integerInRange(input.heartbeatIntervalMs, 'heartbeatIntervalMs', 15_000, 30_000);
  const pollIntervalMs = integerInRange(input.pollIntervalMs, 'pollIntervalMs', 100, 60_000);
  const approvalTtlMs = integerInRange(input.approvalTtlMs, 'approvalTtlMs', 1_000, 86_400_000);

  const runtimeInput = assertExactRecord(input.runtime, ['provider', 'executable'], 'invalid_daemon_config', 'runtime');
  const provider = requireNonEmptyString(runtimeInput.provider, 'invalid_daemon_config', 'runtime.provider');
  if (!PROVIDERS.has(provider)) throw new NodeAgentError('invalid_daemon_config', `Unsupported runtime provider: ${provider}`);
  let executable;
  if (runtimeInput.executable !== undefined) executable = requireNonEmptyString(runtimeInput.executable, 'invalid_daemon_config', 'runtime.executable');
  if (provider === 'cli-other' && !executable) throw new NodeAgentError('invalid_daemon_config', 'cli-other runtime requires executable');
  if (provider !== 'cli-other' && executable !== undefined) {
    throw new NodeAgentError('invalid_daemon_config', 'runtime.executable is supported only for cli-other');
  }

  const mcpInput = assertExactRecord(input.mcp, ['endpoint', 'tools'], 'invalid_daemon_config', 'mcp');
  const mcp = {
    endpoint: requireNonEmptyString(mcpInput.endpoint, 'invalid_daemon_config', 'mcp.endpoint'),
    tools: stringList(mcpInput.tools, 'mcp.tools', 0, 128),
  };
  const capabilities = stringList(input.capabilities, 'capabilities', 0, 128);
  if (capabilities.length !== 1 || capabilities[0] !== 'fs.read') {
    throw new NodeAgentError('invalid_daemon_config', 'version 3 advertises only the fs.read capability');
  }
  const approvalInput = assertExactRecord(input.approval, ['riskClass'], 'invalid_daemon_config', 'approval');
  const riskClass = requireNonEmptyString(approvalInput.riskClass, 'invalid_daemon_config', 'approval.riskClass');
  if (!RISK_CLASSES.has(riskClass)) throw new NodeAgentError('invalid_daemon_config', `Unsupported approval riskClass: ${riskClass}`);

  return /** @type {NodeDaemonConfig} */ ({
    schema: CONFIG_SCHEMA,
    version: CONFIG_VERSION,
    nodeId,
    tenantId,
    relayBaseUrl,
    badgeTokenEnv,
    grantTokenEnv,
    grantExpiresAt,
    grantScopes,
    journalPath,
    receiptRoot,
    workspaceRoot,
    heartbeatIntervalMs,
    pollIntervalMs,
    approvalTtlMs,
    runtime: { provider, ...(executable ? { executable } : {}) },
    capabilities,
    mcp,
    approval: { riskClass },
  });
}

/**
 * Read credentials once and immediately remove them from this process's
 * environment. The returned object must never be logged or serialized.
 * @param {NodeDaemonConfig} config
 * @param {NodeJS.ProcessEnv} [environment]
 */
export function consumeDaemonCredentials(config, environment = process.env) {
  const badgeToken = takeSecret(environment, config.badgeTokenEnv, 'Relay badge');
  let grantToken;
  try {
    grantToken = takeSecret(environment, config.grantTokenEnv, 'capability grant');
  } catch (error) {
    delete environment[config.badgeTokenEnv];
    throw error;
  }
  return { badgeToken, grantToken };
}

/**
 * @param {{claimId: string, envelope: unknown, config: NodeDaemonConfig, now?: Date}} input
 */
export function buildDeterministicApprovalRequest(input) {
  const envelope = assertExactRecord(input.envelope, [
    'schema', 'version', 'workOrderTask', 'tenantId', 'targetNodeId', 'targetRuntime',
    'idempotencyKey', 'leaseMs', 'approvalPolicyRef', 'grantRef', 'expiresAt', 'originRef', 'capabilityRef', 'executionPlan',
  ], 'invalid_task_envelope', 'TaskEnvelope');
  const claimId = requireNonEmptyString(input.claimId, 'invalid_claim', 'claimId');
  if (envelope.tenantId !== input.config.tenantId || envelope.targetNodeId !== input.config.nodeId) {
    throw new NodeAgentError('task_scope_mismatch', 'TaskEnvelope is not bound to this daemon');
  }
  const expiresAt = requireIsoDate(envelope.expiresAt, 'invalid_task_envelope', 'TaskEnvelope expiresAt');
  const workOrderId = requireNonEmptyString(envelope.originRef, 'invalid_task_envelope', 'TaskEnvelope originRef');
  const now = input.now ?? new Date();
  const approvalExpiry = Math.min(Date.parse(expiresAt), now.getTime() + input.config.approvalTtlMs);
  if (!Number.isFinite(approvalExpiry) || approvalExpiry <= now.getTime()) {
    throw new NodeAgentError('task_expired', 'TaskEnvelope expired before approval could be requested');
  }
  const digest = createHash('sha256').update(canonicalJson({
    claimId,
    tenantId: input.config.tenantId,
    workOrderId,
    nodeId: input.config.nodeId,
    idempotencyKey: envelope.idempotencyKey,
  }), 'utf8').digest('hex');
  const plan = envelope.executionPlan;
  const readPlan = isFsReadPlan(plan) ? plan : undefined;
  return {
    schema: 'hummer.approval-request',
    version: 1,
    requestId: `request-${digest.slice(0, 32)}`,
    tenantId: input.config.tenantId,
    workOrderId,
    nodeId: input.config.nodeId,
    runId: `run-${digest.slice(0, 32)}`,
    riskClass: input.config.approval.riskClass,
    action: readPlan ? 'fs.read.attest.v1' : 'task.execute',
    target: claimId,
    redactedPreview: readPlan
      ? `Read-only attestation of one approved path (maximum ${readPlan.maxBytes} bytes); file content is not returned.`
      : 'Task execution is unavailable until a human approves the bound request.',
    requestedScope: readPlan
      ? { capabilities: ['task.execute', 'fs.read'], paths: [readPlan.path], maxUses: 1 }
      : { capabilities: ['task.execute'], maxUses: 1 },
    expiresAt: new Date(approvalExpiry).toISOString(),
    requestedBy: `system:${input.config.nodeId}`,
  };
}

/** @param {NodeDaemonConfig} config @param {Awaited<ReturnType<typeof probeAllRuntimes>>} probes @param {number} running */
export function buildNodeManifest(config, probes, running = 0) {
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
    throw new NodeAgentError('unsupported_platform', `Unsupported Node Agent platform: ${process.platform}`);
  }
  return {
    schema: 'hummer.node-manifest',
    version: 1,
    nodeId: config.nodeId,
    tenantIds: [config.tenantId],
    platform: process.platform,
    agentVersion: '0.1.0-alpha.0',
    runtimes: probes.map((probe) => ({
      kind: probe.provider,
      available: probe.status === 'available',
      pinnedVersion: probe.version ?? 'unavailable',
      ...(probe.status === 'available' ? {} : { probeError: probe.detail }),
    })),
    capabilities: config.capabilities,
    mcp: config.mcp,
    load: { running, queued: 0 },
    untrustedNotes: 'Only fs.read.attest.v1 is executable; runtime probes and MCP metadata are inventory only.',
  };
}

export class NodeAgentDaemon {
  /** @type {FileOutcomeReceiptStore} */ receiptStore;
  /** @type {NodeJS.Timeout|null} */ #pollTimer = null;
  /** @type {ReturnType<RelayHttpClient['connectAgent']>|null} */ #events = null;
  /** @type {Set<string>} */ #activeClaims = new Set();
  /** @type {Map<string, unknown>} */ #claimedEnvelopes = new Map();
  /** @type {Set<string>} */ #awaitingApproval = new Set();
  /** @type {Promise<void>|null} */ #tickInFlight = null;
  #started = false;
  #closed = false;

  /**
   * @param {{config: NodeDaemonConfig, badgeToken: string, grantToken: string,
   * fetch?: typeof fetch, probeRunner?: import('./runtime-probes.mjs').ProbeRunner,
   * logger?: (entry: Readonly<Record<string, unknown>>) => void}} options
   */
  constructor(options) {
    this.config = options.config;
    this.#logger = options.logger ?? (() => undefined);
    this.receiptStore = new FileOutcomeReceiptStore({
      root: options.config.receiptRoot,
      tenantId: options.config.tenantId,
      nodeId: options.config.nodeId,
    });
    this.client = new RelayHttpClient({
      baseUrl: options.config.relayBaseUrl,
      badgeToken: options.badgeToken,
      fetch: options.fetch,
      logger: (entry) => this.#log(entry),
      receiptStore: this.receiptStore,
    });
    this.probeRunner = options.probeRunner;
    this.executor = new FsReadAttestationExecutor({ workspaceRoot: options.config.workspaceRoot });
    const transport = this.#trackingTransport(this.client);
    this.agent = new HummerNodeAgent({
      nodeId: options.config.nodeId,
      tenantId: options.config.tenantId,
      heartbeatIntervalMs: options.config.heartbeatIntervalMs,
      grant: {
        token: options.grantToken,
        nodeId: options.config.nodeId,
        tenantId: options.config.tenantId,
        expiresAt: options.config.grantExpiresAt,
        scopes: options.config.grantScopes,
      },
      transport,
      contractValidator: /** @type {any} */ (createSharedFleetContractValidator(portableOutcomeReceiptValidator)),
      executor: this.executor,
      journal: new FileExecutionJournal({ path: options.config.journalPath }),
    });
  }

  /** @type {(entry: Readonly<Record<string, unknown>>) => void} */ #logger;

  async start() {
    if (this.#started) throw new NodeAgentError('daemon_already_started', 'Node Agent daemon is already running');
    if (this.#closed) throw new NodeAgentError('daemon_closed', 'Node Agent daemon cannot restart after closing');
    this.#started = true;
    await this.executor.initialize();
    await this.receiptStore.initialize();
    const probeOptions = this.config.runtime.provider === 'cli-other'
      ? { cliOtherExecutable: this.config.runtime.executable }
      : {};
    this.probes = await probeAllRuntimes(probeOptions, this.probeRunner);
    const initialManifest = this.#manifest();
    await this.client.registerNode(initialManifest, this.#context());
    await this.agent.heartbeatOnce(initialManifest);
    this.agent.startHeartbeat(() => this.#manifest(), (error) => this.#logError('heartbeat.failed', error));
    this.#events = this.client.connectAgent(this.agent, {
      onState: async (state) => {
        try {
          await this.#handleAgentState(state);
        } catch (error) {
          this.#logError('relay.state.failed', error);
          throw error;
        }
      },
      onError: (error) => this.#logError('relay.events.failed', error),
    });
    void this.#events.done.catch((error) => this.#logError('relay.events.closed', error));
    this.#pollTimer = setInterval(() => { void this.#tick(); }, this.config.pollIntervalMs);
    this.#pollTimer.unref();
    await this.#tick();
    this.#log({ event: 'daemon.ready', nodeId: this.config.nodeId, tenantId: this.config.tenantId, executionMode: 'fs.read.attest.v1' });
  }

  async close(reason = 'shutdown') {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    this.#pollTimer = null;
    this.agent.stopHeartbeat();
    this.#events?.close();
    await this.#tickInFlight?.catch(() => undefined);
    await Promise.race([
      this.#events?.done.catch(() => undefined) ?? Promise.resolve(),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
    ]);
    this.#log({ event: 'daemon.stopped', nodeId: this.config.nodeId, reason });
  }

  async #tick() {
    if (this.#closed) return;
    if (this.#tickInFlight) return this.#tickInFlight;
    this.#tickInFlight = this.#tickOnce().finally(() => { this.#tickInFlight = null; });
    return this.#tickInFlight;
  }

  async #tickOnce() {
    try {
      await this.#handleAgentState(await this.agent.pollOnce());
    } catch (error) {
      this.#logError('poll.failed', error);
    }
    for (const claimId of [...this.#awaitingApproval]) {
      try {
        const state = await this.agent.confirmAndExecute(claimId);
        await this.#handleAgentState(state);
      } catch (error) {
        if (isDecisionPending(error)) continue;
        this.#awaitingApproval.delete(claimId);
        this.#activeClaims.delete(claimId);
        this.#logError('claim.execution_blocked', error, { claimId });
      }
    }
  }

  /** @param {unknown} state */
  async #handleAgentState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return;
    const record = /** @type {Record<string, unknown>} */ (state);
    const claimId = typeof record.claimId === 'string' ? record.claimId : undefined;
    if (record.state === 'pending_confirmation' && claimId) {
      this.#activeClaims.add(claimId);
      const envelope = this.#claimedEnvelopes.get(claimId);
      if (!envelope) throw new NodeAgentError('invalid_relay_response', 'Claimed TaskEnvelope was not retained for approval binding');
      const request = buildDeterministicApprovalRequest({ claimId, envelope, config: this.config });
      const approvalState = /** @type {Record<string, unknown>} */ (await this.agent.requestApproval(claimId, request));
      this.#awaitingApproval.add(claimId);
      this.#log({ event: 'claim.awaiting_approval', claimId, requestId: approvalState.requestId });
      return;
    }
    if (claimId && ['completed', 'rejected', 'failed', 'stopped', 'recovery_abandoned', 'recovery_retry_authorized'].includes(String(record.state))) {
      this.#awaitingApproval.delete(claimId);
      this.#activeClaims.delete(claimId);
    }
  }

  /** @param {RelayHttpClient} client */
  #trackingTransport(client) {
    return {
      /** @param {unknown} manifest @param {{nodeId: string, tenantId?: string, grantToken?: string}} context */
      sendHeartbeat: (manifest, context) => client.sendHeartbeat(manifest, context),
      /** @param {{nodeId: string, tenantId?: string, grantToken?: string}} context */
      claimTask: async (context) => {
        const claim = await client.claimTask(context);
        if (claim) this.#claimedEnvelopes.set(claim.claimId, claim.envelope);
        return claim;
      },
      reportClaimStatus: () => client.reportClaimStatus(),
      /** @param {unknown} input @param {{nodeId: string, tenantId?: string, grantToken?: string}} context */
      submitRunEvent: (input, context) => client.submitRunEvent(input, context),
      /** @param {unknown} input */
      submitReceipt: async (input) => { await client.submitReceipt(input); },
      /** @param {string} taskId @param {unknown} input @param {{nodeId: string, tenantId?: string, grantToken?: string}} context */
      submitApprovalRequest: (taskId, input, context) => client.submitApprovalRequest(taskId, input, context),
      /** @param {string} taskId @param {string} requestId @param {{nodeId: string, tenantId?: string, grantToken?: string}} context */
      consumeApprovalDecision: (taskId, requestId, context) => client.consumeApprovalDecision(taskId, requestId, context),
      /** @param {string} taskId @param {string} requestId @param {{nodeId: string, tenantId?: string, grantToken?: string}} context */
      getApprovalAuthorization: (taskId, requestId, context) => client.getApprovalAuthorization(taskId, requestId, context),
      /** @param {string} taskId @param {string} requestId @param {{nodeId: string, tenantId?: string, grantToken?: string}} context */
      consumeTaskGrant: (taskId, requestId, context) => client.consumeTaskGrant(taskId, requestId, context),
      /** @param {string} taskId @param {string} requestId @param {{nodeId: string, tenantId?: string, grantToken?: string}} context */
      checkpointTaskGrant: (taskId, requestId, context) => client.checkpointTaskGrant(taskId, requestId, context),
    };
  }

  #manifest() { return buildNodeManifest(this.config, this.probes ?? [], this.#activeClaims.size); }
  #context() { return { nodeId: this.config.nodeId, tenantId: this.config.tenantId }; }
  /** @param {Readonly<Record<string, unknown>>} entry */
  #log(entry) { this.#logger(Object.freeze({ ...entry })); }
  /** @param {string} event @param {unknown} error @param {Record<string, unknown>} [fields] */
  #logError(event, error, fields = {}) {
    this.#log({ event, ...fields, error: safeError(error) });
  }
}

/**
 * @param {{configPath: string, environment?: NodeJS.ProcessEnv, logger?: (entry: Readonly<Record<string, unknown>>) => void,
 * fetch?: typeof fetch, probeRunner?: import('./runtime-probes.mjs').ProbeRunner}} options
 */
export async function createNodeAgentDaemonFromFile(options) {
  const config = await readNodeDaemonConfig(options.configPath);
  const credentials = consumeDaemonCredentials(config, options.environment);
  return new NodeAgentDaemon({
    config,
    ...credentials,
    fetch: options.fetch,
    probeRunner: options.probeRunner,
    logger: options.logger,
  });
}

/** @param {unknown} value */
function validateRelayUrl(value) {
  const text = requireNonEmptyString(value, 'invalid_daemon_config', 'relayBaseUrl');
  let url;
  try { url = new URL(text); } catch { throw new NodeAgentError('invalid_daemon_config', 'relayBaseUrl must be a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new NodeAgentError('invalid_daemon_config', 'relayBaseUrl must be an HTTP(S) URL without credentials, query, or fragment');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase().replace(/^\[|\]$/gu, ''))) {
    throw new NodeAgentError('invalid_daemon_config', 'Plain HTTP Relay endpoints are allowed only on loopback');
  }
  return url.toString();
}

/** @param {unknown} value @param {string} label */
function validateEnvName(value, label) {
  const name = requireNonEmptyString(value, 'invalid_daemon_config', label);
  if (!ENV_NAME.test(name)) throw new NodeAgentError('invalid_daemon_config', `${label} must be an environment variable name`);
  return name;
}

/** @param {unknown} value @param {string} label */
function absolutePath(value, label) {
  const path = requireNonEmptyString(value, 'invalid_daemon_config', label);
  if (!isAbsolute(path)) throw new NodeAgentError('invalid_daemon_config', `${label} must be absolute`);
  return resolve(path);
}

/** @param {string} value */
function normalizePath(value) {
  const normalized = resolve(value).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** @param {string} parent @param {string} child */
function pathInside(parent, child) {
  const parentPath = `${normalizePath(parent)}${sepForPath()}`;
  return normalizePath(child).startsWith(parentPath);
}

/** @param {string} first @param {string} second */
function pathsOverlap(first, second) {
  return normalizePath(first) === normalizePath(second) || pathInside(first, second) || pathInside(second, first);
}

function sepForPath() { return process.platform === 'win32' ? '\\' : '/'; }

/** @param {unknown} value @returns {value is {kind: 'fs.read.attest.v1', path: string, maxBytes: number}} */
function isFsReadPlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = /** @type {Record<string, unknown>} */ (value);
  return plan.kind === 'fs.read.attest.v1' && typeof plan.path === 'string'
    && Number.isInteger(plan.maxBytes) && Number(plan.maxBytes) >= 1 && Number(plan.maxBytes) <= 1024 * 1024;
}

/** @param {unknown} value @param {string} label @param {number} minimum @param {number} maximum */
function integerInRange(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new NodeAgentError('invalid_daemon_config', `${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} label @param {number} minimum @param {number} maximum */
function stringList(value, label, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new NodeAgentError('invalid_daemon_config', `${label} must contain ${minimum}-${maximum} non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new NodeAgentError('invalid_daemon_config', `${label} must not contain duplicates`);
  return /** @type {string[]} */ ([...value]);
}

/** @param {NodeJS.ProcessEnv} environment @param {string} name @param {string} label */
function takeSecret(environment, name, label) {
  const value = environment[name];
  delete environment[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new NodeAgentError('daemon_credential_missing', `${label} token environment variable is missing`);
  }
  return value;
}

/** @param {unknown} error */
function safeError(error) {
  if (error instanceof NodeAgentError || error instanceof RelayClientError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'unexpected_daemon_error', message: 'Node Agent daemon operation failed' };
}

/** @param {unknown} error */
function isDecisionPending(error) {
  if (!(error instanceof RelayClientError)) return false;
  return error.statusCode === 404 || error.statusCode === 409 || ['approval_pending', 'approval_decision_missing'].includes(error.code);
}
