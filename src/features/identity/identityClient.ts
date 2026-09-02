export type MembershipRole = 'owner' | 'admin' | 'member';
export interface AccountRecord { id: string; email: string | null; phone: string | null; displayName: string }
export interface TenantRecord { id: string; name: string; slug: string }
export interface MembershipRecord { id: string; tenantId: string; accountId: string; humanUserId: string; role: MembershipRole }
export interface AuthSessionRecord { id: string; token: string; accountId: string; currentTenantId: string; expiresAt: string }
export interface IdentityContext { account: AccountRecord; tenant: TenantRecord; membership: MembershipRecord; session: AuthSessionRecord }
export interface MemberRecord {
  membershipId: string; accountId: string; humanUserId: string; twinId: string;
  displayName: string; role: MembershipRole; email: string | null; phone: string | null;
}
export interface InvitationRecord {
  id: string; tenantId: string; contactType: 'email' | 'phone'; contactValue: string;
  role: 'admin' | 'member'; status: string; expiresAt: string; token: string;
}
export interface IdentityHost {
  createCompany(input: { companyName: string; displayName: string; email?: string; phone?: string }): Promise<IdentityContext>;
  acceptInvitation(input: { token: string; displayName: string; email?: string; phone?: string }): Promise<IdentityContext>;
  resumeSession(token: string): Promise<IdentityContext>;
  listTenants(token: string): Promise<TenantRecord[]>;
  switchTenant(token: string, tenantId: string): Promise<IdentityContext>;
  listMembers(token: string): Promise<MemberRecord[]>;
  createInvitation(token: string, input: { contactType: 'email' | 'phone'; contactValue: string; role: 'admin' | 'member' }): Promise<InvitationRecord>;
}

const TOKEN_KEY = 'hummer.auth.session';
let currentContext: IdentityContext | null = null;

declare global {
  interface Window { hummerIdentity?: IdentityHost }
}

export function currentIdentity(): IdentityContext | null { return currentContext; }
export function currentSessionToken(): string | null { return currentContext?.session.token ?? readToken(); }
export function isDesktopIdentity(): boolean { return typeof window !== 'undefined' && Boolean(window.hummerIdentity); }

export async function resumeIdentity(): Promise<IdentityContext | null> {
  const token = readToken();
  if (!token) return null;
  try {
    currentContext = window.hummerIdentity ? await window.hummerIdentity.resumeSession(token) : readBrowserContext();
    return currentContext;
  } catch {
    clearIdentity();
    return null;
  }
}

export async function createCompany(input: { companyName: string; displayName: string; email?: string; phone?: string }): Promise<IdentityContext> {
  const context = window.hummerIdentity ? await window.hummerIdentity.createCompany(input) : createBrowserCompany(input);
  remember(context);
  return context;
}

export async function acceptInvitation(input: { token: string; displayName: string; email?: string; phone?: string }): Promise<IdentityContext> {
  if (!window.hummerIdentity) throw new Error('此操作需要 HUMMER 桌面版。');
  const context = await window.hummerIdentity.acceptInvitation(input);
  remember(context);
  return context;
}

export async function listTenants(): Promise<TenantRecord[]> {
  const token = requireToken();
  return window.hummerIdentity ? window.hummerIdentity.listTenants(token) : [requireContext().tenant];
}

export async function switchTenant(tenantId: string): Promise<IdentityContext> {
  const token = requireToken();
  if (!window.hummerIdentity) return requireContext();
  const context = await window.hummerIdentity.switchTenant(token, tenantId);
  remember(context);
  return context;
}

export async function listMembers(): Promise<MemberRecord[]> {
  const token = requireToken();
  if (!window.hummerIdentity) {
    const context = requireContext();
    return [{
      membershipId: context.membership.id, accountId: context.account.id,
      humanUserId: context.membership.humanUserId, twinId: `twin_${context.membership.humanUserId}`,
      displayName: context.account.displayName, role: context.membership.role,
      email: context.account.email, phone: context.account.phone,
    }];
  }
  return window.hummerIdentity.listMembers(token);
}

export async function createInvitation(input: {
  contactType: 'email' | 'phone'; contactValue: string; role: 'admin' | 'member';
}): Promise<InvitationRecord> {
  if (!window.hummerIdentity) throw new Error('此操作需要 HUMMER 桌面版。');
  return window.hummerIdentity.createInvitation(requireToken(), input);
}

export function clearIdentity(): void {
  currentContext = null;
  if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY);
  if (typeof localStorage !== 'undefined') localStorage.removeItem(`${TOKEN_KEY}.browser`);
}

function remember(context: IdentityContext): void {
  currentContext = context;
  localStorage.setItem(TOKEN_KEY, context.session.token);
  if (!window.hummerIdentity) localStorage.setItem(`${TOKEN_KEY}.browser`, JSON.stringify(context));
}
function readToken(): string | null { return typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY); }
function readBrowserContext(): IdentityContext | null {
  const raw = localStorage.getItem(`${TOKEN_KEY}.browser`);
  return raw ? JSON.parse(raw) as IdentityContext : null;
}
function requireToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('当前没有有效的身份会话。');
  return token;
}
function requireContext(): IdentityContext {
  if (!currentContext) throw new Error('当前没有有效的身份会话。');
  return currentContext;
}
function createBrowserCompany(input: { companyName: string; displayName: string; email?: string; phone?: string }): IdentityContext {
  const suffix = Date.now().toString(36);
  const tenantId = `tenant_browser_${suffix}`;
  const accountId = `account_browser_${suffix}`;
  const humanUserId = `human_browser_${suffix}`;
  const token = `browser_${suffix}`;
  return {
    account: { id: accountId, email: input.email ?? null, phone: input.phone ?? null, displayName: input.displayName },
    tenant: { id: tenantId, name: input.companyName, slug: `browser-${suffix}` },
    membership: { id: `membership_browser_${suffix}`, tenantId, accountId, humanUserId, role: 'owner' },
    session: { id: `auth_browser_${suffix}`, token, accountId, currentTenantId: tenantId, expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  };
}
