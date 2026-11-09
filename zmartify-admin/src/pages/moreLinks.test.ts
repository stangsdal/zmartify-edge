import { describe, expect, it } from 'vitest';
import { moreSections } from './moreLinks';

const allPaths = (sections: ReturnType<typeof moreSections>) =>
  sections.flatMap((section) => section.links.map((link) => link.path));

describe('moreSections', () => {
  it('shows only personal links to users below owner', () => {
    const sections = moreSections({ canUseOwnerTools: false, isAdministrator: false, hasTopLevelAdminNav: true });
    expect(sections.map((section) => section.title)).toEqual(['Personal']);
    expect(allPaths(sections)).not.toContain('/app/more/controllers');
    expect(allPaths(sections)).not.toContain('/app/more/firmware');
  });

  it('shows owner tools to non-administrator owners on every layout', () => {
    for (const hasTopLevelAdminNav of [true, false]) {
      const sections = moreSections({ canUseOwnerTools: true, isAdministrator: false, hasTopLevelAdminNav });
      expect(sections.map((section) => section.title)).toEqual(['Personal', 'Site management']);
      expect(allPaths(sections)).toContain('/app/more/controllers');
      expect(allPaths(sections)).toContain('/app/more/firmware');
      expect(allPaths(sections)).toContain('/app/more/members');
    }
  });

  it('hides owner and admin sections for administrators when the sidebar shows them as top-level items', () => {
    const sections = moreSections({ canUseOwnerTools: true, isAdministrator: true, hasTopLevelAdminNav: true });
    expect(sections.map((section) => section.title)).toEqual(['Personal']);
  });

  it('gives administrators the full menu on mobile layouts', () => {
    const sections = moreSections({ canUseOwnerTools: true, isAdministrator: true, hasTopLevelAdminNav: false });
    expect(sections.map((section) => section.title)).toEqual(['Personal', 'Site management', 'Platform administration']);
    const paths = allPaths(sections);
    expect(paths).toEqual(expect.arrayContaining([
      '/app/admin/sites',
      '/app/systems',
      '/app/more/users',
      '/app/more/integrations',
      '/app/more/system',
      '/app/admin/audit-log',
      '/app/more/controllers',
      '/app/more/firmware',
      '/app/more/members',
    ]));
    expect(paths.filter((path) => path.includes('firmware'))).toHaveLength(1);
  });
});
