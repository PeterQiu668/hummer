import { validateFleetContract } from '@hummer/contracts';

/**
 * Bind the node to the frozen D1 validators while keeping the v1 outcome
 * receipt verifier injectable. OutcomeReceipt is intentionally not redefined
 * as a sixth fleet schema.
 *
 * @param {{validateOutcomeReceipt(value: unknown): {ok: true, value: unknown}|{ok: false, errors: string[]}}} receiptValidator
 */
export function createSharedFleetContractValidator(receiptValidator) {
  if (typeof receiptValidator?.validateOutcomeReceipt !== 'function') {
    throw new TypeError('A v1 outcome receipt validator is required');
  }
  return {
    /** @param {unknown} value */
    validateNodeManifest(value) { return adapt('NodeManifest', value); },
    /** @param {unknown} value */
    validateTaskEnvelope(value) { return adapt('TaskEnvelope', value); },
    /** @param {unknown} value */
    validateApprovalDecision(value) { return adapt('ApprovalDecision', value); },
    /** @param {unknown} value */
    validateRunEvent(value) { return adapt('RunEvent', value); },
    /** @param {unknown} value */
    validateOutcomeReceipt(value) { return receiptValidator.validateOutcomeReceipt(value); },
  };
}

/** @param {'NodeManifest'|'TaskEnvelope'|'ApprovalDecision'|'RunEvent'} name @param {unknown} value */
function adapt(name, value) {
  const result = validateFleetContract(name, value);
  if (result.issues) {
    return { ok: false, errors: result.issues.map((issue) => issue.message) };
  }
  return { ok: true, value: result.value };
}
