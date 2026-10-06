export class NodeAgentError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'NodeAgentError';
    this.code = code;
  }
}
