import { describe, expect, it } from 'vitest';
import { createDemoResultPackage, validateResultPackage } from './resultPackage';

const basePackage = () => createDemoResultPackage({
  id: 'res_demo_001',
  workOrderId: 'wo_demo_001',
});

describe('ResultPackage validation', () => {
  it('accepts a complete reviewable result package', () => {
    const resultPackage = basePackage();

    expect(validateResultPackage(resultPackage)).toEqual({ valid: true, errors: [] });
  });

  it('rejects a result package without a deliverable', () => {
    const result = validateResultPackage({ ...basePackage(), deliverables: [] });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ResultPackage requires at least one deliverable.');
  });

  it('rejects an acceptance item that has no verdict', () => {
    const result = validateResultPackage({
      ...basePackage(),
      acceptanceCriteria: [{ id: 'criterion_001', text: 'Deliver the GTM report', verdict: undefined as never }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Every acceptance criterion must have a verdict.');
  });

  it('rejects a result package without evidence references', () => {
    const result = validateResultPackage({ ...basePackage(), evidenceRefs: [] });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ResultPackage requires at least one evidence reference.');
  });

  it('rejects negative costs and a total that does not reconcile', () => {
    const result = validateResultPackage({
      ...basePackage(),
      cost: {
        modelTokens: 1200,
        modelCostCny: -0.01,
        toolCostCny: 0.2,
        totalCostCny: 0.5,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Cost values must be finite non-negative numbers.');
    expect(result.errors).toContain('Total cost must equal model and tool costs.');
  });

  it('accepts decimal costs that reconcile despite floating-point representation', () => {
    const result = validateResultPackage({
      ...basePackage(),
      cost: {
        modelTokens: 1200,
        modelCostCny: 0.1,
        toolCostCny: 0.2,
        totalCostCny: 0.3,
      },
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('rejects missing risk notes and unclear supported rollback instructions', () => {
    const result = validateResultPackage({
      ...basePackage(),
      risk: { level: 'low', notes: [] },
      rollback: { supported: true },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Risk notes must include at least one non-empty note.');
    expect(result.errors).toContain('Rollback instructions must be non-empty when rollback is supported.');
  });
});
