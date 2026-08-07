import { IonIcon } from '@ionic/react';
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
import { NavLink, useLocation } from 'react-router-dom';
import { useAccess } from '../auth/AccessContext';

type NavItem = {
  label: string;
  path: string;
  icon: string;
};

interface ResponsiveNavigationProps {
  appBase: string;
}

const isActive = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

export function ResponsiveNavigation({ appBase }: ResponsiveNavigationProps) {
  const location = useLocation();
  const { context, isAdministrator, selectedSiteId } = useAccess();
  const site = context?.sites.find((candidate) => candidate.id === selectedSiteId);
  const siteRef = site?.uuid || site?.id;
  const siteBase = siteRef ? `${appBase}/sites/${siteRef}` : `${appBase}/home`;
  const hasHvac = site?.products.some((product) => product.type === 'hvac' && product.allowed) === true;
  const hasIrrigation = site?.products.some((product) => product.type === 'irrigation' && product.allowed) === true;

  const mobileItems: NavItem[] = [
    { label: 'Home', path: siteBase, icon: homeOutline },
    ...(hasHvac ? [{ label: 'HVAC', path: `${siteBase}/hvac`, icon: homeOutline }] : []),
    ...(hasIrrigation ? [{ label: 'Irrigation', path: `${siteBase}/irrigation`, icon: waterOutline }] : []),
    { label: 'Alerts', path: `${siteBase}/alerts`, icon: alertCircleOutline },
    { label: 'More', path: `${appBase}/more`, icon: settingsOutline },
  ];

  const desktopItems: NavItem[] = isAdministrator
    ? [
        { label: 'Overview', path: siteBase, icon: homeOutline },
        { label: 'Sites', path: `${appBase}/sites`, icon: layersOutline },
        { label: 'Systems', path: `${appBase}/systems`, icon: hardwareChipOutline },
        { label: 'Devices', path: `${appBase}/devices`, icon: hardwareChipOutline },
        { label: 'Automations', path: `${appBase}/automations`, icon: constructOutline },
        { label: 'Insights', path: `${appBase}/insights/water`, icon: analyticsOutline },
        { label: 'Alerts', path: `${siteBase}/alerts`, icon: alertCircleOutline },
        { label: 'Users', path: `${appBase}/users`, icon: peopleOutline },
        { label: 'Integrations', path: `${appBase}/integrations`, icon: layersOutline },
        { label: 'System', path: `${appBase}/system`, icon: settingsOutline },
      ]
    : [
      { label: 'Overview', path: siteBase, icon: homeOutline },
      ...(hasHvac ? [{ label: 'HVAC', path: `${siteBase}/hvac`, icon: homeOutline }] : []),
      ...(hasIrrigation ? [{ label: 'Irrigation', path: `${siteBase}/irrigation`, icon: waterOutline }] : []),
        { label: 'Alerts', path: `${siteBase}/alerts`, icon: alertCircleOutline },
        { label: 'More', path: `${appBase}/more`, icon: settingsOutline },
      ];

  return (
    <>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileItems.map((item) => {
          const active = isActive(location.pathname, item.path);
          return (
            <NavLink key={item.label} to={item.path} className={`mobile-nav-item${active ? ' active' : ''}`}>
              <IonIcon icon={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <aside className="tablet-nav" aria-label="Tablet navigation">
        <div className="tablet-nav-list">
          {desktopItems.map((item) => {
            const active = isActive(location.pathname, item.path);
            return (
              <NavLink key={item.label} to={item.path} className={`tablet-nav-item${active ? ' active' : ''}`} title={item.label}>
                <IonIcon icon={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </aside>

      <aside className="desktop-nav" aria-label="Desktop navigation">
        <div className="desktop-nav-brand">
          <p className="desktop-nav-kicker">Zmartify Edge</p>
          <h2>Control Plane</h2>
        </div>
        <div className="desktop-nav-list">
          {desktopItems.map((item) => {
            const active = isActive(location.pathname, item.path);
            return (
              <NavLink key={item.label} to={item.path} className={`desktop-nav-item${active ? ' active' : ''}`}>
                <IonIcon icon={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </aside>
    </>
  );
}
