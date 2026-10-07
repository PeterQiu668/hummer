import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, ExternalLink, Flag, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  publicMarketFailureMessage,
  publicMarketplacePort,
  type PublicCapabilityListing,
} from './publicMarketClient';

type LoadState = 'unconfigured' | 'loading' | 'ready' | 'error';

export default function PublicMarketPanel({ query }: { query: string }) {
  const port = useMemo(() => publicMarketplacePort(), []);
  const [load, setLoad] = useState<LoadState>(port ? 'loading' : 'unconfigured');
  const [message, setMessage] = useState(port ? '' : '未配置 Remote Relay，公开能力网络不可用；不会展示样例、缓存或 localStorage 数据。');
  const [items, setItems] = useState<readonly PublicCapabilityListing[]>([]);
  const [selected, setSelected] = useState<PublicCapabilityListing | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [installMessage, setInstallMessage] = useState('');

  const refresh = async () => {
    if (!port) return;
    setLoad('loading');
    try {
      const listings = await port.listPublicCapabilities();
      setItems(listings);
      setSelected((current) => current && listings.some((item) => item.listingId === current.listingId) ? current : null);
      setMessage('');
      setLoad('ready');
    } catch (error) {
      setItems([]);
      setSelected(null);
      setMessage(publicMarketFailureMessage(error, '读取公开能力网络失败。'));
      setLoad('error');
    }
  };

  useEffect(() => { void refresh(); }, [port]);

  const openDetail = async (listing: PublicCapabilityListing) => {
    if (!port) return;
    try {
      setSelected(await port.getPublicCapability(listing.listingId));
      setReportState('idle');
      setReportReason('');
      setInstallMessage('');
    } catch (error) {
      setMessage(publicMarketFailureMessage(error, '读取公开能力详情失败。'));
      if ((error as { status?: number }).status === 404) await refresh();
    }
  };

  const submitReport = async () => {
    if (!port || !selected || !reportReason.trim()) return;
    setReportState('sending');
    try {
      await port.reportPublicCapability(selected.listingId, reportReason.trim());
      setReportState('sent');
      setReportReason('');
    } catch (error) {
      setMessage(publicMarketFailureMessage(error, '举报提交失败。'));
      setReportState('error');
      if ((error as { status?: number }).status === 404) await refresh();
    }
  };

  const requestInstall = async () => {
    if (!port || !selected || !port.installerAvailable) return;
    setInstallMessage('正在调用可信安装边界…');
    try {
      const result = await port.requestInstall(selected);
      setInstallMessage(result.installed ? result.message : `安装未完成：${result.message}`);
    } catch (error) {
      setInstallMessage(publicMarketFailureMessage(error, '安装申请失败。'));
      if ((error as { status?: number }).status === 404) await refresh();
    }
  };

  const visible = items.filter((item) => `${item.title} ${item.goal} ${item.packageId}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <section aria-label="公开能力网络" className="min-w-0 space-y-4">
    <div className="flex min-w-0 flex-col gap-3 rounded-md border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1"><h2 className="text-[14px] font-semibold text-neutral-900">公开能力网络</h2><p className="mt-1 text-[11px] leading-5 text-neutral-500">只展示 Relay 的脱敏公开投影。举报只进入人工审核队列，不会自动下架。</p></div>
      <button type="button" disabled={!port || load === 'loading'} onClick={() => { void refresh(); }} className="hum-btn is-sm w-full sm:w-auto"><RefreshCw size={12} /> 刷新</button>
    </div>
    {load !== 'ready' && <div role={load === 'error' ? 'alert' : 'status'} className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-[11px] leading-5 text-neutral-600">{load === 'loading' ? '正在读取 Remote Relay 的公开能力…' : message}</div>}
    {load === 'ready' && !port?.installerAvailable && <div role="status" className="rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-[11px] leading-5 text-neutral-700">公开能力当前为只读。可信安装器未连接，不会写入 localStorage，也不会显示假安装成功。</div>}
    {load === 'ready' && visible.length === 0 && <div className="rounded-md border border-dashed border-neutral-300 bg-white px-4 py-5 text-[11px] text-neutral-500">{items.length ? '没有匹配当前搜索的公开能力。' : '当前没有可公开浏览的能力；已下架条目不会显示。'}</div>}
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">{visible.map((item) => <article key={item.listingId} data-testid="public-capability-card" className="hum-card min-w-0 overflow-hidden p-4">
      <div className="flex min-w-0 items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary-50 text-primary-700"><ShieldCheck size={15} /></div><div className="min-w-0 flex-1"><h3 className="break-words text-[13px] font-semibold text-neutral-900">{item.title}</h3><div className="mt-0.5 break-all font-mono text-[10px] text-neutral-500">{item.packageId} · v{item.packageVersion}</div></div><span className="hum-chip is-success">公开只读</span></div>
      <p className="mt-3 text-[11.5px] leading-5 text-neutral-600">{item.goal}</p>
      <div className="mt-3 grid grid-cols-1 gap-2 text-[10.5px] text-neutral-600 sm:grid-cols-2"><span>{item.trialRecord.success} 成功 / {item.trialRecord.failure} 失败 / {item.trialRecord.shadowRuns} 次影子运行</span><span>{item.trialRecord.regressionPassed ? '回归通过' : '回归未通过'} · 失败摘要 {item.failureNotes.length} 条</span><span>来源：{item.provenance.runtime} {item.provenance.runtimeVersion} · {item.provenance.demoSessionCount} 次示范</span><span>权限：{permissionSummary(item)}</span></div>
      <div className="mt-3 break-all font-mono text-[9.5px] text-neutral-400">完整性摘要 {item.integrity.digest}</div>
      <button type="button" onClick={() => { void openDetail(item); }} className="hum-btn is-sm mt-3 w-full sm:w-auto">查看详情 <ExternalLink size={12} /></button>
    </article>)}</div>
    {selected && <div data-testid="public-capability-detail" className="hum-card min-w-0 overflow-hidden p-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start"><div className="min-w-0 flex-1"><h3 className="text-[14px] font-semibold text-neutral-900">{selected.title}</h3><p className="mt-1 text-[11px] leading-5 text-neutral-600">{selected.goal}</p></div><span className="hum-chip is-brand">{selected.publisherRef}</span></div>
      <div className="mt-3 grid grid-cols-1 gap-2 text-[10.5px] text-neutral-600 sm:grid-cols-2"><span>应用边界 {selected.sourceBoundary.applicationCount} · 窗口规则 {selected.sourceBoundary.windowPatternCount}</span><span>证据 {selected.evidenceCount} · 回执 {selected.receiptRef}</span><span>回归摘要 {selected.trialRecord.regressionEvidenceDigest}</span><span>发布于 {new Date(selected.publishedAt).toLocaleString('zh-CN')}</span></div>
      <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row"><button type="button" disabled={!port?.installerAvailable} onClick={() => { void requestInstall(); }} className="hum-btn is-primary w-full sm:w-auto"><Download size={12} /> {port?.installerAvailable ? '申请可信安装' : '安装器未连接'}</button><input aria-label="举报原因" value={reportReason} onChange={(event) => setReportReason(event.target.value)} placeholder="说明需要人工复核的原因" className="hum-input min-w-0 flex-1" /><button type="button" disabled={!reportReason.trim() || reportState === 'sending'} onClick={() => { void submitReport(); }} className="hum-btn w-full sm:w-auto"><Flag size={12} /> {reportState === 'sending' ? '提交中' : '提交举报'}</button></div>
      {reportState === 'sent' && <div role="status" className="mt-2 text-[10.5px] text-success">举报已进入人工审核队列；当前条目仍保持公开。</div>}
      {reportState === 'error' && <div role="alert" className="mt-2 flex items-center gap-1 text-[10.5px] text-danger"><AlertTriangle size={11} /> {message}</div>}
      {installMessage && <div role="status" className="mt-2 text-[10.5px] text-neutral-600">{installMessage}</div>}
    </div>}
  </section>;
}

function permissionSummary(item: PublicCapabilityListing): string {
  if (!item.declaredPermissions.length) return '无声明权限';
  return item.declaredPermissions.map((permission) => `${permission.capability} · ${permission.access}`).join('；');
}
