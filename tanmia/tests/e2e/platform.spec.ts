import { expect, test, type Page } from '@playwright/test';
import { createUser, fn, rest, token } from './api.ts';

const PW = 'E2e-Passw0rd-2026';
const run = Date.now().toString(36);
const OWNER = 'owner@tanmia.test'; // created and promoted by scripts/e2e/run.sh
const ADMIN_A = `admin.a.${run}@tanmia.test`;
const state: { inviteLink?: string; programUrl?: string } = {};

async function english(page: Page) {
  await page.addInitScript(() => localStorage.setItem('tanmia.locale', 'en'));
}
async function login(page: Page, email: string, password = PW) {
  await english(page);
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (password === PW || password === process.env.E2E_OWNER_PASSWORD) await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
}
const field = (page: Page, label: string) => page.locator('.field', { has: page.locator(`label:text-is("${label}")`) }).locator('input, select, textarea').first();

test.describe.serial('TANMIA end-to-end', () => {
  test('unauthenticated users are sent to login', async ({ page }) => {
    await english(page);
    await page.goto('/app/dashboard');
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('wrong password shows a localized error', async ({ page }) => {
    await login(page, OWNER, 'wrong-password-x');
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
  });

  test('platform owner goes straight to Platform Administration and the session survives reload', async ({ page }) => {
    await login(page, OWNER, process.env.E2E_OWNER_PASSWORD ?? PW);
    await expect(page).toHaveURL(/\/platform$/);
    await expect(page.getByText('Platform administration').first()).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/platform$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/platform$/);
  });

  test('owner creates an organization with an initial admin from Platform Administration', async ({ page }) => {
    await login(page, OWNER, process.env.E2E_OWNER_PASSWORD ?? PW);
    await page.goto('/platform/organizations');
    await page.getByRole('button', { name: 'Create organization' }).first().click();
    const dlg = page.getByRole('dialog');
    await field(page, 'Name (Arabic)').fill(`مؤسسة الاختبار ${run}`);
    await field(page, 'Name (English)').fill(`E2E Org ${run}`);
    const invite = dlg.getByText('Invite the first organization admin now (recommended)');
    if (!(await dlg.locator('label.check input').first().isChecked())) await invite.click();
    await field(page, 'Admin email').fill(ADMIN_A);
    await field(page, 'Admin full name').fill('Admin A');
    await dlg.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Organization created')).toBeVisible({ timeout: 20_000 });
    const link = await page.locator('input[readonly]').first().inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{30,}/);
    state.inviteLink = link;
  });

  test('invited admin creates an account from the invitation (separate workflow) and enters the organization', async ({ page }) => {
    test.skip(!state.inviteLink);
    await english(page);
    await page.goto(new URL(state.inviteLink!).pathname);
    await expect(page.getByText(`E2E Org ${run}`)).toBeVisible();
    await page.getByRole('button', { name: 'Create an account with the invited email' }).click();
    await page.locator('.field', { hasText: 'Full name' }).locator('input').fill('Admin A');
    await page.locator('.field', { hasText: 'Invited email' }).locator('input').fill(ADMIN_A);
    await page.locator('.field', { hasText: 'Password' }).locator('input').fill(PW);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Accept invitation and join' }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/, { timeout: 20_000 });
    await expect(page.locator('nav.nav').getByText('Programs', { exact: true })).toBeVisible();
  });

  test('organization admin creates a graduate program and sees the interactive journey', async ({ page }) => {
    await login(page, ADMIN_A);
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await page.goto('/app/programs/new');
    await page.getByRole('heading', { name: 'Graduate development program' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('#fld-name').fill(`Graduates ${run}`);
    await page.locator('#fld-start_date').fill('2026-09-01');
    await page.locator('#fld-end_date').fill('2027-06-30');
    await page.locator('#fld-target_beneficiaries').fill('25');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Create program' }).click();
    await page.waitForURL(/\/app\/programs\/[0-9a-f-]{36}\/overview|Program created/, { timeout: 30_000 }).catch(() => undefined);
    if (!/\/overview/.test(page.url())) await page.getByRole('button', { name: 'Open program' }).click();
    await expect(page).toHaveURL(/\/overview/);
    state.programUrl = page.url().replace(/\/overview.*$/, '');
    await page.goto(`${state.programUrl}/journey`);
    await expect(page.locator('.j-stage')).toHaveCount(21, { timeout: 20_000 });
    await expect(page.locator('.j-stage.locked').first()).toBeVisible();
  });

  test('a second organization cannot see the first organization’s program (RLS)', async ({ page }) => {
    test.skip(!state.programUrl);
    const ownerTok = await token(OWNER, process.env.E2E_OWNER_PASSWORD ?? PW);
    const [orgB] = await rest(ownerTok, 'organizations', { method: 'POST', body: { name: `Org B ${run}`, name_en: `Org B ${run}` } });
    const emailB = `admin.b.${run}@tanmia.test`;
    const uidB = await createUser(emailB, PW, 'Admin B');
    await rest(ownerTok, 'organization_members', { method: 'POST', body: { organization_id: orgB.id, user_id: uidB } });
    const [roleB] = await rest(ownerTok, `roles?organization_id=eq.${orgB.id}&code=eq.org_admin&select=id`);
    await rest(ownerTok, 'user_roles', { method: 'POST', body: { organization_id: orgB.id, user_id: uidB, role_id: roleB.id } });
    const tokB = await token(emailB, PW);
    const programId = state.programUrl!.split('/').pop();
    expect(await rest(tokB, `programs?id=eq.${programId}`)).toEqual([]);
    await login(page, emailB);
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await page.goto(`/app/programs/${programId}/overview`);
    await expect(page.getByText(/not found|not accessible|Could not load/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('user with several organizations gets the selector; user with none gets a controlled no-access state', async ({ page, browser }) => {
    const ownerTok = await token(OWNER, process.env.E2E_OWNER_PASSWORD ?? PW);
    const orgs = await rest(ownerTok, 'organizations?select=id&limit=2');
    const multi = `multi.${run}@tanmia.test`;
    const uid = await createUser(multi, PW, 'Multi');
    for (const o of orgs) await rest(ownerTok, 'organization_members', { method: 'POST', body: { organization_id: o.id, user_id: uid } });
    await login(page, multi);
    await expect(page).toHaveURL(/\/select-organization/);
    await page.locator('button.card').first().click();
    await expect(page).toHaveURL(/\/app\/dashboard/);

    const lonely = `lonely.${run}@tanmia.test`;
    await createUser(lonely, PW, 'Lonely');
    const p2 = await (await browser.newContext()).newPage();
    await login(p2, lonely);
    await expect(p2).toHaveURL(/\/no-access\?reason=no_membership/);
    await expect(p2.getByText('No organization access')).toBeVisible();
  });

  test('Arabic RTL is the default and English switches to LTR', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('Edge Function authorization: non-owner cannot create organizations', async () => {
    const tokA = await token(ADMIN_A, PW);
    await expect(fn(tokA, 'admin-create-organization', { name: 'rogue' })).rejects.toThrow(/403/);
  });
});

test('visual snapshots (Arabic RTL)', async ({ page }) => {
  const dir = process.env.SCREENSHOT_DIR;
  test.skip(!dir || !state.programUrl);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.locator('#email').fill(ADMIN_A);
  await page.locator('#password').fill(PW);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/app\//);
  for (const tab of ['journey', 'overview', 'impact']) {
    await page.goto(`${state.programUrl}/${tab}`);
    await page.waitForTimeout(2500);
    if (tab === 'journey') await page.locator('.j-stage').first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/program-${tab}.png`, fullPage: false });
  }
});
