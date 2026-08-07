import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { NavLink } from 'react-router-dom';
import { useAccess } from '../auth/AccessContext';

const personalLinks = [
  { label: 'Profile', description: 'Account identity and session details', path: '/app/more/profile' },
  { label: 'Notifications', description: 'Read, filter and clear notifications', path: '/app/more/notifications' },
  { label: 'Settings', description: 'Theme, property and client preferences', path: '/app/more/settings' },
];

const administratorLinks = [
  { label: 'Devices', description: 'Device inventory and details', path: '/app/more/devices' },
  { label: 'Users', description: 'Platform accounts and global administration', path: '/app/more/users' },
  { label: 'Integrations', description: 'MQTT and external integrations', path: '/app/more/integrations' },
  { label: 'System', description: 'Diagnostics, health and platform status', path: '/app/more/system' },
];

export function MorePage() {
  const { context, isAdministrator } = useAccess();
  const canManageMembers = isAdministrator || context?.sites.some((site) => site.role === 'owner') === true;
  const moreLinks = [
    ...personalLinks,
    ...(canManageMembers ? [{ label: 'Site members', description: 'Manage roles and product access for your sites', path: '/app/more/members' }] : []),
    ...(isAdministrator ? administratorLinks : []),
  ];

  return (
    <IonPage>
      <AppHeader title="More" subtitle="Profile, administration and platform options" />
      <IonContent className="ion-padding">
        <div className="space-y-3 pb-20 lg:pb-8">
          {moreLinks.map((link) => (
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
