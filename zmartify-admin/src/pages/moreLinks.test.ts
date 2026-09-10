import { describe, expect, it } from 'vitest';
import { moreLinks } from './moreLinks';

describe('moreLinks', () => {
  it('hides controller tools from users below owner', () => {
    const paths = moreLinks(false, false).map((link) => link.path);
    expect(paths).not.toContain('/app/more/controllers');
    expect(paths).not.toContain('/app/more/firmware');
  });

  it.each([
    ['owner', true, false],
    ['administrator', true, true],
  ])('shows controller tools to %s', (_role, canUseOwnerTools, isAdministrator) => {
    const links = moreLinks(canUseOwnerTools, isAdministrator);
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/app/more/controllers' }),
      expect.objectContaining({ path: '/app/more/firmware' }),
    ]));
    expect(links.filter((link) => link.path.includes('firmware'))).toHaveLength(1);
  });
});