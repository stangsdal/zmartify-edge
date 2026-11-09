import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { NavLink } from 'react-router-dom';
import { useAccess } from '../auth/AccessContext';
import { useHasTopLevelAdminNav } from '../hooks/useHasTopLevelAdminNav';
import { MoreLink, moreSections } from './moreLinks';

function MoreCard({ link }: { link: MoreLink }) {
  const body = (
    <>
      <p className="text-lg font-semibold">{link.label}</p>
      <p className="text-sm text-muted mt-1">{link.description}</p>
    </>
  );
  const className = 'block rounded-2xl app-surface p-4 shadow-soft border border-slate-100 no-underline text-current';
  return link.document
    ? <a href={link.path} className={className}>{body}</a>
    : <NavLink to={link.path} className={className}>{body}</NavLink>;
}

export function MorePage() {
  const { context, isAdministrator } = useAccess();
  const hasTopLevelAdminNav = useHasTopLevelAdminNav();
  const canUseOwnerTools = isAdministrator || context?.sites.some((site) => site.role === 'owner') === true;
  const sections = moreSections({ canUseOwnerTools, isAdministrator, hasTopLevelAdminNav });

  return (
    <IonPage>
      <AppHeader title="More" subtitle="Profile, administration and platform options" />
      <IonContent className="ion-padding">
        <div className="pb-20 lg:pb-8">
          {sections.map((section) => (
            <section key={section.title} className="more-section">
              <h2 className="more-section__title">{section.title}</h2>
              <div className="space-y-3">
                {section.links.map((link) => <MoreCard key={link.path} link={link} />)}
              </div>
            </section>
          ))}
        </div>
      </IonContent>
    </IonPage>
  );
}
