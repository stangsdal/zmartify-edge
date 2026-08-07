import { describe, expect, it } from 'vitest';
import { navigationForLayout, type NavigationContext } from './navigationManifest';

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
});