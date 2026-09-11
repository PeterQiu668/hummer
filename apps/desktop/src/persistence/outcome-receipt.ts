import { redactRuntimeSecrets } from '../engine-profiles.js';
import { canonicalJson } from './canonical-json.js';
import type { ApprovalEvidence } from './approval-policy-store.js';
import type { CostLedgerRecord, OutcomeDefinitionRecord, OutcomeEventRecord } from './outcome-ledger-store.js';
import type { IntegrityResult } from './domain-event-store.js';
import type { ToolInvocationRecord } from './tool-registry-store.js';

export interface OutcomeReceipt {
  generatedAt: string;
  tenantId: string;
  outcome: OutcomeEventRecord;
  definition: OutcomeDefinitionRecord;
  costs: CostLedgerRecord[];
  tools: ToolInvocationRecord[];
  totalCostCny: number;
  approval: ApprovalEvidence | null;
  chainIntegrity: IntegrityResult;
  /** Canonical JSON of the fields above, with any runtime engine secret found in `environment` redacted. */
  receiptJson: string;
}

export interface AssembleOutcomeReceiptInput {
  tenantId: string;
  outcome: OutcomeEventRecord;
  definition: OutcomeDefinitionRecord;
  costs: CostLedgerRecord[];
  tools: ToolInvocationRecord[];
  approval: ApprovalEvidence | null;
  chainIntegrity: IntegrityResult;
  generatedAt: string;
  environment: NodeJS.ProcessEnv;
}

/**
 * Assembles a verifiable receipt for one outcome: what was done, who accepted or rejected it, what
 * it cost, which approval governed it, and whether the surrounding hash chain is intact. This is
 * the artifact a customer or an insurer would need to trust a billed or claimed outcome. It is
 * read-only over already-persisted facts; it does not create new domain events.
 *
 * Every receipt is passed through redactRuntimeSecrets before being returned, so accidentally
 * including a raw provider key anywhere in the assembled JSON can never leave this function.
 */
export function assembleOutcomeReceipt(input: AssembleOutcomeReceiptInput): OutcomeReceipt {
  const totalCostCny = input.costs.reduce((sum, entry) => sum + entry.costCny, 0);
  const body = {
    generatedAt: input.generatedAt,
    tenantId: input.tenantId,
    outcome: input.outcome,
    definition: input.definition,
    costs: input.costs,
    tools: input.tools,
    totalCostCny,
    approval: input.approval,
    chainIntegrity: input.chainIntegrity,
  };
  const receiptJson = redactRuntimeSecrets(canonicalJson(body), input.environment);
  return { ...body, receiptJson };
}
