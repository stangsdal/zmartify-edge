import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { homeOutline, waterOutline } from 'ionicons/icons';
import { NavLink } from 'react-router-dom';
import { useAccess } from '../auth/AccessContext';
import { AppHeader } from '../components/AppHeader';

export function SiteSystemsPage() {
  const { context, selectedSiteId } = useAccess();
  const site = context?.sites.find((candidate) => candidate.id === selectedSiteId);
  const siteBase = site ? `/app/sites/${site.uuid || site.id}` : '/app/home';
  const products = site?.products.filter(
    (product) => product.allowed && (product.type === 'hvac' || product.type === 'irrigation')
  ) || [];

  return (
    <IonPage>
      <AppHeader title="Systems" subtitle={site?.name || 'Available products'} />
      <IonContent className="ion-padding">
        <div className="grid gap-3 pb-20 lg:pb-8 sm:grid-cols-2">
          {products.map((product) => {
            const isHvac = product.type === 'hvac';
            const label = isHvac ? 'HVAC' : 'Irrigation';
            const path = `${siteBase}/${product.type}`;
            return (
              <NavLink key={product.type} to={path} className="app-surface rounded-2xl p-5 shadow-soft border border-slate-100 no-underline text-current">
                <IonIcon icon={isHvac ? homeOutline : waterOutline} className="text-2xl text-teal-700" />
                <h2 className="mt-3 text-lg font-semibold">{label}</h2>
                <p className="mt-1 text-sm text-muted">Open {label.toLowerCase()} controls and status.</p>
              </NavLink>
            );
          })}
        </div>
      </IonContent>
    </IonPage>
  );
}