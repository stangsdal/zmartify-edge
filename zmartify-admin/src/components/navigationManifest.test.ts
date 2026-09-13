import { describe, expect, it } from 'vitest';
import { activeNavigationItemId, navigationForLayout, type NavigationContext } from './navigationManifest';

const context = (overrides: Partial<NavigationContext> = {}): NavigationContext => ({
  appBase: '/app',
  siteBase: '/app/sites/site-one',
  isAdministrator: false,
  hasHvac: false,
  hasIrrigation: false,
  ...overrides,
});

describe('navigation manifest', () => {
  it('uses direct product navigation for a single-product mobile site', () => {
    const items = navigationForLayout(context({ hasHvac: true }), 'mobile');
    expect(items.map((item) => item.id)).toEqual(['hvac', 'alerts', 'more']);
    expect(items[0]).toMatchObject({ label: 'Home', path: '/app/sites/site-one/hvac' });
  });

  it('keeps Home alongside Systems and Insights for multi-product mobile sites', () => {
    const ids = navigationForLayout(context({ hasHvac: true, hasIrrigation: true }), 'mobile').map((item) => item.id);
    expect(ids).toEqual(['hvac', 'systems', 'insights', 'alerts', 'more']);
  });

  it('keeps unauthorized products out of the desktop navigation', () => {
    const ids = navigationForLayout(context({ hasHvac: true }), 'desktop').map((item) => item.id);
    expect(ids).toContain('hvac');
    expect(ids).not.toContain('irrigation');
  });

  it('keeps automation shortcuts out of administrator navigation', () => {
    const ids = navigationForLayout(context({ isAdministrator: true, hasHvac: true, hasIrrigation: true }), 'desktop')
      .map((item) => item.id);

    expect(ids).toContain('irrigation');
    expect(ids).not.toContain('automations');
  });

  it('keeps Irrigation active while managing programs', () => {
    const items = navigationForLayout(context({ hasIrrigation: true }), 'desktop');

    expect(activeNavigationItemId('/app/sites/site-one/irrigation/programs', items)).toBe('irrigation');
  });

  it.each([
    ['/app/sites/site-one/hvac', 'hvac'],
    ['/app/sites/site-one/hvac/zones', 'hvac'],
    ['/app/sites/site-one/alerts', 'alerts'],
    ['/app/more', 'more'],
  ])('selects only the matching mobile item for %s', (pathname, expectedId) => {
    const items = navigationForLayout(context({ hasHvac: true }), 'mobile');

    expect(activeNavigationItemId(pathname, items)).toBe(expectedId);
  });

  it('keeps More active for nested desktop tools', () => {
    const items = navigationForLayout(context({ isAdministrator: true }), 'desktop');

    expect(activeNavigationItemId('/app/more/controllers', items)).toBe('more');
  });

  it('keeps More active for nested tools without a dedicated mobile item', () => {
    const items = navigationForLayout(context({ isAdministrator: true }), 'mobile');

    expect(activeNavigationItemId('/app/more/controllers', items)).toBe('more');
  });
});