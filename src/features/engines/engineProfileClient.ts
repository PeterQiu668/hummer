import config from './engine-profiles.json';

export type EngineTier = 'standard' | 'enhanced' | 'flagship';

export interface CustomerEngineProfile {
  id: string;
  tier: EngineTier;
  label: string;
  available: boolean;
  dataDomain: string;
  compatibilityNote?: string;
}

export interface EngineProfileBridge {
  list(): Promise<CustomerEngineProfile[]>;
}

declare global {
  interface Window {
    hummerEngineProfiles?: EngineProfileBridge;
  }
}

const browserPrototypeProfiles: readonly CustomerEngineProfile[] = Object.freeze(
  (config.profiles as CustomerEngineProfile[]).map((profile) => Object.freeze({ ...profile })),
);

export function browserEngineProfiles(): readonly CustomerEngineProfile[] {
  return browserPrototypeProfiles;
}

export async function listEngineProfiles(bridge?: EngineProfileBridge): Promise<readonly CustomerEngineProfile[]> {
  const runtimeBridge = bridge ?? (typeof window !== 'undefined' ? window.hummerEngineProfiles : undefined);
  if (!runtimeBridge) return browserPrototypeProfiles;
  const profiles = await runtimeBridge.list();
  return profiles.filter(isCustomerProfile);
}

export function engineProfileForLabel(
  profiles: readonly CustomerEngineProfile[],
  label: string,
): CustomerEngineProfile {
  return profiles.find((profile) => profile.label === label && profile.available)
    ?? profiles.find((profile) => profile.id === label && profile.available)
    ?? profiles.find((profile) => profile.available)
    ?? browserPrototypeProfiles[0];
}

function isCustomerProfile(profile: CustomerEngineProfile): boolean {
  return profile.id !== 'openai-codex-validation'
    && (profile.tier === 'standard' || profile.tier === 'enhanced' || profile.tier === 'flagship')
    && Boolean(profile.label && profile.dataDomain);
}
