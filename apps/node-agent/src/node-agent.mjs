import { NodeAgentError } from './errors.mjs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { canonicalJson, sha256Hex } from './execution-journal.mjs';
import { assertExactRecord, isRecord, requireIsoDate, requireNonEmptyString } from './validation.mjs';

/**
 * @typedef {{ok: true, value: unknown}|{ok: false, errors: string[]}} ValidationResult
 * @typedef {{ok: true, value: {requestId: string, tenantId: string, decision: string, deciderActorRef: string, grantedScope?: {capabilities: string[], expiresAt: string}}}|{ok: false, errors: string[]}} ApprovalValidationResult
 * @typedef {{
 *   sendHeartbeat(input: unknown, context: TransportContext): Promise<void>,
 *   claimTask(context: TransportContext): Promise<unknown|null>,
 *   reportClaimStatus(input: unknown, context: TransportContext): Promise<void>,
 *   submitRunEvent(input: unknown, context: TransportContext): Promise<void>,
 *   submitReceipt(input: unknown, context: TransportContext): Promise<void>,
 *   submitApprovalRequest(claimId: string, input: unknown, context: TransportContext): Promise<unknown>,
 *   consumeApprovalDecision(claimId: string, requestId: string, context: TransportContext): Promise<unknown>,
 *   getApprovalAuthorization(claimId: string, requestId: string, context: TransportContext): Promise<unknown>
 * }} FleetTransport
 * @typedef {{
 *   validateNodeManifest(input: unknown): ValidationResult,
 *   validateTaskEnvelope(input: unknown): ValidationResult,
 *   validateApprovalRequest(input: unknown): ValidationResult,
 *   validateApprovalDecision(input: unknown): ApprovalValidationResult,
 *   validateRunEvent(input: unknown): ValidationResult,
 *   validateOutcomeReceipt(input: unknown): ValidationResult
 * }} FleetContractValidator
 * @typedef {{execute(input: {envelope: unknown, approvalRequest: unknown, approval: unknown, authorization: {signal: AbortSignal, checkpoint(): Promise<void>}}): Promise<{events: unknown[], receipt: unknown}>}} NodeTaskExecutor
 * @typedef {{
 *   initialize(scope: {tenantId: string, nodeId: string}): {claims: Array<Record<string, unknown>>},
 *   append(record: Record<string, unknown>): Record<string, unknown>|undefined
 * }} ExecutionJournal
 * @typedef {{nodeId: string, tenantId: string, grantToken: string}} TransportContext
 */

