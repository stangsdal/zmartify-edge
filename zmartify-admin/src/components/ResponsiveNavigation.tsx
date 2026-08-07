import { IonIcon } from '@ionic/react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAccess } from '../auth/AccessContext';
import { navigationForLayout } from './navigationManifest';

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

  const navigationContext = { appBase, siteBase, isAdministrator, hasHvac, hasIrrigation };
  const mobileItems = navigationForLayout(navigationContext, 'mobile');
  const desktopItems = navigationForLayout(navigationContext, 'desktop');

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
