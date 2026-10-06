import { NodeAgentError } from './errors.mjs';
import { assertExactRecord, requireIsoDate, requireNonEmptyString } from './validation.mjs';

/**
 * @typedef {{ok: true, value: unknown}|{ok: false, errors: string[]}} ValidationResult
 * @typedef {{ok: true, value: {requestId: string, tenantId: string, decision: string, deciderActorRef: string, grantedScope?: {capabilities: string[], expiresAt: string}}}|{ok: false, errors: string[]}} ApprovalValidationResult
 * @typedef {{
 *   sendHeartbeat(input: unknown, context: TransportContext): Promise<void>,
 *   claimTask(context: TransportContext): Promise<unknown|null>,
 *   reportClaimStatus(input: unknown, context: TransportContext): Promise<void>,
 *   submitRunEvent(input: unknown, context: TransportContext): Promise<void>,
 *   submitReceipt(input: unknown, context: TransportContext): Promise<void>
 * }} FleetTransport
 * @typedef {{
 *   validateNodeManifest(input: unknown): ValidationResult,
 *   validateTaskEnvelope(input: unknown): ValidationResult,
 *   validateApprovalDecision(input: unknown): ApprovalValidationResult,
 *   validateRunEvent(input: unknown): ValidationResult,
 *   validateOutcomeReceipt(input: unknown): ValidationResult
 * }} FleetContractValidator
 * @typedef {{execute(input: {envelope: unknown, approval: unknown}): Promise<{events: unknown[], receipt: unknown}>}} NodeTaskExecutor
 * @typedef {{nodeId: string, tenantId: string, grantToken: string}} TransportContext
 */

export class HummerNodeAgent {
  /** @type {string} */ #grantToken;
  /** @type {Set<string>} */ #grantScopes;
  /** @type {FleetTransport} */ #transport;
  /** @type {FleetContractValidator} */ #contractValidator;
  /** @type {NodeTaskExecutor} */ #executor;
  /** @type {() => Date} */ #clock;
  /** @type {Map<string, {claimId: string, deliveryId: string, envelope: unknown}>} */ #pending = new Map();
  /** @type {Set<string>} */ #terminal = new Set();
  /** @type {NodeJS.Timeout|null} */ #heartbeatTimer = null;

  /**
   * @param {{
   * nodeId: string,
   * tenantId: string,
   * heartbeatIntervalMs: number,
   * grant: {token: string, nodeId: string, tenantId: string, expiresAt: string, scopes: string[]},
   * transport: FleetTransport,
   * contractValidator: FleetContractValidator,
   * executor: NodeTaskExecutor,
   * clock?: () => Date
   * }} options
   */
  constructor(options) {
    const input = assertExactRecord(options, ['nodeId', 'tenantId', 'heartbeatIntervalMs', 'grant', 'transport', 'contractValidator', 'executor', 'clock'], 'invalid_agent_config', 'node agent options');
    this.nodeId = requireNonEmptyString(input.nodeId, 'invalid_agent_config', 'nodeId');
    this.tenantId = requireNonEmptyString(input.tenantId, 'invalid_agent_config', 'tenantId');
    const heartbeatIntervalMs = input.heartbeatIntervalMs;
    if (typeof heartbeatIntervalMs !== 'number' || !Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 15_000 || heartbeatIntervalMs > 30_000) {
      throw new NodeAgentError('invalid_agent_config', 'heartbeatIntervalMs must be between 15000 and 30000');
    }
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    const grant = assertExactRecord(input.grant, ['token', 'nodeId', 'tenantId', 'expiresAt', 'scopes'], 'invalid_grant', 'capability grant');
    this.#grantToken = requireNonEmptyString(grant.token, 'invalid_grant', 'grant token');
    if (grant.nodeId !== this.nodeId || grant.tenantId !== this.tenantId) {
      throw new NodeAgentError('grant_scope_mismatch', 'Capability grant is not bound to this node and tenant');
    }
    this.grantExpiresAt = requireIsoDate(grant.expiresAt, 'invalid_grant', 'grant expiresAt');
    const grantScopes = grant.scopes;
    if (!Array.isArray(grantScopes) || grantScopes.some((scope) => typeof scope !== 'string')) {
      throw new NodeAgentError('invalid_grant', 'Grant scopes must be strings');
    }
    this.#grantScopes = new Set(/** @type {string[]} */ (grantScopes));
    this.#transport = /** @type {FleetTransport} */ (input.transport);
    this.#contractValidator = /** @type {FleetContractValidator} */ (input.contractValidator);
    this.#executor = /** @type {NodeTaskExecutor} */ (input.executor);
    this.#clock = typeof input.clock === 'function' ? /** @type {() => Date} */ (input.clock) : () => new Date();
    validatePorts(this.#transport, this.#contractValidator, this.#executor);
  }

  /** @param {() => unknown} buildManifest @param {(error: unknown) => void} onError */
  startHeartbeat(buildManifest, onError) {
    if (this.#heartbeatTimer) throw new NodeAgentError('heartbeat_already_started', 'Heartbeat is already running');
    if (typeof buildManifest !== 'function') throw new NodeAgentError('invalid_manifest_factory', 'Heartbeat manifest factory is required');
    if (typeof onError !== 'function') throw new NodeAgentError('invalid_heartbeat_error_handler', 'Heartbeat error handler is required');
    this.#heartbeatTimer = setInterval(() => {
      void this.heartbeatOnce(buildManifest()).catch(onError);
    }, this.heartbeatIntervalMs);
    this.#heartbeatTimer.unref();
  }

