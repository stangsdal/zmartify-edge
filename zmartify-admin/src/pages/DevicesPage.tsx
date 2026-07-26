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
  IonToggle,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { deviceApi } from '../api/devices';
import { Device, DeviceControllerSettings, DeviceSdCardStatus } from '../types/api';
import { useDeviceZones } from '../hooks/useDeviceZones';
import { ZoneCard } from '../components/ZoneCard';
import { AppHeader } from '../components/AppHeader';
import { IrrigationZone, mobileApi } from '../api/mobile';

const isIrrigationDevice = (device: Device): boolean => {
  const haystack = [device.device_id, device.display_name, device.device_type, device.integration_mode]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes('irrigation');
};

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

function IrrigationZonesPanel({ deviceId }: { deviceId: string }) {
  const history = useHistory();
  const [zones, setZones] = useState<IrrigationZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchZones = async () => {
    try {
      setLoading(true);
      const response = await mobileApi.listIrrigationZones(deviceId);
      setZones(response.zones || []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchZones();
  }, [deviceId]);

  if (loading) {
    return (
      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <IonSpinner name="crescent" />
        <span>Loading irrigation zones...</span>
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-rose-600">{error}</p>;
  }

  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <strong>Irrigation zones ({zones.length})</strong>
        <div style={{ display: 'flex', gap: '8px' }}>
          <IonButton size="small" fill="outline" onClick={() => { void fetchZones(); }}>
            Refresh
          </IonButton>
          <IonButton size="small" onClick={() => history.push('/app/control/irrigation/setup')}>
            Setup
          </IonButton>
        </div>
      </div>

      {!zones.length ? (
        <p className="text-sm text-muted mt-2">
          No irrigation zones are configured yet. Use setup to bind controller zone refs to watering areas.
        </p>
      ) : null}

      <div className="space-y-2 mt-2">
        {zones.map((zone) => (
          <button
            key={zone.zone_id}
            type="button"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left bg-white"
            onClick={() => history.push(`/app/control/irrigation/zones/${encodeURIComponent(zone.zone_id)}?deviceId=${encodeURIComponent(deviceId)}`)}
          >
            <p className="font-semibold">{zone.name || zone.local_ref}</p>
            <p className="text-xs text-muted">{zone.local_ref} · {zone.enabled ? 'Enabled' : 'Disabled'}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ControllerSettingsPanel({ deviceId }: { deviceId: string }) {
  const [settings, setSettings] = useState<DeviceControllerSettings | null>(null);
  const [sdCardStatus, setSdCardStatus] = useState<DeviceSdCardStatus | null>(null);
  const [timezone, setTimezone] = useState('');
  const [ntpServer, setNtpServer] = useState('');
  const [mqttBrokerUri, setMqttBrokerUri] = useState('');
  const [mqttPort, setMqttPort] = useState('');
  const [mqttUsername, setMqttUsername] = useState('');
  const [mqttPassword, setMqttPassword] = useState('');
  const [mqttTlsEnabled, setMqttTlsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sdCardLoading, setSdCardLoading] = useState(false);
  const [sdCardInitializing, setSdCardInitializing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sdCardError, setSdCardError] = useState('');

  const applySettings = (next: DeviceControllerSettings) => {
    setSettings(next);
    setTimezone(next.timezone || '');
    setNtpServer(next.ntp_server || '');
    setMqttBrokerUri(next.mqtt_broker_uri || '');
    setMqttPort(next.mqtt_port == null ? '' : String(next.mqtt_port));
    setMqttUsername(next.mqtt_username || '');
    setMqttPassword('');
    setMqttTlsEnabled(!!next.mqtt_tls_enabled);
  };

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError('');
      setMessage('');
      applySettings(await deviceApi.getControllerSettings(deviceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadSdCardStatus = async () => {
    try {
      setSdCardLoading(true);
      setSdCardError('');
      setSdCardStatus(await deviceApi.getSdCardStatus(deviceId));
    } catch (e) {
      setSdCardError(e instanceof Error ? e.message : String(e));
    } finally {
      setSdCardLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
    void loadSdCardStatus();
  }, [deviceId]);

  const formatBytes = (value?: number | null): string => {
    if (value == null || !Number.isFinite(value)) return 'Unknown';
    if (value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  const initializeSdCard = async () => {
    if (!window.confirm('Initialize the SD card for controller storage? If the card cannot be mounted, the controller may format it.')) {
      return;
    }
    try {
      setSdCardInitializing(true);
      setSdCardError('');
      setMessage('');
      const updated = await deviceApi.initializeSdCard(deviceId, true);
      setSdCardStatus(updated);
      setMessage(updated.command_id ? `SD-card initialize command sent (${updated.command_id}).` : 'SD-card initialize command sent.');
    } catch (e) {
      setSdCardError(e instanceof Error ? e.message : String(e));
    } finally {
      setSdCardInitializing(false);
    }
  };

  const saveSettings = async () => {
    const parsedPort = mqttPort.trim() ? Number(mqttPort) : undefined;
    if (parsedPort != null && (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535)) {
      setError('MQTT port must be between 0 and 65535.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      setMessage('');
      const updated = await deviceApi.updateControllerSettings(deviceId, {
        timezone: timezone.trim(),
        ntp_server: ntpServer.trim(),
        mqtt_broker_uri: mqttBrokerUri.trim(),
        mqtt_port: parsedPort,
        mqtt_username: mqttUsername.trim(),
        mqtt_password: mqttPassword,
        mqtt_tls_enabled: mqttTlsEnabled,
      });
      applySettings(updated);
      setMessage(updated.reboot_required ? 'Settings saved. Reboot the controller for all network changes to take effect.' : 'Settings saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-muted">
        <IonSpinner name="crescent" />
        <span>Loading controller settings...</span>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-slate-200/80 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <p className="font-semibold">Controller settings</p>
          {settings?.local_url ? <p className="text-xs text-muted">{settings.local_url}</p> : null}
        </div>
        <IonButton size="small" fill="outline" onClick={() => { void loadSettings(); }} disabled={saving}>
          Refresh
        </IonButton>
      </div>
      {error ? <p className="text-sm text-rose-600 mb-2">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700 mb-2">{message}</p> : null}
      <div className="grid gap-2 md:grid-cols-2">
        <IonItem>
          <IonLabel position="stacked">Timezone</IonLabel>
          <IonInput value={timezone} onIonChange={(e) => setTimezone(e.detail.value || '')} placeholder="CET-1CEST,M3.5.0,M10.5.0/3" />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">NTP server</IonLabel>
          <IonInput value={ntpServer} onIonChange={(e) => setNtpServer(e.detail.value || '')} placeholder="pool.ntp.org" />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">MQTT URI</IonLabel>
          <IonInput value={mqttBrokerUri} onIonChange={(e) => setMqttBrokerUri(e.detail.value || '')} placeholder="mqtts://pilot.zmartify.dk:8883" />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">MQTT port</IonLabel>
          <IonInput type="number" value={mqttPort} onIonChange={(e) => setMqttPort(e.detail.value || '')} placeholder="8883" />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">MQTT username</IonLabel>
          <IonInput value={mqttUsername} onIonChange={(e) => setMqttUsername(e.detail.value || '')} placeholder="device_controller_id" />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">MQTT password</IonLabel>
          <IonInput type="password" value={mqttPassword} onIonChange={(e) => setMqttPassword(e.detail.value || '')} placeholder={settings?.mqtt_password_configured ? 'Configured; leave blank to keep' : 'Not configured'} />
        </IonItem>
        <IonItem>
          <IonLabel>MQTT TLS</IonLabel>
          <IonToggle checked={mqttTlsEnabled} onIonChange={(e) => setMqttTlsEnabled(e.detail.checked)} />
        </IonItem>
      </div>
      <IonButton className="mt-3" size="small" onClick={saveSettings} disabled={saving}>
        {saving ? 'Saving...' : 'Save settings'}
      </IonButton>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <p className="font-semibold">SD card</p>
            <p className="text-xs text-muted">{sdCardStatus?.mount_point || '/sdcard'}</p>
          </div>
          <div className="flex gap-2">
            <IonButton size="small" fill="outline" onClick={() => { void loadSdCardStatus(); }} disabled={sdCardLoading || sdCardInitializing}>
              {sdCardLoading ? 'Refreshing...' : 'Refresh'}
            </IonButton>
            <IonButton size="small" onClick={initializeSdCard} disabled={sdCardLoading || sdCardInitializing}>
              {sdCardInitializing ? 'Initializing...' : 'Initialize'}
            </IonButton>
          </div>
        </div>
        {sdCardError ? <p className="text-sm text-rose-600 mb-2">{sdCardError}</p> : null}
        {sdCardStatus ? (
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <p><span className="text-muted">State:</span> <strong>{sdCardStatus.state}</strong></p>
            <p><span className="text-muted">Mounted:</span> {sdCardStatus.mounted ? 'Yes' : 'No'}</p>
            <p><span className="text-muted">Card capacity:</span> {formatBytes(sdCardStatus.card_total_bytes ?? sdCardStatus.total_bytes)}</p>
            <p><span className="text-muted">Filesystem size:</span> {formatBytes(sdCardStatus.filesystem_total_bytes ?? sdCardStatus.total_bytes)}</p>
            <p><span className="text-muted">Filesystem free:</span> {formatBytes(sdCardStatus.free_bytes)}</p>
            {sdCardStatus.card_name ? <p><span className="text-muted">Card:</span> {sdCardStatus.card_name}</p> : null}
            {sdCardStatus.command_status ? <p><span className="text-muted">Command:</span> {sdCardStatus.command_status}</p> : null}
            {sdCardStatus.last_error ? <p className="md:col-span-2 text-amber-700">{sdCardStatus.last_error}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted">SD-card status has not been loaded.</p>
        )}
      </div>
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
                      {isIrrigationDevice(device) ? (
                        <>
                          <IrrigationZonesPanel deviceId={device.device_id} />
                          <ControllerSettingsPanel deviceId={device.device_id} />
                        </>
                      ) : (
                        <DeviceZonesPanel deviceId={device.device_id} />
                      )}
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
