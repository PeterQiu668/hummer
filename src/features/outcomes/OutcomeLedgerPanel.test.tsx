import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OutcomeLedgerPanel from './OutcomeLedgerPanel';

describe('OutcomeLedgerPanel', () => {
  afterEach(() => {
    delete window.hummerOutcomes;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('lists persisted outcomes and downloads a self-contained receipt', async () => {
    localStorage.setItem('hummer.auth.session', 'outcome-token');
    const exportReceipt = vi.fn().mockResolvedValue('{"schema":"hummer.outcome-receipt"}');
    window.hummerOutcomes = {
      define: vi.fn(), record: vi.fn(), recordCost: vi.fn(), receipt: vi.fn(), sessionCost: vi.fn(), exportReceipt,
      list: vi.fn().mockResolvedValue([{
        outcome: { id: 'outcome-1', tenantId: 'tenant-1', outcomeDefinitionId: 'definition-1', workOrderId: 'work-1', sessionId: 'session-1', approvalId: 'approval-1', verdict: 'accepted', acceptedBy: 'account-1', evidenceRef: 'evidence-1', occurredAt: '2026-09-11T00:00:00.000Z' },
        definition: { id: 'definition-1', tenantId: 'tenant-1', actionPattern: 'external.send*', title: '\u5916\u53d1\u5ba1\u6838', acceptanceCriteria: '\u5177\u540d\u5ba1\u6279\u540e\u5916\u53d1', unitPriceCny: null, riskLevel: 'high', enabled: true, createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z' },
        totalCostCny: 0.0182, costCount: 1,
      }]),
    };
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:receipt') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<OutcomeLedgerPanel />);
    expect(await screen.findByText('\u5916\u53d1\u5ba1\u6838')).toBeInTheDocument();
    expect(screen.getByText(/\u00a50\.0182/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '\u5bfc\u51fa\u56de\u6267' }));

    expect(await screen.findByText('\u56de\u6267\u5df2\u5bfc\u51fa')).toBeInTheDocument();
    expect(exportReceipt).toHaveBeenCalledWith({ token: 'outcome-token', input: { outcomeEventId: 'outcome-1' } });
  });
});
