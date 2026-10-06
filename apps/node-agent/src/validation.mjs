import { NodeAgentError } from './errors.mjs';

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @param {string} code
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
export function assertExactRecord(value, allowed, code, label) {
  if (!isRecord(value)) throw new NodeAgentError(code, `${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new NodeAgentError(code, `${label} contains unknown fields: ${unknown.join(', ')}`);
  return value;
}

/** @param {unknown} value @param {string} code @param {string} label */
export function requireNonEmptyString(value, code, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new NodeAgentError(code, `${label} must be a non-empty string`);
  return value;
}

/** @param {unknown} value @param {string} code @param {string} label */
export function requireIsoDate(value, code, label) {
  const text = requireNonEmptyString(value, code, label);
  if (!Number.isFinite(Date.parse(text))) throw new NodeAgentError(code, `${label} must be an ISO 8601 timestamp`);
  return text;
}
