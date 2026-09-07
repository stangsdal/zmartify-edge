import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { NavLink } from 'react-router-dom';
import { useAccess } from '../auth/AccessContext';
import { moreLinks } from './moreLinks';

export function MorePage() {
  const { context, isAdministrator } = useAccess();
  const canUseOwnerTools = isAdministrator || context?.sites.some((site) => site.role === 'owner') === true;
  const links = moreLinks(canUseOwnerTools, isAdministrator);

  return (
    <IonPage>
      <AppHeader title="More" subtitle="Profile, administration and platform options" />
      <IonContent className="ion-padding">
        <div className="space-y-3 pb-20 lg:pb-8">
          {links.map((link) => link.document ? (
            <a key={link.path} href={link.path} className="block rounded-2xl app-surface p-4 shadow-soft border border-slate-100 no-underline text-current">
              <p className="text-lg font-semibold">{link.label}</p>
              <p className="text-sm text-muted mt-1">{link.description}</p>
            </a>
          ) : (
            <NavLink key={link.path} to={link.path} className="block rounded-2xl app-surface p-4 shadow-soft border border-slate-100 no-underline text-current">
              <p className="text-lg font-semibold">{link.label}</p>
              <p className="text-sm text-muted mt-1">{link.description}</p>
            </NavLink>
          ))}
        </div>
      </IonContent>
    </IonPage>
  );
}
