import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopOutcomePort } from './outcomeClient';

afterEach(() => {
  delete window.hummerOutcomes;
  localStorage.removeItem('hummer.auth.session');
});

describe('desktopOutcomePort', () => {
  it('uses the authenticated session for outcome commands and cost reads', async () => {
    localStorage.setItem('hummer.auth.session', 'auth-outcome-test');
    const sessionCost = vi.fn().mockResolvedValue({ totalCostCny: 0.0182, entryCount: 1 });
    const list = vi.fn().mockResolvedValue([{ outcome: { id: 'outcome-1' }, totalCostCny: 0.0182 }]);
    const exportReceipt = vi.fn().mockResolvedValue('{"schema":"hummer.outcome-receipt"}');
    window.hummerOutcomes = {
      define: vi.fn(),
      record: vi.fn(),
      recordCost: vi.fn(),
      receipt: vi.fn(),
      sessionCost,
      list,
      exportReceipt,
    };

    await expect(desktopOutcomePort()?.sessionCost('session-1')).resolves.toEqual({ totalCostCny: 0.0182, entryCount: 1 });
    expect(sessionCost).toHaveBeenCalledWith({ token: 'auth-outcome-test', input: { sessionId: 'session-1' } });
    await desktopOutcomePort()?.list();
    await desktopOutcomePort()?.exportReceipt('outcome-1');
    expect(list).toHaveBeenCalledWith('auth-outcome-test');
    expect(exportReceipt).toHaveBeenCalledWith({ token: 'auth-outcome-test', input: { outcomeEventId: 'outcome-1' } });
  });
});
