import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DomainEventStore } from './domain-event-store.js';
import { ApprovalPolicyStore } from './approval-policy-store.js';
import type { SqliteDatabase } from './sqlite.js';

export type MembershipRole = 'owner' | 'admin' | 'member';
export interface AccountRecord { id: string; email: string | null; phone: string | null; displayName: string }
export interface TenantRecord { id: string; name: string; slug: string }
export interface MembershipRecord { id: string; tenantId: string; accountId: string; humanUserId: string; role: MembershipRole }
export interface AuthSessionRecord { id: string; token: string; accountId: string; currentTenantId: string; expiresAt: string }
export interface IdentityContext { account: AccountRecord; tenant: TenantRecord; membership: MembershipRecord; session: AuthSessionRecord }
export interface CreateCompanyInput { companyName: string; displayName: string; email?: string; phone?: string }
export interface InvitationRecord {
  id: string; tenantId: string; contactType: 'email' | 'phone'; contactValue: string;
  role: Exclude<MembershipRole, 'owner'>; status: string; expiresAt: string; token: string;
}
export interface MemberRecord {
  membershipId: string; accountId: string; humanUserId: string; twinId: string;
  displayName: string; role: MembershipRole; email: string | null; phone: string | null;
}

interface AccountRow { id: string; email: string | null; phone: string | null; display_name: string }
interface TenantRow { id: string; name: string; slug: string }
interface MembershipRow { id: string; tenant_id: string; account_id: string; human_user_id: string; role: MembershipRole }
interface SessionRow { id: string; account_id: string; current_tenant_id: string; expires_at: string }
interface InvitationRow {
  id: string; tenant_id: string; contact_type: 'email' | 'phone'; contact_value: string;
  role: Exclude<MembershipRole, 'owner'>; status: string; expires_at: string;
}
interface MemberRow extends MembershipRow {
  display_name: string; email: string | null; phone: string | null; twin_id: string;
}

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export class IdentityStore {
  private readonly events: DomainEventStore;
  private readonly policies: ApprovalPolicyStore;

  constructor(private readonly database: SqliteDatabase, private readonly now: () => Date = () => new Date()) {
    this.events = new DomainEventStore(database);
    this.policies = new ApprovalPolicyStore(database);
  }

  createCompany(input: CreateCompanyInput): IdentityContext {
    validateIdentity(input.displayName, input.email, input.phone);
    if (!input.companyName.trim()) throw new TypeError('Company name is required');
    const token = randomToken();
    return this.database.transaction(() => {
      const now = this.now().toISOString();
      const account = this.findOrCreateAccount(input.displayName, input.email, input.phone, now);
      const tenant = { id: prefixedId('tenant'), name: input.companyName.trim(), slug: `${slugify(input.companyName)}-${randomUUID().slice(0, 8)}` };
      this.database.prepare(`
        INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `).run(tenant.id, tenant.name, tenant.slug, now, now);
      const membership = this.createMembership(tenant.id, account, 'owner', now);
      this.policies.ensureDefaults(tenant.id, `account:${account.id}`);
      const session = this.insertSession(account.id, tenant.id, token, now);
      this.events.append({
        id: prefixedId('evt'), tenantId: tenant.id, aggregateType: 'tenant', aggregateId: tenant.id,
        type: 'tenant.created', occurredAt: now, actorRef: `account:${account.id}`,
        correlationId: `corr_${tenant.id}`, payload: { accountId: account.id, companyName: tenant.name, role: 'owner' },
      });
      return { account, tenant, membership, session };
    })();
  }

  createInvitation(sessionToken: string, input: {
    contactType: 'email' | 'phone'; contactValue: string; role: Exclude<MembershipRole, 'owner'>;
  }): InvitationRecord {
    const context = this.resumeSession(sessionToken);
    if (context.membership.role === 'member') throw new Error('Only owners and admins may invite members');
    const token = randomToken();
    const now = this.now();
    const invitation: InvitationRecord = {
      id: prefixedId('inv'), tenantId: context.tenant.id, contactType: input.contactType,
      contactValue: normalizeContact(input.contactType, input.contactValue), role: input.role, status: 'pending',
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS).toISOString(), token,
    };
    this.database.prepare(`
      INSERT INTO invitations (
        id, tenant_id, contact_type, contact_value, role, token_hash, status,
        invited_by_account_id, accepted_by_account_id, expires_at, created_at, accepted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?, NULL)
    `).run(
      invitation.id, invitation.tenantId, invitation.contactType, invitation.contactValue,
      invitation.role, digest(token), context.account.id, invitation.expiresAt, now.toISOString(),
    );
    this.events.append({
      id: prefixedId('evt'), tenantId: context.tenant.id, aggregateType: 'invitation', aggregateId: invitation.id,
      type: 'invitation.created', occurredAt: now.toISOString(), actorRef: `account:${context.account.id}`,
      correlationId: `corr_${invitation.id}`, payload: { contactType: input.contactType, role: input.role },
    });
    return invitation;
  }

  acceptInvitation(input: { token: string; displayName: string; email?: string; phone?: string }): IdentityContext {
    validateIdentity(input.displayName, input.email, input.phone);
    const sessionToken = randomToken();
    return this.database.transaction(() => {
      const invitation = this.database.prepare(`
        SELECT id, tenant_id, contact_type, contact_value, role, status, expires_at
        FROM invitations WHERE token_hash = ?
      `).get<InvitationRow>(digest(input.token));
      if (!invitation || invitation.status !== 'pending') throw new Error('Invitation is invalid or already used');
      const now = this.now();
      if (Date.parse(invitation.expires_at) <= now.getTime()) throw new Error('Invitation has expired');
      const suppliedContact = invitation.contact_type === 'email' ? input.email : input.phone;
      if (!suppliedContact || normalizeContact(invitation.contact_type, suppliedContact) !== invitation.contact_value) {
        throw new Error('Invitation contact does not match');
      }
      const account = this.findOrCreateAccount(input.displayName, input.email, input.phone, now.toISOString());
      const tenant = this.requireTenant(invitation.tenant_id);
      const membership = this.createMembership(tenant.id, account, invitation.role, now.toISOString());
      const session = this.insertSession(account.id, tenant.id, sessionToken, now.toISOString());
      this.database.prepare(`
        UPDATE invitations SET status = 'accepted', accepted_by_account_id = ?, accepted_at = ? WHERE id = ?
      `).run(account.id, now.toISOString(), invitation.id);
      this.events.append({
        id: prefixedId('evt'), tenantId: tenant.id, aggregateType: 'invitation', aggregateId: invitation.id,
        type: 'invitation.accepted', occurredAt: now.toISOString(), actorRef: `account:${account.id}`,
        correlationId: `corr_${invitation.id}`, payload: { accountId: account.id, membershipId: membership.id },
      });
      return { account, tenant, membership, session };
    })();
  }

  resumeSession(token: string): IdentityContext {
    const row = this.database.prepare(`
      SELECT id, account_id, current_tenant_id, expires_at FROM sessions_auth
      WHERE token_hash = ? AND status = 'active'
    `).get<SessionRow>(digest(token));
    if (!row || Date.parse(row.expires_at) <= this.now().getTime()) throw new Error('Authentication session is invalid or expired');
    const account = this.requireAccount(row.account_id);
    const tenant = this.requireTenant(row.current_tenant_id);
    const membership = this.requireMembership(row.account_id, row.current_tenant_id);
    this.database.prepare('UPDATE sessions_auth SET last_seen_at = ? WHERE id = ?').run(this.now().toISOString(), row.id);
    return {
      account, tenant, membership,
      session: { id: row.id, token, accountId: row.account_id, currentTenantId: row.current_tenant_id, expiresAt: row.expires_at },
    };
  }

  switchTenant(token: string, tenantId: string): IdentityContext {
    const context = this.resumeSession(token);
    this.requireMembership(context.account.id, tenantId);
    this.database.prepare('UPDATE sessions_auth SET current_tenant_id = ?, last_seen_at = ? WHERE id = ?')
      .run(tenantId, this.now().toISOString(), context.session.id);
    return this.resumeSession(token);
  }

  currentTenantId(token: string): string { return this.resumeSession(token).tenant.id; }
  currentActorRef(token: string): string { return `account:${this.resumeSession(token).account.id}`; }

  listTenants(token: string): TenantRecord[] {
    const context = this.resumeSession(token);
    return this.database.prepare(`
      SELECT t.id, t.name, t.slug FROM tenants t
      JOIN memberships m ON m.tenant_id = t.id
      WHERE m.account_id = ? AND m.status = 'active' AND t.status = 'active'
      ORDER BY t.created_at, t.id
    `).all<TenantRow>(context.account.id).map(mapTenant);
  }

  listMembers(token: string): MemberRecord[] {
    const tenantId = this.currentTenantId(token);
    return this.database.prepare(`
      SELECT m.id, m.tenant_id, m.account_id, m.human_user_id, m.role,
        a.display_name, a.email, a.phone, dt.id AS twin_id
      FROM memberships m
      JOIN accounts a ON a.id = m.account_id
      JOIN digital_twins dt ON dt.tenant_id = m.tenant_id AND dt.owner_human_id = m.human_user_id AND dt.status = 'active'
      WHERE m.tenant_id = ? AND m.status = 'active'
      ORDER BY m.created_at, m.id
    `).all<MemberRow>(tenantId).map((row) => ({
      membershipId: row.id, accountId: row.account_id, humanUserId: row.human_user_id,
      twinId: row.twin_id, displayName: row.display_name, role: row.role, email: row.email, phone: row.phone,
    }));
  }

  listActiveTwins(token: string, humanUserId: string): Array<{ id: string; name: string }> {
    const tenantId = this.currentTenantId(token);
    return this.database.prepare(`
      SELECT id, name FROM digital_twins WHERE tenant_id = ? AND owner_human_id = ? AND status = 'active'
    `).all<{ id: string; name: string }>(tenantId, humanUserId);
  }

  createTwinForHuman(token: string, humanUserId: string, name: string): { id: string; name: string } {
    const tenantId = this.currentTenantId(token);
    const human = this.database.prepare('SELECT id FROM human_users WHERE id = ? AND tenant_id = ? AND status = ?')
      .get<{ id: string }>(humanUserId, tenantId, 'active');
    if (!human) throw new Error('Human user is not in the current tenant');
    try {
      return this.insertTwin(tenantId, humanUserId, name, this.now().toISOString());
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) throw new Error('One active twin is allowed per human');
      throw error;
    }
  }

  resolveActor(token: string, actorRef: string): { accountId: string; displayName: string } | undefined {
    const tenantId = this.currentTenantId(token);
    const accountId = actorRef.startsWith('account:') ? actorRef.slice('account:'.length) : '';
    if (accountId) {
      const row = this.database.prepare(`
        SELECT a.id AS account_id, a.display_name FROM memberships m
        JOIN accounts a ON a.id = m.account_id
        WHERE m.tenant_id = ? AND m.account_id = ? AND m.status = 'active'
      `).get<{ account_id: string; display_name: string }>(tenantId, accountId);
      return row ? { accountId: row.account_id, displayName: row.display_name } : undefined;
    }
    const humanUserId = actorRef.startsWith('human:') ? actorRef.slice('human:'.length) : '';
    if (!humanUserId) return undefined;
    const row = this.database.prepare(`
      SELECT a.id AS account_id, a.display_name FROM memberships m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.tenant_id = ? AND m.human_user_id = ? AND m.status = 'active'
    `).get<{ account_id: string; display_name: string }>(tenantId, humanUserId);
    return row ? { accountId: row.account_id, displayName: row.display_name } : undefined;
  }
  private findOrCreateAccount(displayName: string, email: string | undefined, phone: string | undefined, now: string): AccountRecord {
    const normalizedEmail = email ? normalizeContact('email', email) : null;
    const normalizedPhone = phone ? normalizeContact('phone', phone) : null;
    const existing = normalizedEmail
      ? this.database.prepare('SELECT id, email, phone, display_name FROM accounts WHERE email = ?').get<AccountRow>(normalizedEmail)
      : this.database.prepare('SELECT id, email, phone, display_name FROM accounts WHERE phone = ?').get<AccountRow>(normalizedPhone);
    if (existing) return mapAccount(existing);
    const account = { id: prefixedId('account'), email: normalizedEmail, phone: normalizedPhone, displayName: displayName.trim() };
    this.database.prepare(`
      INSERT INTO accounts (id, email, phone, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(account.id, account.email, account.phone, account.displayName, now, now);
    return account;
  }

  private createMembership(tenantId: string, account: AccountRecord, role: MembershipRole, now: string): MembershipRecord {
    const humanUserId = prefixedId('human');
    this.database.prepare(`
      INSERT INTO human_users (id, tenant_id, display_name, role, status, created_at, updated_at, account_id)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(humanUserId, tenantId, account.displayName, role, now, now, account.id);
    const membership = { id: prefixedId('membership'), tenantId, accountId: account.id, humanUserId, role };
    this.database.prepare(`
      INSERT INTO memberships (id, tenant_id, account_id, human_user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(membership.id, tenantId, account.id, humanUserId, role, now, now);
    this.insertTwin(tenantId, humanUserId, `${account.displayName}的分身`, now);
    return membership;
  }

  private insertTwin(tenantId: string, humanUserId: string, name: string, now: string): { id: string; name: string } {
    const twin = { id: prefixedId('twin'), name: name.trim() };
    this.database.prepare(`
      INSERT INTO digital_twins (id, tenant_id, owner_human_id, department_id, name, authority_level, status, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, 'delegated', 'active', ?, ?)
    `).run(twin.id, tenantId, humanUserId, twin.name, now, now);
    return twin;
  }

  private insertSession(accountId: string, tenantId: string, token: string, now: string): AuthSessionRecord {
    const session = {
      id: prefixedId('auth'), token, accountId, currentTenantId: tenantId,
      expiresAt: new Date(Date.parse(now) + SESSION_LIFETIME_MS).toISOString(),
    };
    this.database.prepare(`
      INSERT INTO sessions_auth (id, account_id, current_tenant_id, token_hash, status, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(session.id, accountId, tenantId, digest(token), now, now, session.expiresAt);
    return session;
  }

  private requireAccount(id: string): AccountRecord {
    const row = this.database.prepare('SELECT id, email, phone, display_name FROM accounts WHERE id = ? AND status = ?')
      .get<AccountRow>(id, 'active');
    if (!row) throw new Error('Account is unavailable');
    return mapAccount(row);
  }

  private requireTenant(id: string): TenantRecord {
    const row = this.database.prepare('SELECT id, name, slug FROM tenants WHERE id = ? AND status = ?')
      .get<TenantRow>(id, 'active');
    if (!row) throw new Error('Tenant is unavailable');
    return mapTenant(row);
  }

  private requireMembership(accountId: string, tenantId: string): MembershipRecord {
    const row = this.database.prepare(`
      SELECT id, tenant_id, account_id, human_user_id, role FROM memberships
      WHERE account_id = ? AND tenant_id = ? AND status = 'active'
    `).get<MembershipRow>(accountId, tenantId);
    if (!row) throw new Error('Account is not a member of this tenant');
    return mapMembership(row);
  }
}

function validateIdentity(displayName: string, email?: string, phone?: string): void {
  if (!displayName.trim()) throw new TypeError('Display name is required');
  if (!email && !phone) throw new TypeError('Email or phone is required');
}
function normalizeContact(type: 'email' | 'phone', value: string): string {
  const normalized = type === 'email' ? value.trim().toLowerCase() : value.replace(/\s+/g, '');
  if (!normalized) throw new TypeError(`${type} is required`);
  return normalized;
}
function randomToken(): string { return randomBytes(32).toString('base64url'); }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function prefixedId(prefix: string): string { return `${prefix}_${randomUUID().replaceAll('-', '')}`; }
function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'company';
}
function mapAccount(row: AccountRow): AccountRecord { return { id: row.id, email: row.email, phone: row.phone, displayName: row.display_name }; }
function mapTenant(row: TenantRow): TenantRecord { return { id: row.id, name: row.name, slug: row.slug }; }
function mapMembership(row: MembershipRow): MembershipRecord {
  return { id: row.id, tenantId: row.tenant_id, accountId: row.account_id, humanUserId: row.human_user_id, role: row.role };
}
