import { IonTabBar, IonTabButton, IonIcon } from '@ionic/react';
import { homeOutline, gridOutline, statsChartOutline, notificationsOutline, settingsOutline } from 'ionicons/icons';

interface BottomNavigationProps {
  appBase: string;
}

export function BottomNavigation({ appBase }: BottomNavigationProps) {
  return (
    <IonTabBar slot="bottom">
      <IonTabButton tab="home" href={`${appBase}/home`}>
        <IonIcon icon={homeOutline} />
        Home
      </IonTabButton>
      <IonTabButton tab="rooms" href={`${appBase}/rooms`}>
        <IonIcon icon={gridOutline} />
        Rooms
      </IonTabButton>
      <IonTabButton tab="history" href={`${appBase}/history`}>
        <IonIcon icon={statsChartOutline} />
        History
      </IonTabButton>
      <IonTabButton tab="alerts" href={`${appBase}/alerts`}>
        <IonIcon icon={notificationsOutline} />
        Alerts
      </IonTabButton>
      <IonTabButton tab="settings" href={`${appBase}/settings`}>
        <IonIcon icon={settingsOutline} />
        Settings
      </IonTabButton>
    </IonTabBar>
  );
}
