import { useEffect, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonPage,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonCard,
  IonCardContent,
  IonInput,
  IonLoading,
  IonAlert,
} from '@ionic/react';
import { deviceApi } from '../api/devices';
import { Device } from '../types/api';

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newMac, setNewMac] = useState('');
  const [newFirmwareVersion, setNewFirmwareVersion] = useState('');
  const [creating, setCreating] = useState(false);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const fetchDevices = async () => {
    try {
      setLoading(true);
      const data = await deviceApi.list();
      setDevices(data);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  const handleCreateDevice = async () => {
    if (!newDeviceId.trim() || !newDisplayName.trim()) {
      setError('Device ID and display name are required');
      return;
    }
    try {
      setCreating(true);
      await deviceApi.create(
        newDeviceId,
        newDisplayName,
        newMac || undefined,
        newFirmwareVersion || undefined
      );
      setNewDeviceId('');
      setNewDisplayName('');
      setNewMac('');
      setNewFirmwareVersion('');
      setShowForm(false);
      setError('');
      await fetchDevices();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    try {
      setCreating(true);
      await deviceApi.delete(deviceId);
      setError('');
      await fetchDevices();
      setShowDeleteAlert(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Devices</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonLoading isOpen={creating} message="Processing..." />
        <IonAlert
          isOpen={showDeleteAlert}
          onDidDismiss={() => setShowDeleteAlert(false)}
          header="Confirm Delete"
          message="Are you sure you want to delete this device?"
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Delete',
              role: 'destructive',
              handler: () => {
                if (deleteTarget !== null) {
                  handleDeleteDevice(deleteTarget);
                }
              },
            },
          ]}
        />

        {error && (
          <IonCard>
            <IonCardContent style={{ color: 'red' }}>
              <strong>Error:</strong> {error}
            </IonCardContent>
          </IonCard>
        )}

        <IonButton
          expand="block"
          onClick={() => setShowForm(!showForm)}
          className="ion-margin-bottom"
        >
          {showForm ? 'Cancel' : 'Register Device'}
        </IonButton>

        {showForm && (
          <IonCard className="ion-margin-bottom">
            <IonCardContent>
              <IonItem>
                <IonLabel position="stacked">Device ID</IonLabel>
                <IonInput
                  value={newDeviceId}
                  onIonChange={(e) => setNewDeviceId(e.detail.value || '')}
                  placeholder="e.g., device-001"
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Display Name</IonLabel>
                <IonInput
                  value={newDisplayName}
                  onIonChange={(e) => setNewDisplayName(e.detail.value || '')}
                  placeholder="e.g., Office Thermostat"
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">MAC Address (optional)</IonLabel>
                <IonInput
                  value={newMac}
                  onIonChange={(e) => setNewMac(e.detail.value || '')}
                  placeholder="e.g., 00:11:22:33:44:55"
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Firmware Version (optional)</IonLabel>
                <IonInput
                  value={newFirmwareVersion}
                  onIonChange={(e) => setNewFirmwareVersion(e.detail.value || '')}
                  placeholder="e.g., 1.0.0"
                />
              </IonItem>
              <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                <IonButton expand="block" onClick={handleCreateDevice}>
                  Register
                </IonButton>
              </div>
            </IonCardContent>
          </IonCard>
        )}

        {loading ? (
          <p>Loading devices...</p>
        ) : devices.length === 0 ? (
          <p>No devices registered yet.</p>
        ) : (
          <IonList>
            {devices.map((device) => (
              <IonItem key={device.device_id}>
                <IonLabel>
                  <strong>{device.display_name}</strong>
                  <p>{device.device_id}</p>
                  {device.mac && <p>MAC: {device.mac}</p>}
                  {device.site_id && (
                    <p style={{ color: '#666' }}>Site ID: {device.site_id}</p>
                  )}
                  {device.online !== undefined && (
                    <p
                      style={{
                        color: device.online ? 'green' : 'red',
                      }}
                    >
                      {device.online ? 'Online' : 'Offline'}
                    </p>
                  )}
                </IonLabel>
                <IonButton
                  slot="end"
                  color="danger"
                  size="small"
                  onClick={() => {
                    setDeleteTarget(device.device_id);
                    setShowDeleteAlert(true);
                  }}
                >
                  Delete
                </IonButton>
              </IonItem>
            ))}
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
}
