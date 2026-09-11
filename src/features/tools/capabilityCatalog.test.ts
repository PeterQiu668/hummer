import { describe, expect, it } from 'vitest';
import { implementedCapabilityIds, validatePlanCapabilities } from './capabilityCatalog';

describe('implemented capability catalog', () => {
  it('contains only the two M5-D executable capabilities', () => {
    expect(implementedCapabilityIds()).toEqual(['external.send.draft', 'fs.read']);
  });

  it('fails closed when a plan names an unimplemented capability', () => {
    expect(validatePlanCapabilities(['fs.read', 'external.send.draft'])).toEqual(['fs.read', 'external.send.draft']);
    expect(() => validatePlanCapabilities(['desktop.excel.open'])).toThrow(/unimplemented capability desktop\.excel\.open/i);
  });
});
