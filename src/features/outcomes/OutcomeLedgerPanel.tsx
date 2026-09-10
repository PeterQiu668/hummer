import { useEffect, useState } from 'react';
import { Download, FileCheck2, ShieldCheck } from 'lucide-react';
import { desktopOutcomePort, type OutcomeLedgerEntry } from './outcomeClient';

export default function OutcomeLedgerPanel() {
  const [entries, setEntries] = useState<OutcomeLedgerEntry[]>([]);
  const [exportedId, setExportedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const port = desktopOutcomePort();
    if (!port) return;
    let active = true;
    void port.list().then((items) => { if (active) setEntries(items); }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '\u7ed3\u679c\u8d26\u672c\u6682\u4e0d\u53ef\u7528');
    });
    return () => { active = false; };
  }, []);

  const exportReceipt = async (entry: OutcomeLedgerEntry) => {
    const port = desktopOutcomePort();
    if (!port) return;
    try {
      const json = await port.exportReceipt(entry.outcome.id);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `hummer-receipt-${entry.outcome.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportedId(entry.outcome.id);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '\u56de\u6267\u5bfc\u51fa\u5931\u8d25');
    }
  };

  if (!desktopOutcomePort()) return null;
  return <section className="hum-card overflow-hidden">
    <div className="flex items-start gap-2 border-b border-neutral-200 px-4 py-3">
      <FileCheck2 size={15} className="mt-0.5 text-primary-600" />
      <div className="min-w-0 flex-1"><h2 className="text-[13px] font-semibold text-neutral-900">{'\u771f\u5b9e\u7ed3\u679c\u8d26\u672c'}</h2><p className="mt-0.5 text-[10.5px] text-neutral-500">{'\u53ea\u663e\u793a\u5df2\u843d\u5e93\u7684\u9a8c\u6536\u3001\u5ba1\u6279\u548c\u6210\u672c\uff1b\u5bfc\u51fa\u540e\u53ef\u79bb\u7ebf\u9a8c\u8bc1\u3002'}</p></div>
      <ShieldCheck size={15} className="text-success" />
    </div>
    {!entries.length && !error && <div className="px-4 py-5 text-[11px] text-neutral-500">{'\u5c1a\u65e0\u5df2\u843d\u5e93\u7ed3\u679c'}</div>}
    <div className="divide-y divide-neutral-100">{entries.map((entry) => <div key={entry.outcome.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="text-[12px] font-medium text-neutral-800">{entry.definition.title}</span><span className={`hum-chip ${entry.outcome.verdict === 'accepted' ? 'is-success' : 'is-warning'}`}>{entry.outcome.verdict === 'accepted' ? '\u5df2\u9a8c\u6536' : '\u5df2\u62d2\u7edd'}</span></div>
        <div className="mt-1 text-[10.5px] text-neutral-500">{entry.definition.actionPattern} · {entry.costCount ? `\u00a5${entry.totalCostCny.toFixed(4)}` : '\u6210\u672c\u672a\u63d0\u4f9b'} · {entry.outcome.acceptedBy}</div>
      </div>
      <button type="button" onClick={() => { void exportReceipt(entry); }} className="hum-btn is-sm" aria-label={'\u5bfc\u51fa\u56de\u6267'}><Download size={12} /> {exportedId === entry.outcome.id ? '\u56de\u6267\u5df2\u5bfc\u51fa' : '\u5bfc\u51fa\u56de\u6267'}</button>
    </div>)}</div>
    {error && <div role="alert" className="border-t border-neutral-100 px-4 py-2 text-[10.5px] text-danger">{error}</div>}
  </section>;
}
