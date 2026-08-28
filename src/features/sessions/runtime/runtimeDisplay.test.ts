import { describe, expect, it } from 'vitest';
import { actorDisplayName, runtimeAuditIdentity, runtimeDisplayName } from './runtimeDisplay';

describe('runtime display registry', () => {
  it('hides supplier names in product UI without changing durable identities', () => {
    expect(runtimeDisplayName('codex-cli', 'employee:codex')).toBe('HUMMER 执行内核');
    expect(runtimeDisplayName('mock-runtime-v4', 'employee:gtm-researcher')).toBe('演示执行内核');
    expect('employee:codex').toBe('employee:codex');
    expect(actorDisplayName('employee:codex')).toBe('HUMMER 数字员工');
    expect(actorDisplayName('employee:claude')).toBe('HUMMER 数字员工');
  });

  it('keeps truthful supplier details available to audit views', () => {
    expect(runtimeAuditIdentity({
      runtimeId: 'codex-cli',
      providerName: 'DeepSeek',
      modelName: 'deepseek-v4-flash',
      dataDomain: 'api.deepseek.com',
      sandbox: 'workspace-write',
    })).toEqual({
      runtimeId: 'codex-cli',
      providerName: 'DeepSeek',
      modelName: 'deepseek-v4-flash',
      dataDomain: 'api.deepseek.com',
      sandbox: 'workspace-write',
    });
  });
});
