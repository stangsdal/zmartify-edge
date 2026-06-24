import { IonTabBar, IonTabButton, IonIcon } from '@ionic/react';
import { homeOutline, gridOutline, statsChartOutline, notificationsOutline, settingsOutline, peopleOutline, hardwareChipOutline, qrCodeOutline } from 'ionicons/icons';

interface BottomNavigationProps {
  appBase: string;
  isAdmin?: boolean;
}

export function BottomNavigation({ appBase, isAdmin = false }: BottomNavigationProps) {
  return (
    <IonTabBar slot="bottom">
      <IonTabButton tab="home" href={`${appBase}/home`}>
        <IonIcon icon={homeOutline} />
        Home
      </IonTabButton>
      {isAdmin && (
        <IonTabButton tab="devices" href={`${appBase}/devices`}>
          <IonIcon icon={hardwareChipOutline} />
          Devices
        </IonTabButton>
      )}
      {isAdmin && (
        <IonTabButton tab="users" href={`${appBase}/users`}>
          <IonIcon icon={peopleOutline} />
          Users
        </IonTabButton>
      )}
      {isAdmin && (
        <IonTabButton tab="invites" href={`${appBase}/invites`}>
          <IonIcon icon={qrCodeOutline} />
          Invites
        </IonTabButton>
      )}
      <IonTabButton tab="rooms" href={`${appBase}/rooms`}>
        <IonIcon icon={gridOutline} />
        Rooms
      </IonTabButton>
      {!isAdmin && (
        <IonTabButton tab="history" href={`${appBase}/history`}>
          <IonIcon icon={statsChartOutline} />
          History
        </IonTabButton>
      )}
      {!isAdmin && (
        <IonTabButton tab="alerts" href={`${appBase}/alerts`}>
          <IonIcon icon={notificationsOutline} />
          Alerts
        </IonTabButton>
      )}
      <IonTabButton tab="settings" href={`${appBase}/settings`}>
        <IonIcon icon={settingsOutline} />
        Settings
      </IonTabButton>
    </IonTabBar>
  );
}