export class HummerNodeAgent {
  /** @type {string} */ #grantToken;
  /** @type {Set<string>} */ #grantScopes;
  /** @type {FleetTransport} */ #transport;
  /** @type {FleetContractValidator} */ #contractValidator;
  /** @type {NodeTaskExecutor} */ #executor;
  /** @type {ExecutionJournal} */ #journal;
  /** @type {() => Date} */ #clock;
  /** @type {() => string} */ #idFactory;
  /** @type {Map<string, {claimId: string, deliveryId: string, envelope: unknown, binding: ReturnType<typeof readValidatedEnvelopeBinding>, approvalRequest?: unknown}>} */ #pending = new Map();
  /** @type {Map<string, Record<string, unknown>>} */ #knownClaims = new Map();
  /** @type {Set<string>} */ #recoveryRequired = new Set();
  /** @type {Map<string, Record<string, unknown>>} */ #recoveryResolutions = new Map();
  /** @type {Set<string>} */ #issuedRecoveryIdentifiers = new Set();
  /** @type {Set<string>} */ #terminal = new Set();
  /** @type {Set<string>} */ #stopped = new Set();
  /** @type {Set<string>} */ #confirming = new Set();
  /** @type {Map<string, {requestId: string, expiresAt: string, controller: AbortController, cancelReason?: string, revokeHint?: boolean}>} */ #executing = new Map();
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
   * journal: ExecutionJournal,
   * clock?: () => Date,
   * idFactory?: () => string
   * }} options
   */
  constructor(options) {
    const input = assertExactRecord(options, ['nodeId', 'tenantId', 'heartbeatIntervalMs', 'grant', 'transport', 'contractValidator', 'executor', 'journal', 'clock', 'idFactory'], 'invalid_agent_config', 'node agent options');
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
    this.#journal = /** @type {ExecutionJournal} */ (input.journal);
    this.#clock = typeof input.clock === 'function' ? /** @type {() => Date} */ (input.clock) : () => new Date();
    this.#idFactory = typeof input.idFactory === 'function' ? /** @type {() => string} */ (input.idFactory) : randomUUID;
    validatePorts(this.#transport, this.#contractValidator, this.#executor, this.#journal);
    const snapshot = initializeJournal(this.#journal, { tenantId: this.tenantId, nodeId: this.nodeId });
    for (const claim of snapshot.claims) {
      const claimId = requireNonEmptyString(claim.claimId, 'journal_corrupt', 'journal claimId');
      this.#knownClaims.set(claimId, claim);
      if (claim.state === 'terminal') {
        this.#terminal.add(claimId);
        if (claim.terminalState === 'stopped') this.#stopped.add(claimId);
      } else if (claim.state === 'recovery_abandoned' || claim.state === 'recovery_retry_authorized') {
        this.#terminal.add(claimId);
        this.#recoveryResolutions.set(claimId, claim);
        for (const key of ['resolutionId', 'retryAttemptId', 'retryIdempotencyKey']) {
          if (typeof claim[key] === 'string') this.#issuedRecoveryIdentifiers.add(claim[key]);
        }
      } else {
        this.#recoveryRequired.add(claimId);
      }
    }
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
    const binding = readValidatedNodeManifestBinding(validation.value);
    if (binding.nodeId !== this.nodeId || binding.tenantIds.length !== 1 || binding.tenantIds[0] !== this.tenantId) {
      throw new NodeAgentError('node_manifest_scope_mismatch', 'Node manifest is not bound to this single-tenant agent');
    }
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
    const validation = this.#contractValidator.validateTaskEnvelope(claim.envelope);
    if (!validation || validation.ok !== true) {
      if (this.#knownClaims.has(claim.claimId)) throw new NodeAgentError('journal_claim_mismatch', 'Duplicate claim envelope no longer passes contract validation');
      await this.#transport.reportClaimStatus({ claimId: claim.claimId, state: 'rejected', reasonCode: 'invalid_task_envelope' }, this.#context());
      this.#terminal.add(claim.claimId);
      return { state: 'rejected', claimId: claim.claimId, reasonCode: 'invalid_task_envelope' };
    }
    const envelope = readValidatedEnvelopeBinding(validation.value);
    const envelopeHash = digest(validation.value);
    const known = this.#knownClaims.get(claim.claimId);
    if (known) {
      assertKnownClaim(known, claim, envelope, envelopeHash);
      if (this.#recoveryRequired.has(claim.claimId)) return { state: 'recovery_required', claimId: claim.claimId };
      return { state: 'duplicate', claimId: claim.claimId };
    }
    if (envelope.tenantId !== this.tenantId || envelope.targetNodeId !== this.nodeId) {
      await this.#transport.reportClaimStatus({ claimId: claim.claimId, state: 'rejected', reasonCode: 'task_scope_mismatch' }, this.#context());
      this.#terminal.add(claim.claimId);
      return { state: 'rejected', claimId: claim.claimId, reasonCode: 'task_scope_mismatch' };
    }
    if (Date.parse(envelope.expiresAt) <= this.#clock().getTime()) {
      await this.#transport.reportClaimStatus({ claimId: claim.claimId, state: 'rejected', reasonCode: 'task_expired' }, this.#context());
      this.#terminal.add(claim.claimId);
      return { state: 'rejected', claimId: claim.claimId, reasonCode: 'task_expired' };
    }
    this.#record({
      type: 'claim_accepted',
      claimId: claim.claimId,
      deliveryId: claim.deliveryId,
      workOrderId: envelope.workOrderId,
      envelopeHash,
    });
    this.#pending.set(claim.claimId, { ...claim, envelope: validation.value, binding: envelope });
    await this.#transport.reportClaimStatus({ claimId: claim.claimId, state: 'pending_confirmation' }, this.#context());
    return { state: 'pending_confirmation', claimId: claim.claimId };
  }

  /** @param {string} claimId @param {unknown} request */
  async requestApproval(claimId, request) {
    const resolution = this.#resolutionResult(claimId);
    if (resolution) return resolution;
    if (this.#stopped.has(claimId)) return { state: 'stopped', claimId };
    if (this.#terminal.has(claimId)) return { state: 'duplicate', claimId };
    if (this.#executing.has(claimId)) return { state: 'executing', claimId };
    if (this.#recoveryRequired.has(claimId)) return { state: 'recovery_required', claimId };
    const claim = this.#pending.get(claimId);
    if (!claim) throw new NodeAgentError('claim_not_pending', 'Claim is not waiting for confirmation');
    if (claim.approvalRequest) throw new NodeAgentError('approval_replayed', 'Claim already has an approval request');
    this.#assertActiveGrant('approval.request');
    const validation = this.#contractValidator.validateApprovalRequest(request);
    if (!validation || validation.ok !== true) throw new NodeAgentError('invalid_approval_request', 'Approval request failed the shared contract validator');
    const approvalRequest = readValidatedApprovalRequest(validation.value);
    if (
      approvalRequest.tenantId !== this.tenantId ||
      approvalRequest.nodeId !== this.nodeId ||
      approvalRequest.workOrderId !== claim.binding.workOrderId ||
      approvalRequest.target !== claimId
    ) {
      throw new NodeAgentError('approval_request_mismatch', 'Approval request is not bound to the pending claim');
    }
    if (Date.parse(approvalRequest.expiresAt) <= this.#clock().getTime()) {
      throw new NodeAgentError('approval_expired', 'Approval request has expired');
    }
    if (!approvalRequest.requestedScope.capabilities.includes('task.execute')) {
      throw new NodeAgentError('approval_scope_denied', 'Approval request does not request task.execute');
    }
    const persisted = await this.#transport.submitApprovalRequest(claimId, validation.value, this.#context());
    const persistedValidation = this.#contractValidator.validateApprovalRequest(persisted);
    if (!persistedValidation || persistedValidation.ok !== true || !isDeepStrictEqual(persistedValidation.value, validation.value)) {
      throw new NodeAgentError('invalid_relay_response', 'Relay did not return the bound approval request');
    }
    const known = this.#requireKnownClaim(claimId);
    try {
      this.#record({
        type: 'approval_request_recorded',
        claimId,
        deliveryId: known.deliveryId,
        workOrderId: known.workOrderId,
        envelopeHash: known.envelopeHash,
        requestId: approvalRequest.requestId,
        approvalRequestHash: digest(persistedValidation.value),
      });
    } catch (error) {
      this.#pending.delete(claimId);
      this.#recoveryRequired.add(claimId);
      throw error;
    }
    claim.approvalRequest = validation.value;
    await this.#transport.reportClaimStatus({ claimId, state: 'awaiting_approval', requestId: approvalRequest.requestId }, this.#context());
    return { state: 'awaiting_approval', claimId, requestId: approvalRequest.requestId };
  }

  /**
   * Fetch and consume the immutable decision from the authenticated Relay.
   * A caller-supplied decision is deliberately rejected.
   * @param {string} claimId
   */
  async confirmAndExecute(claimId) {
    if (arguments.length !== 1) {
      throw new NodeAgentError('local_approval_forbidden', 'Approval decisions must be consumed from the authenticated Relay');
    }
    if (this.#confirming.has(claimId)) return { state: 'confirming', claimId };
    this.#confirming.add(claimId);
    try {
      return await this.#confirmAndExecuteOnce(claimId);
    } finally {
      this.#confirming.delete(claimId);
    }
  }

  /** @param {string} claimId */
  async #confirmAndExecuteOnce(claimId) {
    const resolution = this.#resolutionResult(claimId);
    if (resolution) return resolution;
    if (this.#stopped.has(claimId)) return { state: 'stopped', claimId };
    if (this.#terminal.has(claimId)) return { state: 'duplicate', claimId };
    if (this.#executing.has(claimId)) return { state: 'executing', claimId };
    if (this.#recoveryRequired.has(claimId)) return { state: 'recovery_required', claimId };
    const claim = this.#pending.get(claimId);
    if (!claim) throw new NodeAgentError('claim_not_pending', 'Claim is not waiting for confirmation');
    if (!claim.approvalRequest) throw new NodeAgentError('approval_not_requested', 'Claim has no persisted approval request');
    this.#assertActiveGrant('task.execute');
    const localRequest = readValidatedApprovalRequest(claim.approvalRequest);
    const bundle = parseApprovalBundle(await this.#transport.consumeApprovalDecision(
      claimId,
      localRequest.requestId,
      this.#context(),
    ));
    if (this.#stopped.has(claimId)) return { state: 'stopped', claimId };
    if (this.#terminal.has(claimId)) return { state: 'duplicate', claimId };
    const requestValidation = this.#contractValidator.validateApprovalRequest(bundle.request);
    if (!requestValidation || requestValidation.ok !== true || !isDeepStrictEqual(requestValidation.value, claim.approvalRequest)) {
      throw new NodeAgentError('approval_request_mismatch', 'Relay approval request does not match the pending claim');
    }
    const validation = this.#contractValidator.validateApprovalDecision(bundle.decision);
    if (!validation || validation.ok !== true) throw new NodeAgentError('invalid_approval', 'Approval decision failed the shared contract validator');
    const decision = validation.value;
    if (
      decision.requestId !== localRequest.requestId ||
      decision.tenantId !== this.tenantId ||
      !/^(?:human|account):/.test(decision.deciderActorRef)
    ) {
      throw new NodeAgentError('approval_not_authorized', 'Approval consumption requires a matching decision from an authenticated human or account actor');
    }
    const rejectionReason = approvalRejectionReason(decision.decision);
    const known = this.#requireKnownClaim(claimId);
    const decisionRecord = {
      claimId,
      deliveryId: known.deliveryId,
      workOrderId: known.workOrderId,
      envelopeHash: known.envelopeHash,
      requestId: localRequest.requestId,
      approvalRequestHash: digest(requestValidation.value),
      approvalDecisionHash: digest(validation.value),
    };
    if (rejectionReason) {
      try {
        this.#record({ type: 'approval_decision_consumed', ...decisionRecord });
        this.#recordTerminal(claimId, 'rejected', undefined, rejectionReason);
      } catch (error) {
        this.#pending.delete(claimId);
        this.#recoveryRequired.add(claimId);
        throw error;
      }
      this.#pending.delete(claimId);
      this.#terminal.add(claimId);
      await this.#transport.reportClaimStatus({ claimId, state: 'rejected', reasonCode: rejectionReason }, this.#context());
      return { state: 'rejected', claimId, reasonCode: rejectionReason };
    }
    if (decision.decision !== 'approved') {
      throw new NodeAgentError('approval_not_authorized', 'Approval decision has an unsupported disposition');
    }
    if (!decision.grantedScope?.capabilities.includes('task.execute')) {
      throw new NodeAgentError('approval_scope_denied', 'Approval scope does not grant task.execute');
    }
    if (!Number.isFinite(Date.parse(decision.grantedScope.expiresAt)) || Date.parse(decision.grantedScope.expiresAt) <= this.#clock().getTime()) {
      throw new NodeAgentError('approval_expired', 'Approval scope has expired');
    }
    try {
      this.#record({ type: 'approval_decision_consumed', ...decisionRecord });
      this.#record({ type: 'executing', ...decisionRecord });
    } catch (error) {
      this.#pending.delete(claimId);
      this.#recoveryRequired.add(claimId);
      throw error;
    }
    this.#pending.delete(claimId);
    const execution = {
      requestId: localRequest.requestId,
      expiresAt: decision.grantedScope.expiresAt,
      controller: new AbortController(),
    };
    this.#executing.set(claimId, execution);
    let receiptHash;
    try {
      const checkpoint = () => this.#checkpointAuthorization(claimId, execution);
      await checkpoint();
      const outcome = await this.#executor.execute({
        envelope: claim.envelope,
        approvalRequest: requestValidation.value,
        approval: validation.value,
        authorization: { signal: execution.controller.signal, checkpoint },
      });
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
      for (const event of validatedEvents) {
        assertExecutionScope(readValidatedRunEventBinding(event), this.tenantId, this.nodeId, claim.binding.workOrderId);
      }
      const receiptBinding = readValidatedOutcomeReceiptBinding(receiptValidation.value);
      assertExecutionScope(receiptBinding, this.tenantId, this.nodeId, claim.binding.workOrderId);
      assertNoForeignTenantIds(receiptValidation.value, this.tenantId);
      receiptHash = digest(receiptValidation.value);
      await checkpoint();
      for (const event of validatedEvents) {
        await checkpoint();
        await this.#transport.submitRunEvent(event, this.#context());
      }
      await checkpoint();
      await this.#transport.submitReceipt(receiptValidation.value, this.#context());
    } catch (error) {
      const reasonCode = safeErrorCode(error);
      const terminalState = reasonCode === 'relay_stop' ? 'stopped' :
        (reasonCode === 'approval_revoked' || reasonCode === 'approval_expired') ? 'rejected' : 'failed';
      try {
        this.#recordTerminal(claimId, terminalState, undefined, reasonCode);
      } catch (journalError) {
        this.#recoveryRequired.add(claimId);
        throw journalError;
      } finally {
        this.#executing.delete(claimId);
      }
      this.#terminal.add(claimId);
      if (terminalState === 'stopped') this.#stopped.add(claimId);
      await this.#transport.reportClaimStatus({ claimId, state: terminalState, reasonCode }, this.#context());
      throw error;
    }
    try {
      await this.#checkpointAuthorization(claimId, execution);
      this.#recordTerminal(claimId, 'completed', receiptHash, undefined);
    } catch (error) {
      const reasonCode = safeErrorCode(error);
      if (reasonCode === 'relay_stop' || reasonCode === 'approval_revoked' || reasonCode === 'approval_expired') {
        const terminalState = reasonCode === 'relay_stop' ? 'stopped' : 'rejected';
        this.#recordTerminal(claimId, terminalState, undefined, reasonCode);
        this.#terminal.add(claimId);
        if (terminalState === 'stopped') this.#stopped.add(claimId);
        await this.#transport.reportClaimStatus({ claimId, state: terminalState, reasonCode }, this.#context());
      } else {
        this.#recoveryRequired.add(claimId);
      }
      throw error;
    } finally {
      this.#executing.delete(claimId);
    }
    this.#terminal.add(claimId);
    await this.#transport.reportClaimStatus({ claimId, state: 'completed' }, this.#context());
    return { state: 'completed', claimId };
  }

  /**
   * Apply a Relay stop notification. An executing claim is aborted and becomes
   * terminal at its next authorization checkpoint.
   * @param {string} claimId
   */
  stopClaim(claimId) {
    const id = requireNonEmptyString(claimId, 'invalid_claim', 'claimId');
    const resolution = this.#resolutionResult(id);
    if (resolution) return resolution;
    if (this.#recoveryRequired.has(id)) return { state: 'recovery_required', claimId: id };
    if (this.#terminal.has(id)) return this.#stopped.has(id) ? { state: 'stopped', claimId: id } : { state: 'duplicate', claimId: id };
    const execution = this.#executing.get(id);
    if (execution) {
      this.#cancelExecution(execution, 'relay_stop');
      return { state: 'stopping', claimId: id };
    }
    if (this.#knownClaims.has(id)) {
      try {
        this.#recordTerminal(id, 'stopped', undefined, 'relay_stop');
      } catch (error) {
        this.#pending.delete(id);
        this.#recoveryRequired.add(id);
        throw error;
      }
    }
    this.#pending.delete(id);
    this.#stopped.add(id);
    this.#terminal.add(id);
    return { state: 'stopped', claimId: id };
  }

  /** Apply an SSE revocation hint; the next checkpoint still confirms it with Relay. */
  revokeClaim(claimId, requestId) {
    const id = requireNonEmptyString(claimId, 'invalid_claim', 'claimId');
    const approvalId = requireNonEmptyString(requestId, 'invalid_approval_request', 'requestId');
    const execution = this.#executing.get(id);
    if (!execution || execution.requestId !== approvalId) {
      return { state: this.#terminal.has(id) ? 'duplicate' : 'not_executing', claimId: id };
    }
    execution.revokeHint = true;
    return { state: 'revoking', claimId: id, requestId: approvalId };
  }

  /**
   * Return only journal IDs/hashes required for an operator to adjudicate an
   * in-doubt attempt. Raw task, approval, receipt, and grant values stay out.
   * @param {string} claimId
   */
  inspectRecovery(claimId) {
    const id = requireNonEmptyString(claimId, 'invalid_recovery_decision', 'claimId');
    const known = this.#knownClaims.get(id);
    if (!known) throw new NodeAgentError('recovery_not_found', 'Recovery claim was not found in the execution journal');
    return recoveryInspection(known, this.#recoveryRequired.has(id));
  }

  /** @param {string} claimId @param {unknown} decision */
  abandonRecovery(claimId, decision) {
    const id = requireNonEmptyString(claimId, 'invalid_recovery_decision', 'claimId');
    const operator = parseRecoveryDecision(decision);
    const known = this.#requireRecoveryClaim(id);
    const record = {
      type: 'recovery_abandoned',
      ...recoveryIdentity(known),
      resolutionId: this.#newIdentifier('recovery'),
      operatorActorRef: operator.operatorActorRef,
      reasonCode: operator.reasonCode,
    };
    this.#record(record);
    this.#finishRecovery(id);
    return this.#resolutionResult(id);
  }

  /**
   * Close the old attempt and mint a retry plan. This method never calls the
   * Relay or executor. An operator must separately block the old Relay task,
   * submit a new TaskEnvelope with the returned idempotency key, and obtain a
   * fresh approval for that new claim.
   * @param {string} claimId
   * @param {unknown} decision
   */
  authorizeRecoveryRetry(claimId, decision) {
    const id = requireNonEmptyString(claimId, 'invalid_recovery_decision', 'claimId');
    const operator = parseRecoveryDecision(decision);
    const known = this.#requireRecoveryClaim(id);
    const record = {
      type: 'recovery_retry_authorized',
      ...recoveryIdentity(known),
      resolutionId: this.#newIdentifier('recovery'),
      operatorActorRef: operator.operatorActorRef,
      reasonCode: operator.reasonCode,
      retryAttemptId: this.#newIdentifier('attempt'),
      retryIdempotencyKey: this.#newIdentifier('retry'),
    };
    this.#record(record);
    this.#finishRecovery(id);
    return this.#resolutionResult(id);
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

  /** @param {string} claimId @param {{requestId: string, expiresAt: string, controller: AbortController, cancelReason?: string, revokeHint?: boolean}} execution */
  async #checkpointAuthorization(claimId, execution) {
    this.#throwIfCancelled(execution);
    if (Date.parse(execution.expiresAt) <= this.#clock().getTime()) {
      this.#cancelExecution(execution, 'approval_expired');
      this.#throwIfCancelled(execution);
    }
    const authorization = parseApprovalAuthorization(await this.#transport.getApprovalAuthorization(
      claimId,
      execution.requestId,
      this.#context(),
    ));
    if (authorization.taskId !== claimId || authorization.requestId !== execution.requestId || authorization.nodeId !== this.nodeId) {
      throw new NodeAgentError('approval_not_authorized', 'Relay authorization is not bound to this execution');
    }
    if (authorization.state === 'revoked') this.#cancelExecution(execution, 'approval_revoked');
    if (authorization.state === 'expired' || Date.parse(authorization.expiresAt) <= this.#clock().getTime()) {
      this.#cancelExecution(execution, 'approval_expired');
    }
    this.#throwIfCancelled(execution);
  }

  /** @param {{controller: AbortController, cancelReason?: string}} execution @param {string} reason */
  #cancelExecution(execution, reason) {
    if (execution.cancelReason) return;
    execution.cancelReason = reason;
    execution.controller.abort(new NodeAgentError(reason, authorizationFailureMessage(reason)));
  }

  /** @param {{controller: AbortController, cancelReason?: string}} execution */
  #throwIfCancelled(execution) {
    if (!execution.controller.signal.aborted) return;
    const reason = execution.controller.signal.reason;
    if (reason instanceof NodeAgentError) throw reason;
    const code = execution.cancelReason ?? 'relay_stop';
    throw new NodeAgentError(code, authorizationFailureMessage(code));
  }

  /** @param {Record<string, unknown>} record */
  #record(record) {
    let claim;
    try {
      claim = this.#journal.append(record);
    } catch (error) {
      if (error instanceof NodeAgentError) throw error;
      throw new NodeAgentError('journal_write_failed', `Execution journal append failed: ${safeErrorCode(error)}`);
    }
    if (claim && typeof claim.claimId === 'string') this.#knownClaims.set(claim.claimId, claim);
  }

  /** @param {string} claimId */
  #requireRecoveryClaim(claimId) {
    if (this.#recoveryResolutions.has(claimId)) {
      throw new NodeAgentError('recovery_already_resolved', 'Recovery claim already has an immutable operator resolution');
    }
    if (!this.#recoveryRequired.has(claimId)) {
      if (this.#knownClaims.has(claimId)) throw new NodeAgentError('recovery_not_required', 'Claim does not require operator recovery');
      throw new NodeAgentError('recovery_not_found', 'Recovery claim was not found in the execution journal');
    }
    return this.#requireKnownClaim(claimId);
  }

  /** @param {string} claimId */
  #finishRecovery(claimId) {
    const known = this.#requireKnownClaim(claimId);
    this.#recoveryRequired.delete(claimId);
    this.#pending.delete(claimId);
    this.#terminal.add(claimId);
    this.#recoveryResolutions.set(claimId, known);
  }

  /** @param {string} claimId */
  #resolutionResult(claimId) {
    const resolution = this.#recoveryResolutions.get(claimId);
    return resolution ? recoveryResolutionResult(resolution) : undefined;
  }

  /** @param {string} prefix */
  #newIdentifier(prefix) {
    const suffix = requireNonEmptyString(this.#idFactory(), 'invalid_recovery_identifier', 'generated recovery identifier');
    if (suffix.length > 96 || !/^[A-Za-z0-9._-]+$/.test(suffix)) {
      throw new NodeAgentError('invalid_recovery_identifier', 'Generated recovery identifier contains unsafe characters');
    }
    const identifier = `${prefix}-${suffix}`;
    if (this.#issuedRecoveryIdentifiers.has(identifier)) {
      throw new NodeAgentError('recovery_identifier_collision', 'Generated recovery identifier was already used');
    }
    this.#issuedRecoveryIdentifiers.add(identifier);
    return identifier;
  }

  /** @param {string} claimId */
  #requireKnownClaim(claimId) {
    const known = this.#knownClaims.get(claimId);
    if (!known) throw new NodeAgentError('journal_corrupt', 'Pending claim is missing from the execution journal');
    return known;
  }

  /** @param {string} claimId @param {'completed'|'failed'|'stopped'|'rejected'} terminalState @param {string|undefined} receiptHash @param {string|undefined} reasonCode */
  #recordTerminal(claimId, terminalState, receiptHash, reasonCode) {
    const known = this.#requireKnownClaim(claimId);
    const record = {
      type: 'terminal',
      claimId,
      deliveryId: known.deliveryId,
      workOrderId: known.workOrderId,
      terminalState,
      ...(receiptHash === undefined ? {} : { receiptHash }),
      ...(reasonCode === undefined ? {} : { reasonCode }),
    };
    this.#record(record);
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

/** @param {unknown} decision */
function approvalRejectionReason(decision) {
  if (decision === 'denied') return 'approval_denied';
  if (decision === 'expired') return 'approval_expired';
  if (decision === 'revoked') return 'approval_revoked';
  return undefined;
}

/** @param {unknown} value */
function parseApprovalAuthorization(value) {
  const authorization = assertExactRecord(
    value,
    ['state', 'requestId', 'taskId', 'nodeId', 'expiresAt', 'revokedAt'],
    'invalid_relay_response',
    'approval authorization',
  );
  const state = requireNonEmptyString(authorization.state, 'invalid_relay_response', 'authorization state');
  if (!['approved', 'revoked', 'expired'].includes(state)) {
    throw new NodeAgentError('invalid_relay_response', 'Relay returned an unsupported authorization state');
  }
  const parsed = {
    state,
    requestId: requireNonEmptyString(authorization.requestId, 'invalid_relay_response', 'authorization requestId'),
    taskId: requireNonEmptyString(authorization.taskId, 'invalid_relay_response', 'authorization taskId'),
    nodeId: requireNonEmptyString(authorization.nodeId, 'invalid_relay_response', 'authorization nodeId'),
    expiresAt: requireIsoDate(authorization.expiresAt, 'invalid_relay_response', 'authorization expiresAt'),
  };
  if (state === 'revoked') {
    return {
      ...parsed,
      revokedAt: requireIsoDate(authorization.revokedAt, 'invalid_relay_response', 'authorization revokedAt'),
    };
  }
  if (authorization.revokedAt !== undefined) {
    throw new NodeAgentError('invalid_relay_response', 'Only revoked authorization may include revokedAt');
  }
  return parsed;
}

/** @param {string} reason */
function authorizationFailureMessage(reason) {
  if (reason === 'approval_revoked') return 'Approval authorization was revoked';
  if (reason === 'approval_expired') return 'Approval authorization expired';
  return 'Relay stopped the executing claim';
}

/** @param {unknown} value */
function parseRecoveryDecision(value) {
  const decision = assertExactRecord(value, ['operatorActorRef', 'reasonCode'], 'invalid_recovery_decision', 'recovery decision');
  const operatorActorRef = requireNonEmptyString(decision.operatorActorRef, 'invalid_recovery_decision', 'operatorActorRef');
  if (!/^(?:human|account):[A-Za-z0-9_-]+$/.test(operatorActorRef)) {
    throw new NodeAgentError('recovery_operator_forbidden', 'Recovery decisions require a human or account operator');
  }
  const reasonCode = requireNonEmptyString(decision.reasonCode, 'invalid_recovery_decision', 'reasonCode');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(reasonCode)) {
    throw new NodeAgentError('invalid_recovery_decision', 'reasonCode must be a safe machine-readable code');
  }
  return { operatorActorRef, reasonCode };
}

/** @param {Record<string, unknown>} known */
function recoveryIdentity(known) {
  return {
    claimId: requireNonEmptyString(known.claimId, 'journal_corrupt', 'journal claimId'),
    deliveryId: requireNonEmptyString(known.deliveryId, 'journal_corrupt', 'journal deliveryId'),
    workOrderId: requireNonEmptyString(known.workOrderId, 'journal_corrupt', 'journal workOrderId'),
    envelopeHash: requireJournalHash(known.envelopeHash, 'envelopeHash'),
  };
}

/** @param {unknown} value @param {string} label */
function requireJournalHash(value, label) {
  const hash = requireNonEmptyString(value, 'journal_corrupt', label);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new NodeAgentError('journal_corrupt', `${label} must be a SHA-256 digest`);
  return hash;
}

/** @param {Record<string, unknown>} known @param {boolean} requiresDecision */
function recoveryInspection(known, requiresDecision) {
  const inspection = {
    claimId: requireNonEmptyString(known.claimId, 'journal_corrupt', 'journal claimId'),
    deliveryId: requireNonEmptyString(known.deliveryId, 'journal_corrupt', 'journal deliveryId'),
    workOrderId: requireNonEmptyString(known.workOrderId, 'journal_corrupt', 'journal workOrderId'),
    journalStage: requireNonEmptyString(known.state, 'journal_corrupt', 'journal state'),
    envelopeHash: requireJournalHash(known.envelopeHash, 'envelopeHash'),
    requiresDecision,
  };
  const resolution = recoveryResolutionResult(known);
  return resolution ? { ...inspection, resolution } : inspection;
}

/** @param {Record<string, unknown>} resolution */
function recoveryResolutionResult(resolution) {
  if (resolution.state === 'recovery_abandoned') {
    return {
      state: 'abandoned',
      claimId: String(resolution.claimId),
      resolutionId: String(resolution.resolutionId),
      operatorActorRef: String(resolution.operatorActorRef),
      reasonCode: String(resolution.reasonCode),
    };
  }
  if (resolution.state === 'recovery_retry_authorized') {
    return {
      state: 'retry_authorized',
      claimId: String(resolution.claimId),
      resolutionId: String(resolution.resolutionId),
      operatorActorRef: String(resolution.operatorActorRef),
      reasonCode: String(resolution.reasonCode),
      retry: {
        attemptId: String(resolution.retryAttemptId),
        idempotencyKey: String(resolution.retryIdempotencyKey),
        retryOfClaimId: String(resolution.claimId),
        workOrderId: String(resolution.workOrderId),
      },
    };
  }
  return undefined;
}

/**
 * Node-agent configuration is single-tenant. Multi-tenant manifests require a
 * future explicit authorization model and are rejected here even if they pass
 * the shared wire schema.
 * @param {unknown} value
 */
function readValidatedNodeManifestBinding(value) {
  if (!isRecord(value)) throw new NodeAgentError('invalid_node_manifest', 'Validated node manifest must be an object');
  if (!Array.isArray(value.tenantIds)
    || value.tenantIds.length === 0
    || value.tenantIds.some((tenantId) => typeof tenantId !== 'string' || tenantId.trim() === '')) {
    throw new NodeAgentError('invalid_node_manifest', 'Validated node manifest has an invalid tenant binding');
  }
  return {
    nodeId: requireNonEmptyString(value.nodeId, 'invalid_node_manifest', 'NodeManifest nodeId'),
    tenantIds: /** @type {string[]} */ ([...value.tenantIds]),
  };
}

/** @param {unknown} value */
function readValidatedRunEventBinding(value) {
  if (!isRecord(value)) throw new NodeAgentError('invalid_run_event', 'Validated run event must be an object');
  return {
    tenantId: requireNonEmptyString(value.tenantId, 'invalid_run_event', 'RunEvent tenantId'),
    nodeId: requireNonEmptyString(value.nodeId, 'invalid_run_event', 'RunEvent nodeId'),
    workOrderId: requireNonEmptyString(value.workOrderId, 'invalid_run_event', 'RunEvent workOrderId'),
  };
}

/**
 * Accept either the verifiable v1 wrapper (`receipt`) or the validated receipt
 * body itself. The injected verifier remains the schema/integrity authority;
 * this helper enforces only the active execution binding.
 * @param {unknown} value
 */
function readValidatedOutcomeReceiptBinding(value) {
  if (!isRecord(value)) throw new NodeAgentError('invalid_outcome_receipt', 'Validated outcome receipt must be an object');
  const body = isRecord(value.receipt) ? value.receipt : value;
  if (!isRecord(body.outcome)) {
    throw new NodeAgentError('invalid_outcome_receipt', 'Validated outcome receipt is missing its execution binding');
  }
  return {
    tenantId: requireNonEmptyString(body.tenantId, 'invalid_outcome_receipt', 'OutcomeReceipt tenantId'),
    workOrderId: requireNonEmptyString(body.outcome.workOrderId, 'invalid_outcome_receipt', 'OutcomeReceipt workOrderId'),
  };
}

/**
 * @param {{tenantId: string, nodeId?: string, workOrderId: string}} actual
 * @param {string} tenantId
 * @param {string} nodeId
 * @param {string} workOrderId
 */
function assertExecutionScope(actual, tenantId, nodeId, workOrderId) {
  if (actual.tenantId !== tenantId
    || actual.workOrderId !== workOrderId
    || (actual.nodeId !== undefined && actual.nodeId !== nodeId)) {
    throw new NodeAgentError('execution_scope_mismatch', 'Executor output is not bound to the active task');
  }
}

/**
 * Valid receipts may contain many tenant-scoped facts. A structurally valid
 * receipt that embeds any foreign tenant fact must still fail before output.
 * @param {unknown} value
 * @param {string} tenantId
 */
function assertNoForeignTenantIds(value, tenantId) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForeignTenantIds(item, tenantId);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'tenantId' && item !== tenantId) {
      throw new NodeAgentError('execution_scope_mismatch', 'Executor output is not bound to the active task');
    }
    assertNoForeignTenantIds(item, tenantId);
  }
}

