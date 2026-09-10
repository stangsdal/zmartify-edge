import { useEffect, useState } from 'react';
import {
  IonAlert,
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonLoading,
  IonPage,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
} from '@ionic/react';
import {
  addOutline,
  cloudUploadOutline,
  openOutline,
  refreshOutline,
  trashOutline,
} from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { deviceApi } from '../api/devices';
import {
  FirmwareCatalogRelease,
  loadFirmwareCatalog,
} from '../api/firmwareCatalog';
import { AppHeader } from '../components/AppHeader';
import { Device, DeviceOtaStatus } from '../types/api';
import {
  ControllerStatusFilter,
  filterControllers,
  paginateControllers,
} from '../utils/controllerFleet';

type ControllersPageProps = {
  canManageFleet: boolean;
};

type ControllerView = 'fleet' | 'setup';

const pageSize = 25;

function normalized(value?: string): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function compatibleReleases(device: Device, releases: FirmwareCatalogRelease[]): FirmwareCatalogRelease[] {
  const identity = normalized([device.device_type, device.device_id, device.display_name].filter(Boolean).join(' '));
  return releases.filter((release) => identity.includes(normalized(release.id)));
}

function ControllerFirmwarePanel({ device, releases }: { device: Device; releases: FirmwareCatalogRelease[] }) {
  const [otaStatus, setOtaStatus] = useState<DeviceOtaStatus | null>(null);
  const [selectedReleaseId, setSelectedReleaseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const matches = compatibleReleases(device, releases);
  const deployable = matches.filter((release) => release.otaUrl && release.otaFilename);
  const selectedRelease = deployable.find((release) => `${release.id}:${release.version}` === selectedReleaseId) || deployable[0];

  const refreshStatus = async () => {
    try {
      setError('');
      setOtaStatus(await deviceApi.getFirmwareOtaStatus(device.device_id));
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
    }
  };

  useEffect(() => {
    setSelectedReleaseId('');
    setMessage('');
    void refreshStatus();
  }, [device.device_id]);

  const deploy = async () => {
    if (!selectedRelease) return;
    try {
      setBusy(true);
      setError('');
      setMessage(`Staging ${selectedRelease.name} ${selectedRelease.version}...`);
      await deviceApi.stageCatalogFirmware(device.device_id, selectedRelease.id, selectedRelease.version);
      const triggered = await deviceApi.triggerFirmwareOta(device.device_id);
      setMessage(`Version ${selectedRelease.version} staged; controller poll ${triggered.status}.`);
      await refreshStatus();
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="controller-detail__section">
      <div className="controller-detail__section-heading">
        <div>
          <h3>Firmware</h3>
          <p>Release selection is restricted to this controller family.</p>
        </div>
        <button type="button" className="controller-icon-button" onClick={() => { void refreshStatus(); }} title="Refresh OTA status">
          <IonIcon icon={refreshOutline} aria-hidden="true" />
        </button>
      </div>

      {deployable.length ? (
        <IonItem className="controller-field">
          <IonLabel position="stacked">Release</IonLabel>
          <IonSelect value={selectedRelease ? `${selectedRelease.id}:${selectedRelease.version}` : ''} onIonChange={(event) => setSelectedReleaseId(event.detail.value)}>
            {deployable.map((release) => (
              <IonSelectOption key={`${release.id}:${release.version}`} value={`${release.id}:${release.version}`}>{release.name} {release.version}</IonSelectOption>
            ))}
          </IonSelect>
        </IonItem>
      ) : (
        <p className="controller-notice">
          {matches.length
            ? 'This catalog release only contains a USB recovery image. Publish a separate OTA artifact to enable staging.'
            : 'No compatible firmware release is published for this controller type.'}
        </p>
      )}

      {otaStatus ? (
        <dl className="controller-facts">
          <div><dt>Status</dt><dd>{otaStatus.state}</dd></div>
          <div><dt>Controller</dt><dd>{otaStatus.current_version || device.firmware_version || 'Unknown'}</dd></div>
          <div><dt>Staged</dt><dd>{otaStatus.staged_version || 'None'}</dd></div>
          <div><dt>Last seen</dt><dd>{otaStatus.last_seen_at || 'Unknown'}</dd></div>
        </dl>
      ) : null}
      {error ? <p className="controller-message controller-message--error">{error}</p> : null}
      {message ? <p className="controller-message controller-message--success">{message}</p> : null}
      <IonButton size="small" onClick={() => { void deploy(); }} disabled={!selectedRelease || busy}>
        <IonIcon slot="start" icon={cloudUploadOutline} />
        {busy ? 'Deploying...' : 'Stage and deploy'}
      </IonButton>
    </section>
  );
}

export function ControllersPage({ canManageFleet }: ControllersPageProps) {
  const history = useHistory();
  const [view, setView] = useState<ControllerView>(canManageFleet ? 'fleet' : 'setup');
  const [devices, setDevices] = useState<Device[]>([]);
  const [releases, setReleases] = useState<FirmwareCatalogRelease[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ControllerStatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(canManageFleet);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null);
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newMac, setNewMac] = useState('');

  const fetchDevices = async () => {
    if (!canManageFleet) return;
    try {
      setLoading(true);
      setError('');
      setDevices(await deviceApi.list());
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDevices(); }, [canManageFleet]);
  useEffect(() => {
    loadFirmwareCatalog()
      .then(setReleases)
      .catch((errorValue) => setError(errorValue instanceof Error ? errorValue.message : String(errorValue)))
      .finally(() => setCatalogLoading(false));
  }, []);

  const types = Array.from(new Set(devices.map((device) => device.device_type || 'unknown'))).sort();
  const sites = Array.from(new Set(devices.map((device) => String(device.site_id ?? 'unassigned')))).sort();
  const filtered = filterControllers(devices, { query, status: statusFilter, type: typeFilter, site: siteFilter });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleDevices = paginateControllers(filtered, currentPage, pageSize);
  const selectedDevice = devices.find((device) => device.device_id === selectedDeviceId) || null;
  const onlineCount = devices.filter((device) => device.online === true).length;

  const resetPage = () => setPage(1);

  const registerDevice = async () => {
    if (!newDeviceId.trim() || !newDisplayName.trim()) {
      setError('Controller ID and display name are required.');
      return;
    }
    try {
      setBusy(true);
      await deviceApi.create(newDeviceId.trim(), newDisplayName.trim(), newMac.trim() || undefined);
      setNewDeviceId('');
      setNewDisplayName('');
      setNewMac('');
      setShowRegister(false);
      await fetchDevices();
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
    } finally {
      setBusy(false);
    }
  };

  const deleteDevice = async () => {
    if (!deleteTarget) return;
    try {
      setBusy(true);
      await deviceApi.delete(deleteTarget.device_id);
      if (selectedDeviceId === deleteTarget.device_id) setSelectedDeviceId('');
      setDeleteTarget(null);
      await fetchDevices();
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
    } finally {
      setBusy(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title="Controllers" subtitle="Onboarding, fleet operations and firmware releases" />
      <IonContent className="ion-padding">
        <IonLoading isOpen={busy} message="Processing..." />
        <IonAlert
          isOpen={deleteTarget !== null}
          onDidDismiss={() => setDeleteTarget(null)}
          header="Delete controller"
          message={`Delete ${deleteTarget?.display_name || deleteTarget?.device_id || 'this controller'} from the registry?`}
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            { text: 'Delete', role: 'destructive', handler: () => { void deleteDevice(); } },
          ]}
        />

        <div className="controllers-workspace">
          <IonSegment value={view} onIonChange={(event) => setView(event.detail.value as ControllerView)}>
            {canManageFleet ? <IonSegmentButton value="fleet"><IonLabel>Fleet</IonLabel></IonSegmentButton> : null}
            <IonSegmentButton value="setup"><IonLabel>Add controller</IonLabel></IonSegmentButton>
          </IonSegment>

          {view === 'fleet' && canManageFleet ? (
            <>
              <section className="controller-summary">
                <div><span>Controllers</span><strong>{devices.length}</strong></div>
                <div><span>Online</span><strong>{onlineCount}</strong></div>
                <div><span>Offline</span><strong>{devices.length - onlineCount}</strong></div>
                <div><span>Filtered</span><strong>{filtered.length}</strong></div>
              </section>

              <section className="controller-toolbar" aria-label="Controller filters">
                <IonSearchbar
                  value={query}
                  debounce={200}
                  placeholder="Search ID, name, MAC or firmware"
                  onIonInput={(event) => { setQuery(event.detail.value || ''); resetPage(); }}
                />
                <label>Status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as ControllerStatusFilter); resetPage(); }}>
                  <option value="all">All</option><option value="online">Online</option><option value="offline">Offline</option>
                </select></label>
                <label>Type<select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); resetPage(); }}>
                  <option value="all">All</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}
                </select></label>
                <label>Site<select value={siteFilter} onChange={(event) => { setSiteFilter(event.target.value); resetPage(); }}>
                  <option value="all">All</option>{sites.map((site) => <option key={site} value={site}>{site === 'unassigned' ? 'Unassigned' : site}</option>)}
                </select></label>
                <button type="button" className="controller-icon-button" onClick={() => { void fetchDevices(); }} title="Refresh controllers">
                  <IonIcon icon={refreshOutline} aria-hidden="true" />
                </button>
              </section>

              {error ? <p className="controller-message controller-message--error">{error}</p> : null}
              <div className={`controller-fleet-layout${selectedDevice ? ' has-detail' : ''}`}>
                <section className="controller-list-panel">
                  {loading ? <div className="controller-loading"><IonSpinner name="crescent" /> Loading controllers...</div> : null}
                  {!loading && !visibleDevices.length ? <p className="controller-empty">No controllers match these filters.</p> : null}
                  {!loading && visibleDevices.length ? (
                    <div className="controller-table-wrap">
                      <table className="controller-table">
                        <thead><tr><th>Controller</th><th>Status</th><th>Type</th><th>Site</th><th>Firmware</th></tr></thead>
                        <tbody>{visibleDevices.map((device) => (
                          <tr key={device.device_id} className={selectedDeviceId === device.device_id ? 'is-selected' : ''} onClick={() => setSelectedDeviceId(device.device_id)}>
                            <td><strong>{device.display_name}</strong><span>{device.device_id}</span></td>
                            <td><span className={`controller-status ${device.online ? 'is-online' : 'is-offline'}`}>{device.online ? 'Online' : 'Offline'}</span></td>
                            <td>{device.device_type || 'Unknown'}</td>
                            <td>{device.site_id ?? 'Unassigned'}</td>
                            <td>{device.firmware_version || 'Unknown'}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : null}
                  <footer className="controller-pagination">
                    <span>{filtered.length ? `${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, filtered.length)} of ${filtered.length}` : '0 controllers'}</span>
                    <div>
                      <IonButton fill="clear" size="small" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</IonButton>
                      <span>{currentPage} / {pageCount}</span>
                      <IonButton fill="clear" size="small" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</IonButton>
                    </div>
                  </footer>
                </section>

                {selectedDevice ? (
                  <aside className="controller-detail">
                    <div className="controller-detail__heading">
                      <div><p className="controller-eyebrow">{selectedDevice.device_id}</p><h2>{selectedDevice.display_name}</h2></div>
                      <button type="button" className="controller-detail__close" onClick={() => setSelectedDeviceId('')} aria-label="Close controller details">×</button>
                    </div>
                    <dl className="controller-facts">
                      <div><dt>Status</dt><dd>{selectedDevice.online ? 'Online' : 'Offline'}</dd></div>
                      <div><dt>MQTT</dt><dd>{selectedDevice.mqtt_connected ? 'Connected' : 'Disconnected'}</dd></div>
                      <div><dt>MAC</dt><dd>{selectedDevice.mac || 'Unknown'}</dd></div>
                      <div><dt>Site</dt><dd>{selectedDevice.site_id ?? 'Unassigned'}</dd></div>
                    </dl>
                    <div className="controller-actions">
                      <IonButton size="small" fill="outline" onClick={() => history.push(`/app/devices/${encodeURIComponent(selectedDevice.device_id)}/history`)}>History</IonButton>
                      <IonButton size="small" fill="outline" color="danger" onClick={() => setDeleteTarget(selectedDevice)}>
                        <IonIcon slot="start" icon={trashOutline} /> Delete
                      </IonButton>
                    </div>
                    <ControllerFirmwarePanel device={selectedDevice} releases={releases} />
                  </aside>
                ) : null}
              </div>
            </>
          ) : null}

          {view === 'setup' ? (
            <div className="controller-setup-grid">
              <section className="controller-setup-primary">
                <p className="controller-eyebrow">Network onboarding</p>
                <h2>Connect a controller</h2>
                <p className="controller-muted">Discover a controller on the local network, claim it and assign it to a site.</p>
                <IonButton onClick={() => history.push('/app/onboarding/discover')}>
                  <IonIcon slot="start" icon={addOutline} /> Start onboarding
                </IonButton>
              </section>
              <section className="controller-setup-secondary">
                <p className="controller-eyebrow">USB recovery</p>
                <h2>Install or recover firmware</h2>
                <p className="controller-muted">Choose the exact controller family. USB installation may reset network and onboarding settings.</p>
                {catalogLoading ? <IonSpinner name="crescent" /> : releases.map((release) => (
                  <IonButton key={release.id} href={release.installerUrl} target="_blank" fill="outline">
                    <IonIcon slot="start" icon={openOutline} /> {release.name}
                  </IonButton>
                ))}
              </section>
              {canManageFleet ? (
                <section className="controller-register">
                  <div className="controller-detail__section-heading">
                    <div><p className="controller-eyebrow">Registry</p><h2>Manual registration</h2></div>
                    <IonButton fill="clear" size="small" onClick={() => setShowRegister(!showRegister)}>{showRegister ? 'Cancel' : 'Open form'}</IonButton>
                  </div>
                  {showRegister ? (
                    <div className="controller-register__fields">
                      <IonItem><IonLabel position="stacked">Controller ID</IonLabel><IonInput value={newDeviceId} onIonInput={(event) => setNewDeviceId(event.detail.value || '')} /></IonItem>
                      <IonItem><IonLabel position="stacked">Display name</IonLabel><IonInput value={newDisplayName} onIonInput={(event) => setNewDisplayName(event.detail.value || '')} /></IonItem>
                      <IonItem><IonLabel position="stacked">MAC address</IonLabel><IonInput value={newMac} onIonInput={(event) => setNewMac(event.detail.value || '')} /></IonItem>
                      <IonButton onClick={() => { void registerDevice(); }}>Register controller</IonButton>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </IonContent>
    </IonPage>
  );
}