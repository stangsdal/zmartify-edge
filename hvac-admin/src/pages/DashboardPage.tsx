import { useEffect, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonPage,
  IonCard,
  IonCardContent,
} from '@ionic/react';
import { systemApi } from '../api/system';
import { SystemStatus } from '../types/api';

export function DashboardPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await systemApi.getStatus();
        setStatus(data);
        setError('');
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Dashboard</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {!status ? (
          <p>Loading...</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <IonCard>
              <IonCardContent>
                <strong>Health</strong>
                <p>{status.health}</p>
              </IonCardContent>
            </IonCard>
            <IonCard>
              <IonCardContent>
                <strong>Registry</strong>
                <p>{status.registry_status}</p>
              </IonCardContent>
            </IonCard>
            <IonCard>
              <IonCardContent>
                <strong>ACL File</strong>
                <p>{status.acl_file_status}</p>
              </IonCardContent>
            </IonCard>
            <IonCard>
              <IonCardContent>
                <strong>Domains</strong>
                <p>{status.domain_count}</p>
              </IonCardContent>
            </IonCard>
            <IonCard>
              <IonCardContent>
                <strong>Sites</strong>
                <p>{status.site_count}</p>
              </IonCardContent>
            </IonCard>
            <IonCard>
              <IonCardContent>
                <strong>Devices</strong>
                <p>{status.device_count}</p>
              </IonCardContent>
            </IonCard>
            <IonCard>
              <IonCardContent>
                <strong>MQTT Clients</strong>
                <p>{status.mqtt_client_count}</p>
              </IonCardContent>
            </IonCard>
            {status.last_acl_generation && (
              <IonCard>
                <IonCardContent>
                  <strong>Last ACL Gen</strong>
                  <p>{status.last_acl_generation}</p>
                </IonCardContent>
              </IonCard>
            )}
          </div>
        )}
      </IonContent>
    </IonPage>
  );
}
