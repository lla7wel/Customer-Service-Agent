import { describe, it, expect } from 'vitest';
import {
  ROLES, canAccessSection, sectionsForRole, canAccessPath, sectionForPath,
  apiAccessRoles, canCallApi, canManageAdmins, landingPath, normalizeRole, isRole,
  type Role, type Section,
} from '../../admin-app/src/lib/rbac';
import { navForRole } from '../../admin-app/src/lib/nav';

// The authorization contract, stated once as a table so the tests read as the
// spec: which role may enter which section.
const EXPECTED: Record<Role, Section[]> = {
  owner: ['dashboard', 'analytics', 'inbox', 'catalog', 'content-studio', 'ai-control', 'settings'],
  analyzer: ['analytics', 'inbox', 'content-studio'],
  poster: ['content-studio'],
  messager: ['inbox', 'content-studio'],
};

const ALL_SECTIONS: Section[] = ['dashboard', 'analytics', 'inbox', 'catalog', 'content-studio', 'ai-control', 'settings'];

describe('RBAC capability matrix — section access', () => {
  for (const role of ROLES) {
    it(`${role} sees exactly its allowed sections`, () => {
      expect(sectionsForRole(role).sort()).toEqual([...EXPECTED[role]].sort());
      for (const section of ALL_SECTIONS) {
        expect(canAccessSection(role, section)).toBe(EXPECTED[role].includes(section));
      }
    });
  }

  it('landing pages match each role', () => {
    expect(landingPath('owner')).toBe('/dashboard');
    expect(landingPath('analyzer')).toBe('/analytics');
    expect(landingPath('poster')).toBe('/content-studio');
    expect(landingPath('messager')).toBe('/inbox');
  });
});

describe('RBAC — page path → section, direct URL access', () => {
  it('maps paths (and nested paths) to sections', () => {
    expect(sectionForPath('/')).toBe('dashboard');
    expect(sectionForPath('/dashboard')).toBe('dashboard');
    expect(sectionForPath('/analytics')).toBe('analytics');
    expect(sectionForPath('/inbox/123')).toBe('inbox');
    expect(sectionForPath('/catalog/abc')).toBe('catalog');
    expect(sectionForPath('/content-studio/x')).toBe('content-studio');
    expect(sectionForPath('/ai-control')).toBe('ai-control');
    expect(sectionForPath('/ai-playground')).toBe('ai-control');
    expect(sectionForPath('/settings')).toBe('settings');
    expect(sectionForPath('/profile')).toBeNull(); // ungated
  });

  it('blocks each role from forbidden pages (direct URL) and allows permitted ones', () => {
    // Messager cannot reach the owner-only dashboard/catalog/settings/analytics by URL.
    expect(canAccessPath('messager', '/dashboard')).toBe(false);
    expect(canAccessPath('messager', '/catalog/xyz')).toBe(false);
    expect(canAccessPath('messager', '/settings')).toBe(false);
    expect(canAccessPath('messager', '/analytics')).toBe(false);
    expect(canAccessPath('messager', '/inbox/9')).toBe(true);
    expect(canAccessPath('messager', '/content-studio')).toBe(true);

    // Poster only Content Studio.
    expect(canAccessPath('poster', '/inbox')).toBe(false);
    expect(canAccessPath('poster', '/analytics')).toBe(false);
    expect(canAccessPath('poster', '/content-studio/1')).toBe(true);

    // Analyzer: analytics + inbox + content, not dashboard/catalog/settings/ai-control.
    expect(canAccessPath('analyzer', '/analytics')).toBe(true);
    expect(canAccessPath('analyzer', '/inbox')).toBe(true);
    expect(canAccessPath('analyzer', '/dashboard')).toBe(false);
    expect(canAccessPath('analyzer', '/ai-control')).toBe(false);

    // Owner: everything.
    for (const s of ALL_SECTIONS) expect(canAccessPath('owner', `/${s === 'content-studio' ? 'content-studio' : s}`)).toBe(true);
  });
});

describe('RBAC — API authorization (method-aware, shared reads)', () => {
  it('owner-only APIs reject non-owners', () => {
    for (const p of ['/api/admins', '/api/admins/abc', '/api/settings/channels', '/api/ai/behaviors', '/api/dashboard', '/api/imports']) {
      expect(apiAccessRoles(p, 'GET')).toEqual(['owner']);
      expect(canCallApi('owner', p, 'GET')).toBe(true);
      expect(canCallApi('analyzer', p, 'GET')).toBe(false);
      expect(canCallApi('poster', p, 'POST')).toBe(false);
      expect(canCallApi('messager', p, 'GET')).toBe(false);
    }
  });

  it('analytics API is owner + analyzer only', () => {
    expect(canCallApi('owner', '/api/analytics', 'GET')).toBe(true);
    expect(canCallApi('analyzer', '/api/analytics', 'GET')).toBe(true);
    expect(canCallApi('poster', '/api/analytics', 'GET')).toBe(false);
    expect(canCallApi('messager', '/api/analytics', 'GET')).toBe(false);
  });

  it('inbox API excludes poster', () => {
    expect(canCallApi('messager', '/api/inbox/1/reply', 'POST')).toBe(true);
    expect(canCallApi('analyzer', '/api/inbox/1', 'GET')).toBe(true);
    expect(canCallApi('poster', '/api/inbox/1', 'GET')).toBe(false);
  });

  it('product reads are shared cross-section; product writes are owner-only', () => {
    // Read (needed by Inbox + Content Studio product pickers): any admin.
    for (const role of ROLES) {
      expect(canCallApi(role, '/api/products/search', 'GET')).toBe(true);
      expect(canCallApi(role, '/api/products/abc', 'GET')).toBe(true);
    }
    // Write (price/family/replace): owner only.
    expect(canCallApi('owner', '/api/products/abc/price', 'PATCH')).toBe(true);
    expect(canCallApi('poster', '/api/products/abc/price', 'PATCH')).toBe(false);
    expect(canCallApi('messager', '/api/products/abc', 'DELETE')).toBe(false);
  });

  it('global search is available to any admin (results filtered in-route)', () => {
    for (const role of ROLES) expect(canCallApi(role, '/api/search', 'GET')).toBe(true);
  });
});

describe('RBAC — role-aware navigation', () => {
  it('nav groups reflect each role', () => {
    const hrefs = (role: Role) => navForRole(role).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs('owner')).toEqual(['/dashboard', '/analytics', '/inbox', '/catalog', '/content-studio', '/ai-control', '/settings']);
    expect(hrefs('analyzer')).toEqual(['/analytics', '/inbox', '/content-studio']);
    expect(hrefs('poster')).toEqual(['/content-studio']);
    expect(hrefs('messager')).toEqual(['/inbox', '/content-studio']);
  });
});

describe('RBAC — helpers & fail-safe defaults', () => {
  it('only the owner manages admins', () => {
    expect(canManageAdmins('owner')).toBe(true);
    for (const role of ['analyzer', 'poster', 'messager'] as Role[]) expect(canManageAdmins(role)).toBe(false);
  });

  it('normalizeRole falls to least privilege for legacy/unknown values', () => {
    expect(normalizeRole('admin')).toBe('messager'); // legacy value
    expect(normalizeRole(null)).toBe('messager');
    expect(normalizeRole('owner')).toBe('owner');
    expect(isRole('owner')).toBe(true);
    expect(isRole('admin')).toBe(false);
  });
});