  stopHeartbeat() {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
  }

  /** @param {unknown} manifest */
  async heartbeatOnce(manifest) {
    this.#assertActiveGrant('node.heartbeat');
    const validation = this.#contractValidator.validateNodeManifest(manifest);
    if (!validation || validation.ok !== true) throw new NodeAgentError('invalid_node_manifest', 'Node manifest failed the shared contract validator');
    await this.#transport.sendHeartbeat(validation.value, this.#context());
  }

  async pollOnce() {
    this.#assertActiveGrant('task.claim');
    const rawClaim = await this.#transport.claimTask(this.#context());
    if (rawClaim === null) return { state: 'idle' };
    let claim;
    try {
      claim = parseClaim(rawClaim);
    } catch (error) {
      const claimId = safeClaimId(rawClaim);
      await this.#transport.reportClaimStatus({ claimId, state: 'rejected', reasonCode: 'invalid_claim' }, this.#context());
      return { state: 'rejected', claimId, reasonCode: 'invalid_claim', detail: safeErrorCode(error) };
    }
    if (this.#pending.has(claim.claimId) || this.#terminal.has(claim.claimId)) {
      return { state: 'duplicate', claimId: claim.claimId };
    }
    const validation = this.#contractValidator.validateTaskEnvelope(claim.envelope);
    if (!validation || validation.ok !== true) {
      await this.#transport.reportClaimStatus({ claimId: claim.claimId, state: 'rejected', reasonCode: 'invalid_task_envelope' }, this.#context());
      this.#terminal.add(claim.claimId);
      return { state: 'rejected', claimId: claim.claimId, reasonCode: 'invalid_task_envelope' };
    }
    this.#pending.set(claim.claimId, { ...claim, envelope: validation.value });
    await this.#transport.reportClaimStatus({ claimId: claim.claimId, state: 'pending_confirmation' }, this.#context());
    return { state: 'pending_confirmation', claimId: claim.claimId };
  }

