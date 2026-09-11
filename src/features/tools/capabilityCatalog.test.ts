import { describe, expect, it } from 'vitest';
import { implementedCapabilityIds, validatePlanCapabilities } from './capabilityCatalog';

describe('implemented capability catalog', () => {
  it('contains only the three M5-E executable capabilities', () => {
    expect(implementedCapabilityIds()).toEqual(['doc.extract', 'external.send.draft', 'fs.read']);
  });

  it('fails closed when a plan names an unimplemented capability', () => {
    expect(validatePlanCapabilities(['doc.extract', 'fs.read', 'external.send.draft'])).toEqual(['doc.extract', 'fs.read', 'external.send.draft']);
    expect(() => validatePlanCapabilities(['desktop.excel.open'])).toThrow(/unimplemented capability desktop\.excel\.open/i);
  });
});
