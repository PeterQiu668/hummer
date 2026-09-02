import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Building2, KeyRound, ShieldCheck } from 'lucide-react';
import {
  acceptInvitation,
  createCompany,
  isDesktopIdentity,
  listTenants,
  resumeIdentity,
  switchTenant,
  type IdentityContext as IdentityValue,
  type TenantRecord,
} from './identityClient';

interface IdentityState {
  identity: IdentityValue;
  tenants: TenantRecord[];
  switchTenant(tenantId: string): Promise<void>;
  refreshTenants(): Promise<void>;
}

const IdentityContext = createContext<IdentityState | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<IdentityValue | null>(null);
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void resumeIdentity().then(async (value) => {
      if (!active) return;
      setIdentity(value);
      if (value) setTenants(await listTenants());
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const refreshTenants = async () => setTenants(await listTenants());
  const selectTenant = async (tenantId: string) => {
    const value = await switchTenant(tenantId);
    setIdentity(value);
    await refreshTenants();
  };
  const value = useMemo(() => identity ? { identity, tenants, switchTenant: selectTenant, refreshTenants } : null, [identity, tenants]);

  if (loading) return <div className="grid h-full place-items-center bg-neutral-50 text-[12px] text-neutral-500">正在载入企业身份...</div>;
  if (!identity) return <IdentityGate onReady={async (next) => { setIdentity(next); setTenants(await listTenants()); }} />;
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useOptionalIdentity(): IdentityState | null { return useContext(IdentityContext); }
export function useIdentity(): IdentityState {
  const value = useContext(IdentityContext);
  if (!value) throw new Error('useIdentity must be used inside IdentityProvider');
  return value;
}

function IdentityGate({ onReady }: { onReady: (context: IdentityValue) => Promise<void> }) {
  const [mode, setMode] = useState<'company' | 'invite'>('company');
  const [companyName, setCompanyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contact, setContact] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const contactType = contact.includes('@') ? 'email' : 'phone';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const contactFields = contactType === 'email' ? { email: contact } : { phone: contact };
      const context = mode === 'company'
        ? await createCompany({ companyName, displayName, ...contactFields })
        : await acceptInvitation({ token: inviteToken, displayName, ...contactFields });
      await onReady(context);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '身份验证失败');
    } finally {
      setBusy(false);
    }
  };

  return <main className="grid h-full min-h-[640px] place-items-center bg-neutral-50 p-6">
    <section className="w-full max-w-[440px] overflow-hidden rounded-md border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 px-6 py-5">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-md bg-neutral-900 text-white"><Building2 size={17} /></span><div><h1 className="text-[17px] font-semibold text-neutral-900">进入 HUMMER</h1><p className="mt-0.5 text-[11px] text-neutral-500">先确认企业身份，再进入可信工作空间。</p></div></div>
      </div>
      <div className="grid grid-cols-2 border-b border-neutral-200 bg-neutral-50 p-1">
        <button type="button" onClick={() => setMode('company')} className={`rounded px-3 py-2 text-[12px] ${mode === 'company' ? 'bg-white font-medium text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>创建公司</button>
        <button type="button" onClick={() => setMode('invite')} className={`rounded px-3 py-2 text-[12px] ${mode === 'invite' ? 'bg-white font-medium text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>接受邀请</button>
      </div>
      <form onSubmit={(event) => { void submit(event); }} className="space-y-4 p-6">
        {mode === 'company' && <Field label="公司名称"><input aria-label="公司名称" value={companyName} onChange={(event) => setCompanyName(event.target.value)} className="hum-input" placeholder="例如：昆仑科技" required /></Field>}
        {mode === 'invite' && <Field label="邀请凭证"><input aria-label="邀请凭证" value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} className="hum-input font-mono" placeholder="粘贴同事发来的邀请凭证" required /></Field>}
        <Field label="你的姓名"><input aria-label="你的姓名" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="hum-input" placeholder="用于协作、审批与审计记录" required /></Field>
        <Field label="邮箱或手机"><input aria-label="邮箱或手机" value={contact} onChange={(event) => setContact(event.target.value)} className="hum-input" placeholder="name@company.com / 138..." required /></Field>
        {error && <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">{error}</div>}
        <button type="submit" disabled={busy} className="hum-btn is-primary w-full justify-center disabled:opacity-50"><KeyRound size={13} />{busy ? '正在验证...' : mode === 'company' ? '创建并进入' : '接受邀请并进入'}</button>
      </form>
      <div className="flex items-center gap-2 border-t border-neutral-200 bg-neutral-50 px-6 py-3 text-[10.5px] text-neutral-500"><ShieldCheck size={12} />{isDesktopIdentity() ? '身份、成员关系与会话凭证保存在本机加密边界内。' : '浏览器原型仅保存本地演示身份，不代表真实企业认证。'}</div>
    </section>
  </main>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-neutral-700">{label}</span>{children}</label>;
}
