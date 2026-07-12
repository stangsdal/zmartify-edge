import { useEffect, useState } from 'react';
import {
  IonContent,
  IonPage,
  IonButton,
  IonLoading,
  IonAlert,
  IonInput,
  IonItem,
  IonLabel,
  IonSpinner,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { deviceApi } from '../api/devices';
import { Device } from '../types/api';
import { useDeviceZones } from '../hooks/useDeviceZones';
import { ZoneCard } from '../components/ZoneCard';
import { AppHeader } from '../components/AppHeader';

function DeviceZonesPanel({ deviceId }: { deviceId: string }) {
  const { zoneState, loading, error, updateZoneSetpoint, refetch } = useDeviceZones(deviceId);

  if (loading) {
    return (
      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <IonSpinner name="crescent" />
        <span>Loading zones...</span>
      </div>
    );
  }

  if (error) {
    return <p style={{ color: 'red' }}>{error}</p>;
  }

  if (!zoneState || zoneState.zones.length === 0) {
    return <p style={{ color: '#666' }}>No zones available for this device.</p>;
  }

  return (
    <div style={{ marginTop: '8px' }}>
      <div
        style={{
          padding: '10px 12px',
          marginBottom: '10px',
          borderRadius: '8px',
          border: `1px solid ${zoneState.freshness.color}`,
          background: '#fff',
        }}
      >
        <strong>Device Health</strong>
        <p style={{ margin: '4px 0' }}>Online: {zoneState.online ? 'Yes' : 'No'}</p>
        <p style={{ margin: '4px 0' }}>MQTT: {zoneState.mqtt_connected ? 'Connected' : 'Disconnected'}</p>
        <p style={{ margin: '4px 0', color: zoneState.freshness.color, fontWeight: 600 }}>
          Twin Freshness: {zoneState.freshness.label}
        </p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Zones ({zoneState.zones.length})</strong>
        <IonButton size="small" fill="outline" onClick={refetch}>
          Refresh Zones
        </IonButton>
      </div>
      {zoneState.zones.map((zone) => (
        <ZoneCard key={zone.zone_id} zone={zone} onSetpointChange={updateZoneSetpoint} />
      ))}
    </div>
  );
}

export function DevicesPage() {
  const history = useHistory();
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
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);

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
      <AppHeader title="Devices" subtitle="Inventory, status and zone operations" />
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

        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Total devices</p>
              <p className="text-2xl font-bold mt-1">{devices.length}</p>
            </div>
            <div className="flex gap-2">
              <IonButton fill="outline" onClick={() => history.push('/app/devices/add')}>
                Add device
              </IonButton>
              <IonButton onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Register device'}</IonButton>
            </div>
          </section>

          {showForm ? (
            <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
              <h2 className="text-lg font-semibold mb-2">Register device</h2>
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
            </section>
          ) : null}

          {loading ? <p className="text-sm text-muted">Loading devices...</p> : null}
          {!loading && devices.length === 0 ? <p className="text-sm text-muted">No devices registered yet.</p> : null}
          {!loading && devices.length > 0 ? (
            <section className="space-y-3">
              {devices.map((device) => (
                <article key={device.device_id} className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted">{device.device_id}</p>
                      <h3 className="text-lg font-semibold mt-1">{device.display_name}</h3>
                      {device.mac ? <p className="text-sm text-muted mt-1">MAC: {device.mac}</p> : null}
                      {device.site_id ? <p className="text-sm text-muted">Site ID: {device.site_id}</p> : null}
                      {device.online !== undefined ? (
                        <p className={`text-sm font-semibold ${device.online ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {device.online ? 'Online' : 'Offline'}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <IonButton
                        size="small"
                        fill="outline"
                        onClick={() =>
                          setExpandedDeviceId(expandedDeviceId === device.device_id ? null : device.device_id)
                        }
                      >
                        {expandedDeviceId === device.device_id ? 'Hide zones' : 'Zones'}
                      </IonButton>
                      <IonButton
                        size="small"
                        fill="outline"
                        onClick={() => history.push(`/app/devices/${device.device_id}/history`)}
                      >
                        History
                      </IonButton>
                      <IonButton
                        color="danger"
                        fill="outline"
                        size="small"
                        onClick={() => {
                          setDeleteTarget(device.device_id);
                          setShowDeleteAlert(true);
                        }}
                      >
                        Delete
                      </IonButton>
                    </div>
                  </div>
                  {expandedDeviceId === device.device_id ? (
                    <div className="mt-3 rounded-xl border border-slate-200/70 p-3 bg-slate-50/60">
                      <DeviceZonesPanel deviceId={device.device_id} />
                    </div>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
        </div>
      </IonContent>
    </IonPage>
  );
}
