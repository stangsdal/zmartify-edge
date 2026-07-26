import { useState } from 'react';
import { IonButton, IonContent, IonInput, IonItem, IonLabel, IonLoading, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { deviceApi } from '../api/devices';
import { onboardingFlow } from '../utils/onboardingFlow';
import { parseApiError } from '../utils/apiError';

export function OnboardingDiscoverPage() {
  const history = useHistory();
  const [baseUrl, setBaseUrl] = useState(() => onboardingFlow.load().baseUrl || 'http://zmartify-irrigation.local');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const discover = async () => {
    try {
      setLoading(true);
      setError('');
      const discovery = await deviceApi.discover(baseUrl);
      const mode = discovery.status?.state === 'unclaimed' ? 'new' : 'reclaim';
      onboardingFlow.save({
        baseUrl,
        discovery,
        mode,
        claimToken: discovery.claim?.claim_token || '',
        displayName: discovery.identity.device_id,
        selectedDomainId: undefined,
        selectedSiteId: undefined,
        claimResult: undefined,
      });
      history.push('/app/onboarding/claim');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title="Onboarding" subtitle="Discover local controller" />
      <IonContent className="ion-padding">
        <IonLoading isOpen={loading} message="Discovering..." />
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Step 1 of 4</p>
            <h2 className="text-lg font-semibold mt-1">Discover irrigation controller</h2>
            <p className="text-sm text-muted mt-2">Use the controller URL, mDNS name or LAN IP while the device is on the same network.</p>
            <IonItem className="mt-3">
              <IonLabel position="stacked">Controller URL or IP</IonLabel>
              <IonInput
                value={baseUrl}
                onIonChange={(e) => setBaseUrl(e.detail.value || '')}
                placeholder="http://zmartify-irrigation.local"
              />
            </IonItem>
            <IonButton className="mt-4" expand="block" onClick={() => void discover()}>
              Discover
            </IonButton>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
