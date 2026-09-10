export interface RuntimeCredentialLookup {
  authToken?: string;
  engineProfileId: string;
  envKey: string;
  resolveCredential(token: string, engineProfileId: string, envKey: string): string | undefined;
}

export function buildRuntimeEnvironment(
  parent: NodeJS.ProcessEnv,
  lookup: RuntimeCredentialLookup,
): NodeJS.ProcessEnv {
  const environment = { ...parent };
  if (!lookup.authToken) return environment;
  const credential = lookup.resolveCredential(lookup.authToken, lookup.engineProfileId, lookup.envKey);
  if (credential) environment[lookup.envKey] = credential;
  return environment;
}
