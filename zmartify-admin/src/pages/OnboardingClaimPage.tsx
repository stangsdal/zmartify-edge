import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonInput, IonItem, IonLabel, IonPage, IonSelect, IonSelectOption } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { domainApi } from '../api/domains';
import { siteApi } from '../api/sites';
import { deviceApi } from '../api/devices';
import { Domain, Site } from '../types/api';
import { onboardingFlow } from '../utils/onboardingFlow';

export function OnboardingClaimPage() {
  const history = useHistory();
  const flow = onboardingFlow.load();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [claimToken, setClaimToken] = useState(flow.claimToken || '');
  const [displayName, setDisplayName] = useState(flow.displayName || '');
  const [domainId, setDomainId] = useState<number | undefined>(flow.selectedDomainId);
  const [siteId, setSiteId] = useState<number | undefined>(flow.selectedSiteId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!flow.discovery) {
      history.replace('/app/onboarding/discover');
      return;
    }
    domainApi
      .list()
      .then((rows) => {
        setDomains(rows);
        if (!domainId && rows.length) setDomainId(rows[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!domainId) {
      setSites([]);
      setSiteId(undefined);
      return;
    }
    siteApi
      .listByDomain(domainId)
      .then((rows) => {
        setSites(rows);
        if (!siteId && rows.length) setSiteId(rows[0].id);
      })
      .catch((e) => setError(String(e)));
  }, [domainId]);

  const claim = async () => {
    if (!flow.discovery || !domainId || !siteId) {
      setError('Discovery data, domain and site are required.');
      return;
    }
    if (flow.mode === 'new' && !claimToken.trim()) {
      setError('Claim token is required for unclaimed devices.');
      return;
    }
    try {
      setLoading(true);
      const result = await deviceApi.claim({
        base_url: flow.baseUrl,
        claim_token: claimToken.trim() || undefined,
        domain_id: domainId,
        site_id: siteId,
        display_name: displayName || flow.discovery.identity.device_id,
      });
      onboardingFlow.patch({
        claimToken,
        displayName,
        selectedDomainId: domainId,
        selectedSiteId: siteId,
        claimResult: result,
      });
      history.push('/app/onboarding/assign-site');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title="Onboarding" subtitle="Claim and provision" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Step 2 of 4</p>
            <h2 className="text-lg font-semibold mt-1">Claim device</h2>
            {flow.discovery ? (
              <div className="text-sm mt-2 text-muted">
                <p>Device: {flow.discovery.identity.device_id}</p>
                <p>Firmware: {flow.discovery.identity.firmware_version}</p>
                <p>State: {flow.discovery.status.state}</p>
              </div>
            ) : null}

            <IonItem className="mt-3">
              <IonLabel position="stacked">Claim token</IonLabel>
              <IonInput value={claimToken} onIonChange={(e) => setClaimToken(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Display name</IonLabel>
              <IonInput value={displayName} onIonChange={(e) => setDisplayName(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Domain</IonLabel>
              <IonSelect value={domainId} onIonChange={(e) => setDomainId(Number(e.detail.value))}>
                {domains.map((domain) => (
                  <IonSelectOption key={domain.id} value={domain.id}>
                    {domain.name}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Site</IonLabel>
              <IonSelect value={siteId} onIonChange={(e) => setSiteId(Number(e.detail.value))}>
                {sites.map((site) => (
                  <IonSelectOption key={site.id} value={site.id}>
                    {site.name}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>

            <div className="mt-4 flex gap-2">
              <IonButton fill="outline" onClick={() => history.push('/app/onboarding/discover')}>
                Back
              </IonButton>
              <IonButton onClick={() => void claim()} disabled={loading}>
                {loading ? 'Claiming...' : 'Claim'}
              </IonButton>
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
