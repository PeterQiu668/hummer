import { useMemo, useState } from 'react';
import type { DemoSessionV1 } from '@hummer/contracts';
import { CircleStop, Eye, Pause, Play, RotateCcw, ScanSearch, ShieldCheck, Trash2 } from 'lucide-react';
import { demoSessionPort } from './demoSessionClient';

const REDACTION_POLICY = 'local-human-review-v1';

export default function DemoSessionPage() {
  const port = useMemo(() => demoSessionPort(), []);
  const [apps, setApps] = useState('');
  const [windows, setWindows] = useState('');
  const [excluded, setExcluded] = useState('密码, 支付');
  const [captureMode, setCaptureMode] = useState<DemoSessionV1['captureMode']>('events-only');
  const [session, setSession] = useState<DemoSessionV1 | null>(null);
  const [review, setReview] = useState<DemoSessionV1 | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [processId, setProcessId] = useState('');
  const [exactWindowTitle, setExactWindowTitle] = useState('');
  const [captureNotice, setCaptureNotice] = useState('');

  const mutate = async (action: () => Promise<DemoSessionV1>) => {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      setSession(next);
      setReview(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!port) return;
    await mutate(() => port.start({
      captureMode,
      sourceBoundary: {
        apps: splitList(apps),
        windows: splitList(windows),
        excluded: splitList(excluded),
      },
    }));
  };

  const exportReview = async () => {
    if (!port || !session) return;
    setBusy(true);
    setError('');
    try {
      setReview(await port.exportReview(session.sessionId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const captureUia = async () => {
    if (!port || !session) return;
    setBusy(true);
    setError('');
    setCaptureNotice('');
    try {
      const result = await port.captureUia(session.sessionId, Number(processId), exactWindowTitle);
      setSession(result.session);
      setReview(null);
      setCaptureNotice(result.accepted
        ? `已采集 ${result.capturedRecords} 条 ${result.app} 可访问性元数据。`
        : `未写入：会话状态为 ${result.reason}。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="h-full overflow-y-auto bg-neutral-50 p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-md border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-700">Phase 2 · W7 本地隐私内核</p>
              <h1 className="mt-1 text-xl font-semibold text-neutral-900">教它做我的活</h1>
              <p className="mt-1 max-w-2xl text-[12px] leading-5 text-neutral-600">先划定允许的应用与窗口，再控制演示会话。当前页面只管理本地元数据状态与复核投影。</p>
            </div>
            <span className="rounded-full border border-success/30 bg-success-soft px-3 py-1 text-[11px] font-medium text-success">Windows UIAutomation · 仅本机元数据</span>
          </div>
          <div role="note" className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-600">
            当前只按显式进程 ID、精确窗口标题和会话白名单读取 Windows 可访问性元数据；不会采集屏幕、键盘原文或视频，也不会上传。此能力不代表已经完成真实专家验收。
          </div>
        </header>

        {!session ? (
          <section className="rounded-md border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-[14px] font-semibold text-neutral-900">1. 设置白名单</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="允许的应用（逗号或换行分隔）"><textarea aria-label="允许的应用" value={apps} onChange={(event) => setApps(event.target.value)} className="hum-input min-h-20 resize-y" placeholder="例如：Microsoft Excel" /></Field>
              <Field label="允许的窗口（逗号或换行分隔）"><textarea aria-label="允许的窗口" value={windows} onChange={(event) => setWindows(event.target.value)} className="hum-input min-h-20 resize-y" placeholder="例如：销售周报" /></Field>
              <Field label="明确排除"><input aria-label="明确排除" value={excluded} onChange={(event) => setExcluded(event.target.value)} className="hum-input" /></Field>
              <Field label="本地模式"><select aria-label="本地模式" value={captureMode} onChange={(event) => setCaptureMode(event.target.value as DemoSessionV1['captureMode'])} className="hum-input"><option value="events-only">仅事件元数据</option><option value="ax-tree+keyframes">可访问性树 + 关键帧元数据</option></select></Field>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-100 pt-4">
              <p className="text-[11px] text-neutral-500">localOnly=true；未脱敏前禁止生成离机复核投影。</p>
              <button type="button" disabled={!port || busy || splitList(apps).length === 0 || splitList(windows).length === 0} onClick={() => { void start(); }} className="hum-btn is-primary disabled:cursor-not-allowed disabled:opacity-50"><Play size={13} />启动本地会话</button>
            </div>
            {!port && <p role="alert" className="mt-3 text-[11px] text-danger">此控制面需要 HUMMER 桌面版；浏览器预览不会创建演示会话。</p>}
          </section>
        ) : (
          <>
            <section className="rounded-md border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-[14px] font-semibold text-neutral-900">2. 会话控制</h2><p className="mt-1 font-mono text-[10px] text-neutral-500">{session.sessionId}</p></div>
                <div className="flex items-center gap-2"><StatusBadge status={session.status} /><span className="rounded border border-success/25 bg-success-soft px-2 py-1 text-[10px] text-success">localOnly</span></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {session.status === 'capturing' && <button type="button" disabled={busy} onClick={() => { void mutate(() => port!.pause(session.sessionId)); }} className="hum-btn"><Pause size={13} />暂停</button>}
                {session.status === 'paused' && <button type="button" disabled={busy} onClick={() => { void mutate(() => port!.resume(session.sessionId)); }} className="hum-btn"><RotateCcw size={13} />继续</button>}
                {session.status !== 'ended' && <button type="button" disabled={busy} onClick={() => { void mutate(() => port!.end(session.sessionId)); }} className="hum-btn"><CircleStop size={13} />结束</button>}
              </div>
              <dl className="mt-4 grid gap-3 rounded-md bg-neutral-50 p-3 text-[11px] md:grid-cols-3"><Fact label="应用白名单" value={session.sourceBoundary.apps.join('、')} /><Fact label="窗口白名单" value={session.sourceBoundary.windows.join('、')} /><Fact label="明确排除" value={session.sourceBoundary.excluded.join('、') || '无'} /></dl>
              <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-[11px] font-medium text-neutral-700">单次 Windows UIAutomation 采集</p>
                <div className="mt-2 grid gap-2 md:grid-cols-[160px_1fr_auto]">
                  <input aria-label="目标进程 ID" inputMode="numeric" value={processId} onChange={(event) => setProcessId(event.target.value)} className="hum-input" placeholder="进程 ID" />
                  <input aria-label="精确窗口标题" value={exactWindowTitle} onChange={(event) => setExactWindowTitle(event.target.value)} className="hum-input" placeholder="必须与窗口白名单完全一致" />
                  <button type="button" disabled={busy || session.status !== 'capturing' || !/^\d+$/.test(processId) || !exactWindowTitle} onClick={() => { void captureUia(); }} className="hum-btn is-primary disabled:cursor-not-allowed disabled:opacity-50"><ScanSearch size={13} />采集一次可访问性元数据</button>
                </div>
                <p className="mt-2 text-[10px] text-neutral-500">不监听键盘，不截屏，不录制视频；每次采集都重新核验 PID、精确标题与当前 DemoSession 白名单。</p>
                {captureNotice && <p role="status" className="mt-2 text-[11px] text-success">{captureNotice}</p>}
              </div>
            </section>

            <section className="rounded-md border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-[14px] font-semibold text-neutral-900">3. 段落时间线</h2>
              <div className="mt-3 space-y-2">
                {session.segments.map((segment) => <article key={segment.segId} className={`rounded-md border p-3 ${segment.deletedAt ? 'border-neutral-200 bg-neutral-50 opacity-70' : 'border-neutral-200 bg-white'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[12px] font-medium text-neutral-800">段落 {segment.sequence}{segment.deletedAt ? ' · 已删除并重链' : ''}</p><p className="mt-1 text-[10px] text-neutral-500">{formatTime(segment.from)} → {segment.to ? formatTime(segment.to) : '进行中'} · {segment.recordCount} 条元数据</p><p className="mt-1 font-mono text-[9px] text-neutral-400">digest {segment.digest.slice(0, 16)}…</p></div>{segment.to && !segment.deletedAt && <button type="button" onClick={() => setPendingDelete(segment.segId)} className="hum-btn text-danger"><Trash2 size={12} />删除段落</button>}</div>
                  {pendingDelete === segment.segId && <div role="alertdialog" aria-label="确认删除段落" className="mt-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-[11px] text-danger"><p>删除会清除该段本地元数据，并为该段及后续段重新计算摘要链；审计墓碑会保留。</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => setPendingDelete(null)} className="hum-btn">取消</button><button type="button" disabled={busy} onClick={() => { setPendingDelete(null); void mutate(() => port!.deleteSegment(session.sessionId, segment.segId)); }} className="hum-btn">确认删除并重链</button></div></div>}
                </article>)}
              </div>
            </section>

            {session.status === 'ended' && <section className="rounded-md border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-[14px] font-semibold text-neutral-900">4. 本地复核与导出门禁</h2>
              {!session.redactionApplied ? <div className="mt-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-[11px] leading-5 text-danger"><strong>未脱敏，禁止离开本机。</strong> 请先由当前演示者完成本地人工复核并标记脱敏策略；在此之前 IPC 会拒绝导出。<div className="mt-3"><button type="button" disabled={busy} onClick={() => { void mutate(() => port!.markRedacted(session.sessionId, REDACTION_POLICY)); }} className="hum-btn"><ShieldCheck size={13} />确认本地复核并标记已脱敏</button></div></div> : <div className="mt-3 rounded-md border border-success/30 bg-success-soft p-3 text-[11px] leading-5 text-success"><strong>已记录脱敏复核：</strong>{session.redactionPolicyRef}<div className="mt-3"><button type="button" disabled={busy} onClick={() => { void exportReview(); }} className="hum-btn"><Eye size={13} />生成复核投影</button></div></div>}
              {review && <pre aria-label="复核投影" className="mt-3 max-h-72 overflow-auto rounded-md bg-neutral-900 p-3 text-[10px] text-neutral-100">{JSON.stringify(review, null, 2)}</pre>}
            </section>}
          </>
        )}
        {error && <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">{error}</div>}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-neutral-700">{label}</span>{children}</label>; }
function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-neutral-400">{label}</dt><dd className="mt-1 text-neutral-700">{value}</dd></div>; }
function StatusBadge({ status }: { status: DemoSessionV1['status'] }) { const label = status === 'capturing' ? '本地会话进行中' : status === 'paused' ? '已暂停' : '已结束'; return <span className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[10px] font-medium text-neutral-700">{label}</span>; }
function splitList(value: string): string[] { return [...new Set(value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean))]; }
function formatTime(value: string): string { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
