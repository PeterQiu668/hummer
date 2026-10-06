import { NodeAgentError } from './errors.mjs';
import { assertExactRecord, isRecord } from './validation.mjs';

/** @typedef {'fs_read'|'doc_extract'|'workspace_exec'} ToolName */
/** @type {ReadonlyArray<{name: ToolName, capabilityId: string, risk: 'low'|'high', description: string}>} */
const DEFINITIONS = Object.freeze([
  { name: 'fs_read', capabilityId: 'fs.read', risk: 'low', description: 'Read a policy-confined workspace file through the trusted local handler.' },
  { name: 'doc_extract', capabilityId: 'doc.extract', risk: 'low', description: 'Extract text through the trusted local document handler.' },
  { name: 'workspace_exec', capabilityId: 'workspace.exec', risk: 'high', description: 'Request HUMMER-owned isolated execution after explicit approval.' },
]);
const DEFINITION_BY_NAME = new Map(DEFINITIONS.map((definition) => [definition.name, definition]));

/** @typedef {(args: Record<string, unknown>) => Promise<unknown>} ToolHandler */

/**
 * This facade performs naming and authorization only. Host filesystem, document,
 * and sandbox behavior remains in injected trusted handlers.
 * @param {Partial<Record<'fs_read'|'doc_extract'|'workspace_exec', ToolHandler>>} handlers
 */
export function createMcpToolFacade(handlers) {
  assertExactRecord(handlers, ['fs_read', 'doc_extract', 'workspace_exec'], 'invalid_tool_handlers', 'MCP handlers');
  return {
    listTools() {
      return DEFINITIONS.map((definition) => ({ ...definition }));
    },
    /**
     * @param {unknown} input
     * @param {{scopes: string[], approvalConfirmed: boolean}} authorization
     */
    async invoke(input, authorization) {
      const request = assertExactRecord(input, ['name', 'arguments'], 'invalid_tool_request', 'MCP tool request');
      const definition = DEFINITION_BY_NAME.get(/** @type {ToolName} */ (String(request.name)));
      if (!definition) throw new NodeAgentError('unknown_tool', `Unknown HUMMER local tool: ${String(request.name)}`);
      const auth = assertExactRecord(authorization, ['scopes', 'approvalConfirmed'], 'invalid_tool_authorization', 'MCP authorization');
      if (!Array.isArray(auth.scopes) || auth.scopes.some((scope) => typeof scope !== 'string')) {
        throw new NodeAgentError('invalid_tool_authorization', 'MCP authorization scopes must be strings');
      }
      if (!auth.scopes.includes(definition.capabilityId)) {
        throw new NodeAgentError('scope_denied', `Grant does not include ${definition.capabilityId}`);
      }
      if (definition.name === 'workspace_exec' && auth.approvalConfirmed !== true) {
        throw new NodeAgentError('approval_required', 'workspace.exec requires an explicit confirmed approval');
      }
      if (!isRecord(request.arguments)) throw new NodeAgentError('invalid_tool_request', 'MCP tool arguments must be an object');
      const handler = handlers[definition.name];
      if (typeof handler !== 'function') throw new NodeAgentError('tool_unavailable', `${definition.name} has no trusted local handler`);
      return handler(request.arguments);
    },
  };
}
