import type { WorkOrderIntakePayload } from './persistence/work-order-intake-store.js';

/**
 * 结构化派活文件：`*.hummer-task.json`（docs/decisions/ADR-014）。
 *
 * 文件夹接单原先只把文件当附件，标题/指派/期限都是固定值。外部编排方（如 agent-hub）
 * 需要把这些字段带进来，否则每张工单都要人工改写。本模块只负责把文件解析成与表单入口
 * 同形的 WorkOrderIntakePayload；工单依旧落到 pending，仍需人确认才会启动运行时。
 */
export const STRUCTURED_TASK_SUFFIX = '.hummer-task.json';
export const STRUCTURED_TASK_SCHEMA = 'hummer.work-order-task';
export const MAX_STRUCTURED_TASK_BYTES = 64 * 1024;

const ALLOWED_KEYS = new Set([
  'schema', 'version', 'title', 'target', 'expectedDeliverable', 'assignee', 'dueAt', 'attachmentNames', 'prompt', 'origin',
]);
const ORIGIN_KEYS = new Set(['system', 'device', 'agent', 'taskId']);
const LIMITS = { title: 200, target: 4_000, expectedDeliverable: 4_000, assignee: 200, prompt: 16_000, attachment: 260, origin: 200 };
const MAX_ATTACHMENTS = 20;

export type StructuredTaskParseResult =
  | { ok: true; payload: WorkOrderIntakePayload }
  | { ok: false; error: string };

export function isStructuredTaskFile(requestedPath: string): boolean {
  return requestedPath.toLowerCase().endsWith(STRUCTURED_TASK_SUFFIX);
}

export function parseStructuredTaskFile(bytes: Uint8Array): StructuredTaskParseResult {
  if (bytes.byteLength > MAX_STRUCTURED_TASK_BYTES) return fail(`文件超过 ${MAX_STRUCTURED_TASK_BYTES / 1024} KiB 上限`);
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^﻿/, ''));
  } catch {
    return fail('不是有效的 JSON');
  }
  if (!isPlainObject(value)) return fail('顶层必须是 JSON 对象');

  const unknown = Object.keys(value).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length) return fail(`包含未支持的字段：${unknown.join('、')}`);
  if (value.schema !== STRUCTURED_TASK_SCHEMA) return fail(`schema 必须是 ${STRUCTURED_TASK_SCHEMA}`);
  if (value.version !== 1) return fail('version 必须是 1');

  const title = requiredText(value, 'title');
  const target = requiredText(value, 'target');
  const expectedDeliverable = requiredText(value, 'expectedDeliverable');
  if (typeof title !== 'string') return title;
  if (typeof target !== 'string') return target;
  if (typeof expectedDeliverable !== 'string') return expectedDeliverable;

  const assignee = optionalText(value, 'assignee');
  if (typeof assignee === 'object') return assignee;
  const prompt = optionalText(value, 'prompt');
  if (typeof prompt === 'object') return prompt;

  let dueAt: string | null = null;
  if (value.dueAt !== undefined && value.dueAt !== null) {
    if (typeof value.dueAt !== 'string' || Number.isNaN(Date.parse(value.dueAt))) return fail('dueAt 必须是 ISO 8601 时间或 null');
    dueAt = new Date(value.dueAt).toISOString();
  }

  const attachmentNames: string[] = [];
  if (value.attachmentNames !== undefined) {
    if (!Array.isArray(value.attachmentNames)) return fail('attachmentNames 必须是字符串数组');
    if (value.attachmentNames.length > MAX_ATTACHMENTS) return fail(`attachmentNames 最多 ${MAX_ATTACHMENTS} 项`);
    for (const name of value.attachmentNames) {
      if (typeof name !== 'string' || !name.trim()) return fail('attachmentNames 必须是非空字符串');
      if (name.length > LIMITS.attachment) return fail(`附件名超过 ${LIMITS.attachment} 字符`);
      // 附件名只是引用，真正读取仍经过工作区守卫；这里提前拒绝明显的越界写法，让错误早暴露。
      if (/^([a-zA-Z]:|[\\/])/.test(name) || name.split(/[\\/]/).includes('..')) return fail(`附件名必须是工作区内的相对路径：${name}`);
      attachmentNames.push(name.trim());
    }
  }

  let origin: Record<string, string> | undefined;
  if (value.origin !== undefined) {
    if (!isPlainObject(value.origin)) return fail('origin 必须是对象');
    origin = {};
    for (const [key, item] of Object.entries(value.origin)) {
      if (!ORIGIN_KEYS.has(key)) return fail(`origin 包含未支持的字段：${key}`);
      if (typeof item !== 'string' || !item.trim() || item.length > LIMITS.origin) return fail(`origin.${key} 必须是 1-${LIMITS.origin} 字符的字符串`);
      origin[key] = item.trim();
    }
  }

  const payload: WorkOrderIntakePayload = {
    title,
    target,
    expectedDeliverable,
    assignee: assignee ?? '自动推荐',
    dueAt,
    attachmentNames,
    prompt: prompt ?? `${title}。目标：${target}。期望交付：${expectedDeliverable}。附件：${attachmentNames.join('、') || '无'}。`,
    executable: true,
    suggestedCapabilities: [],
    structuredTask: true,
    ...(origin ? { origin } : {}),
  };
  return { ok: true, payload };
}

function requiredText(value: Record<string, unknown>, field: keyof typeof LIMITS): string | { ok: false; error: string } {
  const item = value[field];
  if (typeof item !== 'string' || !item.trim()) return fail(`${field} 必填且不能为空`);
  if (item.length > LIMITS[field]) return fail(`${field} 超过 ${LIMITS[field]} 字符`);
  return item.trim();
}

function optionalText(value: Record<string, unknown>, field: keyof typeof LIMITS): string | undefined | { ok: false; error: string } {
  if (value[field] === undefined || value[field] === null) return undefined;
  return requiredText(value, field);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
