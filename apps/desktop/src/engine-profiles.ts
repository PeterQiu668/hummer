import config from './config/engine-profiles.json' with { type: 'json' };

export type EngineTier = 'standard' | 'enhanced' | 'flagship';
export type EngineShell = 'codex' | 'claude-code';
export type EngineWireApi = 'responses' | 'chat';

export interface EngineProfile {
  id: string;
  tier: EngineTier;
  shell: EngineShell;
  providerId: string;
  providerName: string;
  baseUrl: string;
  model: string;
  wireApi: EngineWireApi;
  envKey: string;
  dataDomain: string;
  requiresOpenAiAuth: boolean;
  compatibilityNote?: string;
  available?: boolean;
  customerVisible?: boolean;
  providerMode?: 'custom' | 'codex-login';
}

export interface CustomerEngineProfile {
  id: string;
  tier: EngineTier;
  label: string;
  available: boolean;
  dataDomain: string;
  compatibilityNote?: string;
  credentialStatus: 'configured' | 'not_configured' | 'managed';
}

const profiles = (config.profiles as EngineProfile[]).map(validateProfile);

export function requiredCodexCliVersion(): string { return config.codexCliVersion; }
export function listEngineProfiles(): readonly EngineProfile[] { return profiles; }
export function customerEngineProfiles(configuredEnvKeys: ReadonlySet<string> = configuredEnvironmentKeys(process.env)): readonly CustomerEngineProfile[] {
  return profiles
    .filter((profile) => profile.customerVisible !== false)
    .map((profile) => {
      const managed = profile.providerMode === 'codex-login';
      const configured = managed || configuredEnvKeys.has(profile.envKey);
      const compatible = profile.available !== false;
      return Object.freeze({
        id: profile.id, tier: profile.tier, label: tierLabel(profile.tier),
        available: compatible && configured, dataDomain: profile.dataDomain,
        credentialStatus: managed ? 'managed' as const : configured ? 'configured' as const : 'not_configured' as const,
        ...(profile.compatibilityNote ? { compatibilityNote: profile.compatibilityNote }
          : !configured ? { compatibilityNote: '未配置密钥' } : {}),
      });
    });
}
export function defaultEngineProfile(): EngineProfile { return engineProfileById(config.defaultProfileId); }

export function engineProfileById(id: string | undefined): EngineProfile {
  const resolvedId = id || config.defaultProfileId;
  const profile = profiles.find((candidate) => candidate.id === resolvedId);
  if (!profile) throw new Error(`Unknown HUMMER engine profile ${resolvedId}`);
  return profile;
}

export function buildCodexProviderArgs(profile: EngineProfile, environment: NodeJS.ProcessEnv): string[] {
  if (profile.shell !== 'codex') throw new Error(`Engine profile ${profile.id} does not use the Codex shell`);
  if (profile.wireApi === 'chat') {
    throw new Error(`Codex CLI 0.153.4 does not support wire_api="chat"; ${profile.providerName} cannot run through this shell until it offers a Responses-compatible endpoint.`);
  }
  const providerPath = `model_providers.${profile.providerId}`;
  const runtimeSafetyArgs = ['--disable', 'remote_plugin', '--disable', 'plugins', '--disable', 'recommended_plugins'];
  if (profile.providerMode === 'codex-login') {
    return [
      ...runtimeSafetyArgs,
      '-c', 'model_provider="openai"',
      '-c', `model=${tomlString(profile.model)}`,
    ];
  }
  return [
    ...runtimeSafetyArgs,
    '-c', `${providerPath}.name=${tomlString(profile.providerName)}`,
    '-c', `${providerPath}.base_url=${tomlString(profile.baseUrl)}`,
    ...(!profile.requiresOpenAiAuth || environment[profile.envKey] ? ['-c', `${providerPath}.env_key=${tomlString(profile.envKey)}`] : []),
    '-c', `${providerPath}.wire_api=${tomlString(profile.wireApi)}`,
    '-c', `${providerPath}.requires_openai_auth=${String(profile.requiresOpenAiAuth)}`,
    '-c', `model_provider=${tomlString(profile.providerId)}`,
    '-c', `model=${tomlString(profile.model)}`,
  ];
}

export function redactRuntimeSecrets(raw: string, environment: NodeJS.ProcessEnv): string {
  let redacted = raw;
  for (const profile of profiles) {
    const secret = environment[profile.envKey];
    if (secret) redacted = redacted.split(secret).join(`[REDACTED:${profile.envKey}]`);
  }
  return redacted;
}

function validateProfile(profile: EngineProfile): EngineProfile {
  if (!profile.id || !profile.providerId || !profile.baseUrl || !profile.model || !profile.envKey) throw new TypeError('Every HUMMER engine profile requires id, provider, URL, model and env key');
  if (!/^https:\/\//.test(profile.baseUrl)) throw new TypeError(`Engine profile ${profile.id} requires an HTTPS base URL`);
  if (!/^[A-Z][A-Z0-9_]+$/.test(profile.envKey)) throw new TypeError(`Engine profile ${profile.id} has an invalid environment key name`);
  return Object.freeze({ ...profile });
}

function tierLabel(tier: EngineTier): string {
  if (tier === 'standard') return '\u6807\u51c6';
  if (tier === 'enhanced') return '\u589e\u5f3a';
  return '\u65d7\u8230';
}

function configuredEnvironmentKeys(environment: NodeJS.ProcessEnv): Set<string> {
  return new Set(profiles.map((profile) => profile.envKey).filter((envKey) => Boolean(environment[envKey])));
}

function tomlString(value: string): string { return JSON.stringify(value); }
