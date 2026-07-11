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
  const [refreshInterval, setRefreshInterval] = useState(5000); // 5s
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStatus = async () => {
    try {
      const data = await systemApi.getStatus();
      setStatus(data);
      setLastRefresh(new Date());
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchStatus, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Dashboard</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label>
            Refresh every:
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              style={{ marginLeft: '8px', padding: '4px' }}
            >
              <option value={3000}>3s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1m</option>
            </select>
          </label>
          {lastRefresh && (
            <span style={{ fontSize: '0.8em', color: '#666' }}>
              Last: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>

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
