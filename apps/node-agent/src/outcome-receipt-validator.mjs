import { verifySuccessfulOutcomeReceipt } from '@hummer/outcome-receipts';

export const portableOutcomeReceiptValidator = Object.freeze({
  /** @param {unknown} value @returns {{ok: true, value: unknown}|{ok: false, errors: string[]}} */
  validateOutcomeReceipt(value) {
    try {
      verifySuccessfulOutcomeReceipt(value);
      return /** @type {const} */ ({ ok: true, value });
    } catch {
      return /** @type {const} */ ({ ok: false, errors: ['outcome receipt verification failed'] });
    }
  },
});
