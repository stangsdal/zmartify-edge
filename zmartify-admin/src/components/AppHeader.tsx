import { IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon } from '@ionic/react';
import { settingsOutline } from 'ionicons/icons';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  onSettings?: () => void;
}

export function AppHeader({ title, subtitle, onSettings }: AppHeaderProps) {
  return (
    <IonHeader translucent>
      <IonToolbar className="!bg-transparent">
        <div className="px-4 py-2">
          <div className="flex items-center justify-between">
            <div>
              <IonTitle className="!px-0 !text-2xl !font-bold">{title}</IonTitle>
              {subtitle ? <p className="text-sm text-muted mt-1">{subtitle}</p> : null}
            </div>
            {onSettings ? (
              <IonButtons slot="end">
                <IonButton onClick={onSettings}>
                  <IonIcon icon={settingsOutline} />
                </IonButton>
              </IonButtons>
            ) : null}
          </div>
        </div>
      </IonToolbar>
    </IonHeader>
  );
}
