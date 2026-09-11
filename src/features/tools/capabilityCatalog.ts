import catalog from './tool-definitions.json';

interface CapabilityDefinition {
  capabilityId: string;
  enabled: boolean;
}

const capabilities = (catalog.definitions as CapabilityDefinition[])
  .filter((definition) => definition.enabled)
  .map((definition) => definition.capabilityId)
  .sort();

export function implementedCapabilityIds(): string[] {
  return [...capabilities];
}

export function validatePlanCapabilities(requested: readonly string[]): string[] {
  const normalized = [...new Set(requested.map((capability) => capability.trim()).filter(Boolean))];
  const unknown = normalized.find((capability) => !capabilities.includes(capability));
  if (unknown) throw new Error(`Plan requested unimplemented capability ${unknown}`);
  return normalized;
}
