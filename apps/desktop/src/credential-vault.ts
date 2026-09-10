import type { EngineCredentialStatus, EngineCredentialStore } from './persistence/engine-credential-store.js';

export interface CredentialProtector {
  available(): boolean;
  protect(value: string): Buffer;
  unprotect(value: Buffer): string;
}

export class CredentialVault {
  constructor(private readonly store: EngineCredentialStore, private readonly protector: CredentialProtector) {}

  configure(tenantId: string, engineProfileId: string, envKey: string, plaintext: string): EngineCredentialStatus {
    if (!this.protector.available()) throw new Error('当前 Windows 安全存储不可用，密钥未保存。');
    if (!plaintext.trim()) throw new TypeError('密钥不能为空。');
    const encryptedValue = this.protector.protect(plaintext).toString('base64');
    const stored = this.store.upsert({ tenantId, engineProfileId, envKey, encryptedValue });
    return { engineProfileId: stored.engineProfileId, envKey: stored.envKey, configured: true, updatedAt: stored.updatedAt };
  }

  statuses(tenantId: string): EngineCredentialStatus[] {
    return this.store.listStatus(tenantId);
  }

  resolve(tenantId: string, engineProfileId: string, expectedEnvKey: string): string | undefined {
    const stored = this.store.getEncrypted(tenantId, engineProfileId);
    if (!stored) return undefined;
    if (stored.envKey !== expectedEnvKey) throw new Error('已保存密钥与引擎配置不匹配。');
    if (!this.protector.available()) throw new Error('当前 Windows 安全存储不可用，无法读取密钥。');
    return this.protector.unprotect(Buffer.from(stored.encryptedValue, 'base64'));
  }

  remove(tenantId: string, engineProfileId: string): boolean {
    return this.store.remove(tenantId, engineProfileId);
  }
}
