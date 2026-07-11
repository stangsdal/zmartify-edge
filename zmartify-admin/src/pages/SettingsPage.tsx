import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonItem, IonLabel, IonList, IonPage, IonSelect, IonSelectOption, IonToggle } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { authApi } from '../api/auth';
import { apiClient } from '../api/client';
import { mobileApi } from '../api/mobile';

interface DeviceHealthRow {
  deviceId: string;
  displayName: string;
  firmwareVersion: string;
  online: boolean;
  mqttConnected: boolean;
  freshnessAgeMs: number | null;
}

export function SettingsPage() {
  const history = useHistory();
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('theme_mode') === 'dark');
  const [sites, setSites] = useState<Array<{ site_id: string; site_name: string }>>([]);
  const [activeSite, setActiveSite] = useState('');
  const [profileLabel, setProfileLabel] = useState('Unknown');
  const [healthRows, setHealthRows] = useState<DeviceHealthRow[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);

  const formatAge = (ageMs: number | null): string => {
    if (ageMs == null) return 'Unknown';
    const seconds = Math.floor(ageMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    localStorage.setItem('theme_mode', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    mobileApi.listSites().then((res) => {
      const options = (res.sites || []).map((s) => ({ site_id: s.site_id, site_name: s.site_name }));
      setSites(options);
      if (options.length) setActiveSite(options[0].site_id);
    }).catch(console.error);

    authApi.me().then((me) => {
      const roleText = (me.roles || []).join(', ');
      setProfileLabel(roleText ? `${me.display_name} (${roleText})` : me.display_name || me.username || 'Unknown');
    }).catch(() => {
      setProfileLabel('Unknown');
    });
  }, []);

  useEffect(() => {
    if (!activeSite) {
      setHealthRows([]);
      return;
    }

    let cancelled = false;

    const loadHealth = async () => {
      setHealthLoading(true);
      try {
        const site = await mobileApi.getSite(activeSite);
        const rows = await Promise.all(
          (site.devices || []).map(async (device) => {
            const freshness = await mobileApi.getDeviceFreshness(device.device_id);
            return {
              deviceId: device.device_id,
              displayName: device.display_name,
              firmwareVersion: device.firmware_version || 'Unknown',
              online: freshness.device.online ?? device.online,
              mqttConnected: freshness.device.mqtt_connected ?? !!device.mqtt_connected,
              freshnessAgeMs: freshness.device.freshness_age_ms ?? null,
            };
          })
        );
        if (!cancelled) {
          setHealthRows(rows);
        }
      } catch {
        if (!cancelled) {
          setHealthRows([]);
        }
      } finally {
        if (!cancelled) {
          setHealthLoading(false);
        }
      }
    };

    loadHealth().catch(console.error);
    const timer = window.setInterval(() => {
      loadHealth().catch(console.error);
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSite]);

  const logout = async () => {
    // Always clear local session first so logout works even if backend call fails.
    apiClient.clearAuthToken();
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    history.replace('/app/login');
    // Force route change in case Ionic router state is stale.
    window.location.assign('/app/login');
  };

  return (
    <IonPage>
      <AppHeader title="Settings" subtitle="Profile, preferences and properties" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-8">
          <div className="rounded-2xl app-surface shadow-soft p-3">
            <IonList>
              <IonItem>
                <IonLabel>Profile</IonLabel>
                <span className="text-sm text-muted">{profileLabel}</span>
              </IonItem>
              <IonItem>
                <IonLabel>Notifications</IonLabel>
                <span className="text-sm text-muted">Enabled</span>
              </IonItem>
              <IonItem>
                <IonLabel>Theme</IonLabel>
                <IonToggle checked={darkMode} onIonChange={(e) => setDarkMode(e.detail.checked)} />
              </IonItem>
              <IonItem>
                <IonLabel>Privacy</IonLabel>
                <span className="text-sm text-muted">Local edge only</span>
              </IonItem>
            </IonList>
          </div>

          <div className="rounded-2xl app-surface shadow-soft p-4">
            <p className="font-semibold mb-2">Site Management</p>
            <IonItem>
              <IonLabel>Property</IonLabel>
              <IonSelect value={activeSite} onIonChange={(e) => setActiveSite(String(e.detail.value))}>
                {sites.map((site) => (
                  <IonSelectOption key={site.site_id} value={site.site_id}>{site.site_name}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
          </div>

          <details className="rounded-2xl app-surface shadow-soft p-4">
            <summary className="font-semibold cursor-pointer">Advanced Device Health</summary>
            {healthLoading ? <p className="text-sm text-muted mt-3">Loading device health...</p> : null}
            {!healthLoading && !healthRows.length ? <p className="text-sm text-muted mt-3">No devices in selected property.</p> : null}
            <div className="mt-3 space-y-2">
              {healthRows.map((row) => (
                <div key={row.deviceId} className="rounded-xl border border-slate-200/70 p-3 text-sm">
                  <p className="font-semibold">{row.displayName}</p>
                  <p className="text-muted">Firmware: {row.firmwareVersion}</p>
                  <p className="text-muted">Gateway: {row.online ? 'Online' : 'Offline'}</p>
                  <p className="text-muted">MQTT: {row.mqttConnected ? 'Connected' : 'Disconnected'}</p>
                  <p className="text-muted">Last Seen: {formatAge(row.freshnessAgeMs)}</p>
                </div>
              ))}
            </div>
          </details>

          <IonButton expand="block" color="medium" onClick={logout}>Logout</IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
}