/**
 * TaskEnvelope was already accepted by the injected shared validator. This
 * helper reads only the three routing/expiry bindings the node must enforce;
 * it is not a second contract schema.
 * @param {unknown} value
 */
function readValidatedEnvelopeBinding(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NodeAgentError('invalid_task_envelope', 'Validated task envelope must be an object');
  }
  const envelope = /** @type {Record<string, unknown>} */ (value);
  return {
    tenantId: requireNonEmptyString(envelope.tenantId, 'invalid_task_envelope', 'TaskEnvelope tenantId'),
    targetNodeId: requireNonEmptyString(envelope.targetNodeId, 'invalid_task_envelope', 'TaskEnvelope targetNodeId'),
    expiresAt: requireIsoDate(envelope.expiresAt, 'invalid_task_envelope', 'TaskEnvelope expiresAt'),
    workOrderId: requireNonEmptyString(envelope.originRef, 'invalid_task_envelope', 'TaskEnvelope originRef'),
  };
}

/** @param {unknown} value */
function readValidatedApprovalRequest(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NodeAgentError('invalid_approval_request', 'Validated ApprovalRequest must be an object');
  }
  const request = /** @type {Record<string, unknown>} */ (value);
  const scope = request.requestedScope;
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
    throw new NodeAgentError('invalid_approval_request', 'ApprovalRequest requestedScope must be an object');
  }
  const capabilities = /** @type {Record<string, unknown>} */ (scope).capabilities;
  if (!Array.isArray(capabilities) || capabilities.some((capability) => typeof capability !== 'string')) {
    throw new NodeAgentError('invalid_approval_request', 'ApprovalRequest capabilities must be strings');
  }
  return {
    requestId: requireNonEmptyString(request.requestId, 'invalid_approval_request', 'ApprovalRequest requestId'),
    tenantId: requireNonEmptyString(request.tenantId, 'invalid_approval_request', 'ApprovalRequest tenantId'),
    workOrderId: requireNonEmptyString(request.workOrderId, 'invalid_approval_request', 'ApprovalRequest workOrderId'),
    nodeId: requireNonEmptyString(request.nodeId, 'invalid_approval_request', 'ApprovalRequest nodeId'),
    runId: requireNonEmptyString(request.runId, 'invalid_approval_request', 'ApprovalRequest runId'),
    target: requireNonEmptyString(request.target, 'invalid_approval_request', 'ApprovalRequest target'),
    expiresAt: requireIsoDate(request.expiresAt, 'invalid_approval_request', 'ApprovalRequest expiresAt'),
    requestedScope: { capabilities: /** @type {string[]} */ (capabilities) },
  };
}

