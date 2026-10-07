import {
  verifySuccessfulOutcomeReceipt as verifyPortableOutcomeReceipt,
  type VerifiedSuccessfulOutcomeReceipt,
} from '@hummer/outcome-receipts';
import { FleetRejectedError } from './ports.js';

export type { VerifiedSuccessfulOutcomeReceipt } from '@hummer/outcome-receipts';

/**
 * Relay maps the shared portable verifier's deliberately uniform failure onto
 * its equally uniform trust-boundary error. No receipt details cross tenants.
 */
export function verifySuccessfulOutcomeReceipt(input: unknown): VerifiedSuccessfulOutcomeReceipt {
  try {
    return verifyPortableOutcomeReceipt(input);
  } catch {
    throw new FleetRejectedError('capability_trust_denied', 'outcome receipt or capability source proof is invalid');
  }
}