  /** @param {string} claimId @param {unknown} approval */
  async confirmAndExecute(claimId, approval) {
    if (this.#terminal.has(claimId)) return { state: 'duplicate', claimId };
    const claim = this.#pending.get(claimId);
    if (!claim) throw new NodeAgentError('claim_not_pending', 'Claim is not waiting for confirmation');
    this.#assertActiveGrant('task.execute');
    const validation = this.#contractValidator.validateApprovalDecision(approval);
    if (!validation || validation.ok !== true) throw new NodeAgentError('invalid_approval', 'Approval decision failed the shared contract validator');
    const decision = validation.value;
    if (
      decision.requestId !== claimId ||
      decision.tenantId !== this.tenantId ||
      decision.decision !== 'approved' ||
      !/^(?:human|account):/.test(decision.deciderActorRef)
    ) {
      throw new NodeAgentError('approval_not_authorized', 'Execution requires a matching approved decision from an authenticated human or account actor');
    }
    if (!decision.grantedScope?.capabilities.includes('task.execute')) {
      throw new NodeAgentError('approval_scope_denied', 'Approval scope does not grant task.execute');
    }
    if (!Number.isFinite(Date.parse(decision.grantedScope.expiresAt)) || Date.parse(decision.grantedScope.expiresAt) <= this.#clock().getTime()) {
      throw new NodeAgentError('approval_expired', 'Approval scope has expired');
    }
    this.#pending.delete(claimId);
    this.#terminal.add(claimId);
    try {
      const outcome = await this.#executor.execute({ envelope: claim.envelope, approval });
      if (!outcome || !Array.isArray(outcome.events) || outcome.receipt === undefined) {
        throw new NodeAgentError('invalid_execution_outcome', 'Executor must return events and a receipt');
      }
      const validatedEvents = outcome.events.map((event) => {
        const validation = this.#contractValidator.validateRunEvent(event);
        if (!validation || validation.ok !== true) throw new NodeAgentError('invalid_run_event', 'Executor returned an invalid RunEvent');
        return validation.value;
      });
      const receiptValidation = this.#contractValidator.validateOutcomeReceipt(outcome.receipt);
      if (!receiptValidation || receiptValidation.ok !== true) throw new NodeAgentError('invalid_outcome_receipt', 'Executor returned an invalid OutcomeReceipt');
      for (const event of validatedEvents) await this.#transport.submitRunEvent(event, this.#context());
      await this.#transport.submitReceipt(receiptValidation.value, this.#context());
      await this.#transport.reportClaimStatus({ claimId, state: 'completed' }, this.#context());
      return { state: 'completed', claimId };
    } catch (error) {
      await this.#transport.reportClaimStatus({ claimId, state: 'failed', reasonCode: safeErrorCode(error) }, this.#context());
      throw error;
    }
  }

  /** @param {string} requiredScope */
  #assertActiveGrant(requiredScope) {
    if (Date.parse(this.grantExpiresAt) <= this.#clock().getTime()) throw new NodeAgentError('grant_expired', 'Capability grant has expired');
    if (!this.#grantScopes.has(requiredScope)) throw new NodeAgentError('grant_scope_denied', `Capability grant does not include ${requiredScope}`);
  }

  /** @returns {TransportContext} */
  #context() {
    return { nodeId: this.nodeId, tenantId: this.tenantId, grantToken: this.#grantToken };
  }
}

/** @param {unknown} value */
function parseClaim(value) {
  const claim = assertExactRecord(value, ['claimId', 'deliveryId', 'envelope'], 'invalid_claim', 'task claim');
  if (!Object.hasOwn(claim, 'envelope')) throw new NodeAgentError('invalid_claim', 'task claim requires envelope');
  return {
    claimId: requireNonEmptyString(claim.claimId, 'invalid_claim', 'claimId'),
    deliveryId: requireNonEmptyString(claim.deliveryId, 'invalid_claim', 'deliveryId'),
    envelope: claim.envelope,
  };
}

/** @param {unknown} value */
function safeClaimId(value) {
  if (typeof value === 'object' && value !== null && 'claimId' in value && typeof value.claimId === 'string') return value.claimId;
  return 'claim_invalid';
}

/** @param {unknown} error */
function safeErrorCode(error) {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'operation_failed';
}

/** @param {FleetTransport} transport @param {FleetContractValidator} validator @param {NodeTaskExecutor} executor */
function validatePorts(transport, validator, executor) {
  if (typeof transport?.sendHeartbeat !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing sendHeartbeat');
  if (typeof transport?.claimTask !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing claimTask');
  if (typeof transport?.reportClaimStatus !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing reportClaimStatus');
  if (typeof transport?.submitRunEvent !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing submitRunEvent');
  if (typeof transport?.submitReceipt !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing submitReceipt');
  if (typeof validator?.validateNodeManifest !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateNodeManifest');
  if (typeof validator?.validateTaskEnvelope !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateTaskEnvelope');
  if (typeof validator?.validateApprovalDecision !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateApprovalDecision');
  if (typeof validator?.validateRunEvent !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateRunEvent');
  if (typeof validator?.validateOutcomeReceipt !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateOutcomeReceipt');
  if (typeof executor?.execute !== 'function') throw new NodeAgentError('invalid_agent_config', 'Executor is missing execute');
}
