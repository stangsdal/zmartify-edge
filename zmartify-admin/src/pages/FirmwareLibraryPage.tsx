import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonIcon, IonPage, IonSpinner } from '@ionic/react';
import { downloadOutline, openOutline } from 'ionicons/icons';
import { FirmwareCatalogRelease, loadFirmwareCatalog } from '../api/firmwareCatalog';
import { AppHeader } from '../components/AppHeader';

export function FirmwareLibraryPage() {
  const [releases, setReleases] = useState<FirmwareCatalogRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadFirmwareCatalog()
      .then(setReleases)
      .catch((errorValue) => setError(errorValue instanceof Error ? errorValue.message : String(errorValue)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <IonPage>
      <AppHeader title="Firmware library" subtitle="Published controller releases and installation artifacts" />
      <IonContent className="ion-padding">
        <div className="controllers-workspace">
          {loading ? <div className="controller-loading"><IonSpinner name="crescent" /> Loading firmware catalog...</div> : null}
          {error ? <p className="controller-message controller-message--error">{error}</p> : null}
          {!loading && !error ? (
            <div className="firmware-library-grid">
              {releases.map((release) => (
                <article key={`${release.id}:${release.version}`} className="firmware-release">
                  <div>
                    <p className="controller-eyebrow">{release.category}</p>
                    <h2>{release.name}</h2>
                    <p className="controller-muted">{release.description}</p>
                  </div>
                  <dl className="controller-facts">
                    <div><dt>Version</dt><dd>{release.version}</dd></div>
                    <div><dt>Target</dt><dd>{release.chipFamily}</dd></div>
                    <div><dt>OTA</dt><dd>{release.otaUrl ? 'Available' : 'Not published'}</dd></div>
                    <div><dt>Recovery</dt><dd>{release.recoveryFilename}</dd></div>
                  </dl>
                  <div className="controller-actions">
                    <IonButton href={release.installerUrl} target="_blank" size="small" disabled={release.version !== release.latest}>
                      <IonIcon slot="start" icon={openOutline} /> USB installer
                    </IonButton>
                    <IonButton href={release.recoveryUrl || undefined} download={release.recoveryFilename} fill="outline" size="small" disabled={!release.recoveryUrl}>
                      <IonIcon slot="start" icon={downloadOutline} /> Recovery image
                    </IonButton>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </IonContent>
    </IonPage>
  );
}