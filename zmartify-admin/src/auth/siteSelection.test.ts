import { describe, expect, it } from 'vitest';
import { resolveSiteLandingPath, resolveSiteSelectionPath } from './siteSelection';

const multiProductSite = {
  id: 2,
  uuid: 'site-two',
  products: [
    { type: 'hvac' as const, allowed: true },
    { type: 'irrigation' as const, allowed: true },
  ],
};

describe('resolveSiteSelectionPath', () => {
  it('lands directly on HVAC when the selected site supports it', () => {
    expect(resolveSiteLandingPath(multiProductSite)).toBe('/app/sites/site-two/hvac');
  });

  it('lands directly on irrigation when HVAC is unavailable', () => {
    expect(resolveSiteLandingPath({
      ...multiProductSite,
      products: [{ type: 'irrigation', allowed: true }],
    })).toBe('/app/sites/site-two/irrigation');
  });

  it('preserves an available product route at the newly selected site', () => {
    expect(resolveSiteSelectionPath('/app/sites/site-one/irrigation/programs', multiProductSite))
      .toBe('/app/sites/site-two/irrigation/programs');
  });

  it('falls back to HVAC when the selected site does not expose the current product', () => {
    expect(resolveSiteSelectionPath('/app/sites/site-one/irrigation', {
      ...multiProductSite,
      products: [{ type: 'hvac', allowed: true }, { type: 'irrigation', allowed: false }],
    })).toBe('/app/sites/site-two/hvac');
  });

  it('leaves non-product routes unchanged', () => {
    expect(resolveSiteSelectionPath('/app/sites/site-one/alerts', multiProductSite)).toBeNull();
  });
});