/** @param {unknown} value */
function parseApprovalBundle(value) {
  const bundle = assertExactRecord(value, ['request', 'decision'], 'invalid_relay_response', 'approval bundle');
  if (!Object.hasOwn(bundle, 'request') || !Object.hasOwn(bundle, 'decision')) {
    throw new NodeAgentError('invalid_relay_response', 'Relay approval bundle requires request and decision');
  }
  return { request: bundle.request, decision: bundle.decision };
}

/** @param {unknown} value */
function digest(value) {
  return sha256Hex(canonicalJson(value));
}

/** @param {Record<string, unknown>} known @param {{claimId: string, deliveryId: string}} claim @param {ReturnType<typeof readValidatedEnvelopeBinding>} envelope @param {string} envelopeHash */
function assertKnownClaim(known, claim, envelope, envelopeHash) {
  if (
    known.claimId !== claim.claimId ||
    known.deliveryId !== claim.deliveryId ||
    known.workOrderId !== envelope.workOrderId ||
    known.envelopeHash !== envelopeHash
  ) {
    throw new NodeAgentError('journal_claim_mismatch', 'Duplicate claim does not match the durable journal binding');
  }
}

/** @param {ExecutionJournal} journal @param {{tenantId: string, nodeId: string}} scope */
function initializeJournal(journal, scope) {
  let snapshot;
  try {
    snapshot = journal.initialize(scope);
  } catch (error) {
    if (error instanceof NodeAgentError) throw error;
    throw new NodeAgentError('journal_initialization_failed', `Execution journal initialization failed: ${safeErrorCode(error)}`);
  }
  if (!snapshot || !Array.isArray(snapshot.claims) || snapshot.claims.some((claim) => typeof claim !== 'object' || claim === null || Array.isArray(claim))) {
    throw new NodeAgentError('journal_corrupt', 'Execution journal returned an invalid recovery snapshot');
  }
  return /** @type {{claims: Array<Record<string, unknown>>}} */ (snapshot);
}

