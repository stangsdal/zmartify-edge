import { describe, expect, it } from 'vitest';
import { moreLinks } from './moreLinks';

describe('moreLinks', () => {
  it('hides controller tools from users below owner', () => {
    const paths = moreLinks(false, false).map((link) => link.path);
    expect(paths).not.toContain('/app/onboarding/discover');
    expect(paths).not.toContain('/app/firmware/index.html');
    expect(paths).not.toContain('/app/firmware/ahc9000/index.html');
  });

  it.each([
    ['owner', true, false],
    ['administrator', true, true],
  ])('shows controller tools to %s', (_role, canUseOwnerTools, isAdministrator) => {
    const links = moreLinks(canUseOwnerTools, isAdministrator);
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/app/onboarding/discover' }),
      expect.objectContaining({ path: '/app/firmware/index.html', document: true }),
      expect.objectContaining({ path: '/app/firmware/ahc9000/index.html', document: true }),
    ]));
  });
});