import { IonCard, IonCardContent, IonButton } from '@ionic/react';
import { useCloudSync } from '../hooks/useCloudSync';

export function CloudStatusCard() {
  const { syncStatus, syncing, error, syncNow, isCloudConfigured } = useCloudSync();

  const handleManualSync = async () => {
    await syncNow({ timestamp: new Date().toISOString() });
  };

  return (
    <IonCard>
      <IonCardContent>
        <h3>Cloud Sync Status</h3>
        <p>Configured: {isCloudConfigured ? 'Yes' : 'No'}</p>
        <p>Connected: {syncStatus.connected ? 'Online' : 'Offline'}</p>
        <p>Pending Changes: {syncStatus.pendingChanges}</p>
        {syncStatus.lastSync && <p>Last Sync: {new Date(syncStatus.lastSync).toLocaleString()}</p>}
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <IonButton
          expand="block"
          onClick={handleManualSync}
          disabled={syncing || !isCloudConfigured}
        >
          {syncing ? 'Syncing...' : 'Sync Now'}
        </IonButton>
      </IonCardContent>
    </IonCard>
  );
}
