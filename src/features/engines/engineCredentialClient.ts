import { currentSessionToken } from '../identity/identityClient';

export interface EngineCredentialResult {
  engineProfileId: string;
  envKey: string;
  configured: boolean;
}

export interface EngineCredentialBridge {
  configure(request: { token: string; engineProfileId: string; credential: string }): Promise<EngineCredentialResult>;
  remove(request: { token: string; engineProfileId: string }): Promise<EngineCredentialResult>;
}

declare global {
  interface Window {
    hummerEngineCredentials?: EngineCredentialBridge;
  }
}

export function hasEngineCredentialBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.hummerEngineCredentials);
}

export async function configureEngineCredential(engineProfileId: string, credential: string): Promise<EngineCredentialResult> {
  const token = requireSessionToken();
  if (!window.hummerEngineCredentials) throw new Error('Engine credential storage requires HUMMER Desktop');
  return window.hummerEngineCredentials.configure({ token, engineProfileId, credential });
}

export async function removeEngineCredential(engineProfileId: string): Promise<EngineCredentialResult> {
  const token = requireSessionToken();
  if (!window.hummerEngineCredentials) throw new Error('Engine credential storage requires HUMMER Desktop');
  return window.hummerEngineCredentials.remove({ token, engineProfileId });
}

function requireSessionToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('Configure an engine credential after signing in');
  return token;
}
