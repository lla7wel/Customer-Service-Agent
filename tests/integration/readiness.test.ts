import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { runAllReadinessChecks, checkInstagram, checkFacebookPage, checkWebhookSubscription, checkInsights } from '../../integrations/providers/readiness';
import { createTestDatabase, type TestDb } from './setup';

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('truthful provider readiness (never fake "connected")', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase('eh_ready'); });
  afterAll(async () => { await t.destroy(); });
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    delete process.env.META_PAGE_ACCESS_TOKEN;
    delete process.env.META_PAGE_ID;
    delete process.env.META_IG_USER_ID;
  });

  it('unconfigured channels report NOT ready with exact remediation', async () => {
    const fb = await checkFacebookPage();
    expect(fb.ok).toBe(false);
    expect(String(fb.detail.remediation)).toContain('META_PAGE_ID');

    const ig = await checkInstagram();
    expect(ig.ok).toBe(false);
    expect(ig.summary).toMatch(/Facebook Page/i);
  });

  it('reports a genuinely connected Page with its granted permissions', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page123';
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('me/permissions')) {
        return jsonRes({ data: [{ permission: 'pages_messaging', status: 'granted' }, { permission: 'pages_manage_posts', status: 'granted' }] });
      }
      return jsonRes({ id: 'page123', name: 'English Home Libya' });
    });
    const fb = await checkFacebookPage();
    expect(fb.ok).toBe(true);
    expect(fb.summary).toContain('English Home Libya');
    expect(fb.detail.granted_permissions).toEqual(expect.arrayContaining(['pages_messaging']));
  });

  it('an INVALID token is reported as not ready, never as connected', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'bad';
    process.env.META_PAGE_ID = 'page123';
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async () =>
      jsonRes({ error: { message: 'Invalid OAuth access token', code: 190 } }, 401));
    const fb = await checkFacebookPage();
    expect(fb.ok).toBe(false);
    expect(String(fb.detail.remediation)).toContain('META_PAGE_ACCESS_TOKEN');
  });

  it('Instagram NOT LINKED to the Page is reported truthfully with the fix', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page123';
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async () => jsonRes({ id: 'page123' })); // no instagram_business_account
    const ig = await checkInstagram();
    expect(ig.ok).toBe(false);
    expect(ig.summary).toContain('No Instagram business account');
    expect(String(ig.detail.remediation)).toContain('Link the Instagram');
  });

  it('Instagram linked but META_IG_USER_ID unset tells the owner the exact id to set', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page123';
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async () =>
      jsonRes({ id: 'page123', instagram_business_account: { id: 'ig_999' } }));
    const ig = await checkInstagram();
    expect(ig.ok).toBe(false);
    expect(String(ig.detail.remediation)).toContain('META_IG_USER_ID=ig_999');
  });

  it('a MISMATCHED configured IG id is refused (never silently trusted)', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page123';
    process.env.META_IG_USER_ID = 'ig_wrong';
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async () =>
      jsonRes({ id: 'page123', instagram_business_account: { id: 'ig_999' } }));
    const ig = await checkInstagram();
    expect(ig.ok).toBe(false);
    expect(ig.summary).toContain('does not match');
  });

  it('a fully linked Instagram reports its real capabilities', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page123';
    process.env.META_IG_USER_ID = 'ig_999';
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/ig_999')) return jsonRes({ id: 'ig_999', username: 'englishhome.ly' });
      return jsonRes({ id: 'page123', instagram_business_account: { id: 'ig_999' } });
    });
    const ig = await checkInstagram();
    expect(ig.ok).toBe(true);
    expect(ig.summary).toContain('englishhome.ly');
    expect(ig.detail.capabilities).toEqual(expect.arrayContaining(['feed', 'carousel', 'story', 'comments']));
  });

  it('missing webhook fields are named explicitly', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page123';
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async () =>
      jsonRes({ data: [{ subscribed_fields: ['messages'] }] })); // 'feed' missing
    const hooks = await checkWebhookSubscription();
    expect(hooks.ok).toBe(false);
    expect(hooks.summary).toContain('feed');
    expect(String(hooks.detail.remediation)).toContain('Webhooks');
  });

  it('proves Insights with a real metric response and rejects an empty permission response', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'tok';
    process.env.META_PAGE_ID = 'page123';
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any);
    fetchMock.mockResolvedValueOnce(jsonRes({ data: [] }));
    expect((await checkInsights()).ok).toBe(false);
    fetchMock.mockResolvedValueOnce(jsonRes({ data: [{ name: 'page_post_engagements', values: [{ value: 4 }] }] }));
    expect((await checkInsights()).ok).toBe(true);
  });

  it('persists results WITHOUT leaking any secret', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'super-secret-token-value';
    process.env.META_PAGE_ID = 'page123';
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async () => jsonRes({ id: 'page123', name: 'EH' }));
    await runAllReadinessChecks(t.db);
    const rows = await t.db.selectFrom('provider_readiness').select(['check_key', 'ok', 'summary', 'detail']).execute();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('super-secret-token-value');
  });
});
