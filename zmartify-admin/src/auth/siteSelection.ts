type ProductAccess = {
  type: 'hvac' | 'irrigation' | 'weather' | 'energy';
  allowed: boolean;
};

type SelectedSite = {
  id: number;
  uuid: string;
  products: ProductAccess[];
};

export function resolveSiteLandingPath(site: SelectedSite): string {
  const siteBase = `/app/sites/${site.uuid || site.id}`;
  if (site.products.some((item) => item.type === 'hvac' && item.allowed)) {
    return `${siteBase}/hvac`;
  }
  if (site.products.some((item) => item.type === 'irrigation' && item.allowed)) {
    return `${siteBase}/irrigation`;
  }
  return siteBase;
}

export function resolveSiteSelectionPath(pathname: string, site: SelectedSite): string | null {
  const match = pathname.match(/^\/app\/sites\/[^/]+\/(hvac|irrigation)(\/.*)?$/);
  if (!match) {
    return null;
  }

  const siteBase = `/app/sites/${site.uuid || site.id}`;
  const product = match[1] as ProductAccess['type'];
  if (site.products.some((item) => item.type === product && item.allowed)) {
    return `${siteBase}/${product}${match[2] || ''}`;
  }

  return resolveSiteLandingPath(site);
}