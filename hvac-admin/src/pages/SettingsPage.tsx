import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonItem, IonLabel, IonList, IonPage, IonSelect, IonSelectOption, IonToggle } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { authApi } from '../api/auth';
import { apiClient } from '../api/client';
import { mobileApi } from '../api/mobile';

export function SettingsPage() {
  const history = useHistory();
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('theme_mode') === 'dark');
  const [sites, setSites] = useState<Array<{ site_id: string; site_name: string }>>([]);
  const [activeSite, setActiveSite] = useState('');

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
  }, []);

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
                <span className="text-sm text-muted">Admin</span>
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
            <ul className="text-sm text-muted mt-3 space-y-1">
              <li>Firmware Version</li>
              <li>Last Seen</li>
              <li>Gateway Status</li>
              <li>Signal Strength (future)</li>
            </ul>
          </details>

          <IonButton expand="block" color="medium" onClick={logout}>Logout</IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
}
