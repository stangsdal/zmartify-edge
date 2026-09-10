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
    const ids = navigationForLayout(context({ hasHvac: true }), 'mobile').map((item) => item.id);
    expect(ids).toEqual(['home', 'single-hvac', 'alerts', 'more']);
  });

  it('uses Systems and Insights instead of direct product tabs for multi-product mobile sites', () => {
    const ids = navigationForLayout(context({ hasHvac: true, hasIrrigation: true }), 'mobile').map((item) => item.id);
    expect(ids).toEqual(['home', 'systems', 'insights', 'alerts', 'more']);
  });

  it('keeps unauthorized products out of the desktop navigation', () => {
    const ids = navigationForLayout(context({ hasHvac: true }), 'desktop').map((item) => item.id);
    expect(ids).toContain('hvac');
    expect(ids).not.toContain('irrigation');
  });

  it.each([
    ['/app/sites/site-one', 'home'],
    ['/app/sites/site-one/hvac', 'single-hvac'],
    ['/app/sites/site-one/alerts', 'alerts'],
    ['/app/more', 'more'],
  ])('selects only the matching mobile item for %s', (pathname, expectedId) => {
    const items = navigationForLayout(context({ hasHvac: true }), 'mobile');

    expect(activeNavigationItemId(pathname, items)).toBe(expectedId);
  });

  it('selects the most specific matching desktop item', () => {
    const items = navigationForLayout(context({ isAdministrator: true }), 'desktop');

    expect(activeNavigationItemId('/app/more/controllers', items)).toBe('devices');
  });

  it('keeps More active for nested tools without a dedicated mobile item', () => {
    const items = navigationForLayout(context({ isAdministrator: true }), 'mobile');

    expect(activeNavigationItemId('/app/more/controllers', items)).toBe('more');
  });
});