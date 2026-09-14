import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, TerminalSquare } from 'lucide-react';

interface RuntimeEnvironmentStatus {
  ready: boolean;
  node: { available: boolean; version: string; source: string };
  codex: { available: boolean; compatible: boolean; expectedVersion: string; version?: string; issue?: string };
  container?: { available: boolean; runtime: string; preferredRuntime: 'podman'; productionRecommended: boolean; issue?: string };
  workspaceExec: { available: boolean; runtime: string; passed: number; total: number; checkedAt: string; issue: string | null } | null;
}

interface RuntimeEnvironmentDoctorBridge {
  check(force?: boolean): Promise<RuntimeEnvironmentStatus>;
  openInstallGuide(target: 'codex' | 'container'): Promise<void>;
}

declare global {
  interface Window { hummerEnvironmentDoctor?: RuntimeEnvironmentDoctorBridge }
}

export default function RuntimeSetupGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RuntimeEnvironmentStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const check = async (force = false) => {
    if (!window.hummerEnvironmentDoctor) {
      setStatus(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    setStatus(await window.hummerEnvironmentDoctor.check(force));
    setChecking(false);
  };

  useEffect(() => { void check(false); }, []);

  if (!window.hummerEnvironmentDoctor || (!checking && status?.ready)) return <>
    {status?.workspaceExec && !status.workspaceExec.available && <div role="alert" className="border-b border-warning/30 bg-warning-soft px-4 py-2 text-center text-[11px] font-medium text-warning">
      {status.container?.issue ?? status.workspaceExec.issue ?? '执行能力当前不可用'}
      {status.container && !status.container.available && <button type="button" onClick={() => { void window.hummerEnvironmentDoctor?.openInstallGuide('container'); }} className="ml-3 underline underline-offset-2" aria-label="安装 Podman">安装 Podman</button>}
      <button type="button" onClick={() => { void check(true); }} className="ml-3 underline underline-offset-2">{'重新检测'}</button>
    </div>}
    {children}
  </>;
  if (checking || !status) return <div className="grid h-full place-items-center bg-neutral-50 text-neutral-500"><LoaderCircle className="animate-spin" size={22} aria-label={'\u6b63\u5728\u68c0\u6d4b\u6267\u884c\u73af\u5883'} /></div>;

  return <main className="grid h-full place-items-center bg-neutral-50 px-6">
    <section className="w-full max-w-[620px] border border-neutral-200 bg-white p-8 shadow-sm">
      <div className="grid h-11 w-11 place-items-center rounded-md bg-neutral-900 text-white"><TerminalSquare size={20} /></div>
      <h1 className="mt-5 text-[22px] font-semibold text-neutral-900">{'\u5b8c\u6210\u6267\u884c\u73af\u5883\u8bbe\u7f6e'}</h1>
      <p className="mt-2 text-[12.5px] leading-5 text-neutral-600">{'HUMMER \u5df2\u5b89\u88c5\u3002\u5b8c\u6210\u4e0b\u9762\u4e00\u9879\u8bbe\u7f6e\u540e\uff0c\u5373\u53ef\u542f\u7528\u771f\u5b9e\u6587\u4ef6\u548c\u547d\u4ee4\u6267\u884c\u3002'}</p>
      <div className="mt-6 divide-y divide-neutral-100 border-y border-neutral-200">
        <StatusRow label="Node" detail={`\u5df2\u5185\u7f6e ${status.node.version}`} ready={status.node.available} />
        <StatusRow label={'HUMMER \u6267\u884c\u5185\u6838'} detail={status.codex.issue ?? `Codex CLI ${status.codex.version}`} ready={status.codex.compatible} />
        {status.container && <StatusRow label={'\u9694\u79bb\u6267\u884c\u73af\u5883'} detail={status.container.issue ?? `${status.container.runtime} \u5df2\u5c31\u7eea`} ready={status.container.available} />}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" onClick={() => { void window.hummerEnvironmentDoctor?.openInstallGuide('codex'); }} className="hum-btn is-primary" aria-label={'\u67e5\u770b\u5b89\u88c5\u6307\u5f15'}><ExternalLink size={14} /> {'\u67e5\u770b\u5b89\u88c5\u6307\u5f15'}</button>
        <button type="button" onClick={() => { void check(true); }} className="hum-btn" aria-label={'\u91cd\u65b0\u68c0\u6d4b'}><RefreshCw size={14} /> {'\u91cd\u65b0\u68c0\u6d4b'}</button>
      </div>
      <p className="mt-4 text-[10.5px] leading-4 text-neutral-500">{'\u5185\u6d4b\u7248\u5c1a\u672a\u5b8c\u6210\u4ee3\u7801\u7b7e\u540d\u3002Windows \u82e5\u663e\u793a\u4fdd\u62a4\u63d0\u793a\uff0c\u8bf7\u4ec5\u4ece HUMMER \u5b98\u65b9\u5185\u6d4b\u6e20\u9053\u5b89\u88c5\u3002'}</p>
    </section>
  </main>;
}

function StatusRow({ label, detail, ready }: { label: string; detail: string; ready: boolean }) {
  return <div className="flex items-start gap-3 py-3">
    <CheckCircle2 size={16} className={ready ? 'mt-0.5 text-success' : 'mt-0.5 text-warning'} />
    <div><div className="text-[12px] font-medium text-neutral-800">{label}</div><div className="mt-0.5 text-[11px] text-neutral-500">{detail}</div></div>
  </div>;
}
