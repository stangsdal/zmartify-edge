import {
  alertCircleOutline,
  analyticsOutline,
  constructOutline,
  hardwareChipOutline,
  homeOutline,
  layersOutline,
  peopleOutline,
  settingsOutline,
  waterOutline,
} from 'ionicons/icons';

export type NavigationLayout = 'mobile' | 'desktop';

export type NavigationContext = {
  appBase: string;
  siteBase: string;
  isAdministrator: boolean;
  hasHvac: boolean;
  hasIrrigation: boolean;
};

export type NavigationItem = {
  id: string;
  label: string;
  icon: string;
  layouts: NavigationLayout[];
  route: (context: NavigationContext) => string;
  visibleWhen: (context: NavigationContext) => boolean;
};

const hasMultipleProducts = (context: NavigationContext) => context.hasHvac && context.hasIrrigation;
const hasSingleProduct = (context: NavigationContext) => (context.hasHvac ? 1 : 0) + (context.hasIrrigation ? 1 : 0) === 1;

export const navigationManifest: NavigationItem[] = [
  {
    id: 'home', label: 'Home', icon: homeOutline, layouts: ['mobile', 'desktop'], route: (context) => context.siteBase, visibleWhen: () => true,
  },
  {
    id: 'hvac', label: 'HVAC', icon: homeOutline, layouts: ['desktop'], route: (context) => `${context.siteBase}/hvac`, visibleWhen: (context) => context.hasHvac,
  },
  {
    id: 'irrigation', label: 'Irrigation', icon: waterOutline, layouts: ['desktop'], route: (context) => `${context.siteBase}/irrigation`, visibleWhen: (context) => context.hasIrrigation,
  },
  {
    id: 'single-hvac', label: 'HVAC', icon: homeOutline, layouts: ['mobile'], route: (context) => `${context.siteBase}/hvac`, visibleWhen: (context) => hasSingleProduct(context) && context.hasHvac,
  },
  {
    id: 'single-irrigation', label: 'Irrigation', icon: waterOutline, layouts: ['mobile'], route: (context) => `${context.siteBase}/irrigation`, visibleWhen: (context) => hasSingleProduct(context) && context.hasIrrigation,
  },
  {
    id: 'systems', label: 'Systems', icon: hardwareChipOutline, layouts: ['mobile'], route: (context) => `${context.siteBase}/systems`, visibleWhen: hasMultipleProducts,
  },
  {
    id: 'insights', label: 'Insights', icon: analyticsOutline, layouts: ['mobile', 'desktop'], route: (context) => `${context.appBase}/insights/water`, visibleWhen: (context) => context.isAdministrator || hasMultipleProducts(context),
  },
  {
    id: 'alerts', label: 'Alerts', icon: alertCircleOutline, layouts: ['mobile', 'desktop'], route: (context) => `${context.siteBase}/alerts`, visibleWhen: () => true,
  },
  {
    id: 'sites', label: 'Sites', icon: layersOutline, layouts: ['desktop'], route: (context) => `${context.appBase}/admin/sites`, visibleWhen: (context) => context.isAdministrator,
  },
  {
    id: 'platform-systems', label: 'Systems', icon: hardwareChipOutline, layouts: ['desktop'], route: (context) => `${context.appBase}/systems`, visibleWhen: (context) => context.isAdministrator,
  },
  {
    id: 'devices', label: 'Devices', icon: hardwareChipOutline, layouts: ['desktop'], route: (context) => `${context.appBase}/admin/devices`, visibleWhen: (context) => context.isAdministrator,
  },
  {
    id: 'automations', label: 'Automations', icon: constructOutline, layouts: ['desktop'], route: (context) => `${context.appBase}/automations`, visibleWhen: (context) => context.isAdministrator,
  },
  {
    id: 'users', label: 'Users', icon: peopleOutline, layouts: ['desktop'], route: (context) => `${context.appBase}/admin/users`, visibleWhen: (context) => context.isAdministrator,
  },
  {
    id: 'integrations', label: 'Integrations', icon: layersOutline, layouts: ['desktop'], route: (context) => `${context.appBase}/integrations`, visibleWhen: (context) => context.isAdministrator,
  },
  {
    id: 'system', label: 'System', icon: settingsOutline, layouts: ['desktop'], route: (context) => `${context.appBase}/admin/system`, visibleWhen: (context) => context.isAdministrator,
  },
  {
    id: 'more', label: 'More', icon: settingsOutline, layouts: ['mobile', 'desktop'], route: (context) => `${context.appBase}/more`, visibleWhen: () => true,
  },
];

export function navigationForLayout(context: NavigationContext, layout: NavigationLayout): Array<NavigationItem & { path: string }> {
  return navigationManifest
    .filter((item) => item.layouts.includes(layout) && item.visibleWhen(context))
    .map((item) => ({ ...item, path: item.route(context) }));
}