/** @param {FleetTransport} transport @param {FleetContractValidator} validator @param {NodeTaskExecutor} executor @param {ExecutionJournal} journal */
function validatePorts(transport, validator, executor, journal) {
  if (typeof transport?.sendHeartbeat !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing sendHeartbeat');
  if (typeof transport?.claimTask !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing claimTask');
  if (typeof transport?.reportClaimStatus !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing reportClaimStatus');
  if (typeof transport?.submitRunEvent !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing submitRunEvent');
  if (typeof transport?.submitReceipt !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing submitReceipt');
  if (typeof transport?.submitApprovalRequest !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing submitApprovalRequest');
  if (typeof transport?.consumeApprovalDecision !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing consumeApprovalDecision');
  if (typeof transport?.getApprovalAuthorization !== 'function') throw new NodeAgentError('invalid_agent_config', 'Fleet transport is missing getApprovalAuthorization');
  if (typeof validator?.validateNodeManifest !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateNodeManifest');
  if (typeof validator?.validateTaskEnvelope !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateTaskEnvelope');
  if (typeof validator?.validateApprovalRequest !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateApprovalRequest');
  if (typeof validator?.validateApprovalDecision !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateApprovalDecision');
  if (typeof validator?.validateRunEvent !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateRunEvent');
  if (typeof validator?.validateOutcomeReceipt !== 'function') throw new NodeAgentError('invalid_agent_config', 'Contract validator is missing validateOutcomeReceipt');
  if (typeof executor?.execute !== 'function') throw new NodeAgentError('invalid_agent_config', 'Executor is missing execute');
  if (typeof journal?.initialize !== 'function') throw new NodeAgentError('invalid_agent_config', 'Execution journal is missing initialize');
  if (typeof journal?.append !== 'function') throw new NodeAgentError('invalid_agent_config', 'Execution journal is missing append');
}
