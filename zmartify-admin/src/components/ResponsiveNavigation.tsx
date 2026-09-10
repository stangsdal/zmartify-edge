import { IonIcon } from '@ionic/react';
import { Link, useLocation } from 'react-router-dom';
import { useAccess } from '../auth/AccessContext';
import { activeNavigationItemId, navigationForLayout } from './navigationManifest';

interface ResponsiveNavigationProps {
  appBase: string;
}

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
  const mobileActiveItemId = activeNavigationItemId(location.pathname, mobileItems);
  const desktopActiveItemId = activeNavigationItemId(location.pathname, desktopItems);

  return (
    <>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileItems.map((item) => {
          const active = item.id === mobileActiveItemId;
          return (
            <Link
              key={item.label}
              to={item.path}
              className={`mobile-nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <IonIcon icon={item.icon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <aside className="tablet-nav" aria-label="Tablet navigation">
        <div className="tablet-nav-list">
          {desktopItems.map((item) => {
            const active = item.id === desktopActiveItemId;
            return (
              <Link
                key={item.label}
                to={item.path}
                className={`tablet-nav-item${active ? ' active' : ''}`}
                title={item.label}
                aria-current={active ? 'page' : undefined}
              >
                <IonIcon icon={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </aside>

      <aside className="desktop-nav" aria-label="Desktop navigation">
        <div className="desktop-nav-brand">
          <img
            src={`${import.meta.env.MODE === 'native' ? '/' : import.meta.env.BASE_URL}brand/zmartify-lockup-transparent.png`}
            alt="Zmartify"
          />
          <p className="desktop-nav-kicker">HVAC control</p>
        </div>
        <div className="desktop-nav-list">
          {desktopItems.map((item) => {
            const active = item.id === desktopActiveItemId;
            return (
              <Link
                key={item.label}
                to={item.path}
                className={`desktop-nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <IonIcon icon={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </aside>
    </>
  );
}
