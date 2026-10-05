import { describe, expect, it } from 'vitest';
import { resolveHome, safeNext } from '../src/routes/resolveHome.ts';
import type { AccessContext, AccessMembership } from '../src/types/db.ts';

const m = (id: string, active = true, status: 'active' | 'suspended' = 'active'): AccessMembership => ({
  organization: { id, code: id, name: id, name_en: null, status, default_locale: 'ar', timezone: 'Asia/Riyadh' },
  active: active && status === 'active', member_active: active, roles: [], permissions: [], modules: {},
});
const access = (o: Partial<AccessContext>): AccessContext => ({ user_id: 'u', is_platform_super_admin: false, profile: null, memberships: [], ...o });

describe('post-login routing rules', () => {
  it('unauthenticated → login', () => expect(resolveHome(null).path).toBe('/login'));
  it('platform super admin → /platform without invitation or organization', () => {
    expect(resolveHome(access({ is_platform_super_admin: true })).path).toBe('/platform');
    expect(resolveHome(access({ is_platform_super_admin: true, memberships: [m('a'), m('b')] })).path).toBe('/platform');
  });
  it('one organization → enter it', () => {
    expect(resolveHome(access({ memberships: [m('a')] }))).toEqual({ kind: 'organization', path: '/app/dashboard', organizationId: 'a' });
  });
  it('multiple organizations → selector after login, stored choice on session restore', () => {
    const a = access({ memberships: [m('a'), m('b')] });
    expect(resolveHome(a, { storedOrgId: 'b', preferStored: false }).path).toBe('/select-organization');
    expect(resolveHome(a, { storedOrgId: 'b', preferStored: true })).toMatchObject({ organizationId: 'b' });
    expect(resolveHome(a, { storedOrgId: 'zzz', preferStored: true }).path).toBe('/select-organization');
  });
  it('no membership → controlled no-access state with reason', () => {
    expect(resolveHome(access({}))).toMatchObject({ path: '/no-access', reason: 'no_membership' });
    expect(resolveHome(access({ memberships: [m('a', false)] }))).toMatchObject({ reason: 'inactive_membership' });
    expect(resolveHome(access({ memberships: [m('a', true, 'suspended')] }))).toMatchObject({ reason: 'organization_suspended' });
  });
  it('inactive memberships are ignored when an active one exists', () => {
    expect(resolveHome(access({ memberships: [m('a', false), m('b')] }))).toMatchObject({ organizationId: 'b' });
  });
  it('only safe relative redirects', () => {
    expect(safeNext('/invite/abc')).toBe('/invite/abc');
    expect(safeNext('//evil.com')).toBeNull();
    expect(safeNext('https://evil.com')).toBeNull();
    expect(safeNext('/login')).toBeNull();
  });
});
