import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonInput, IonItem, IonLabel, IonLoading, IonPage, IonSelect, IonSelectOption } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { deviceApi } from '../api/devices';
import { onboardingFlow } from '../utils/onboardingFlow';
import { parseApiError } from '../utils/apiError';
import { useAccess } from '../auth/AccessContext';

const DEVICE_ID_PREFIX = 'zmartify-hvac-ahc9000-';

function generateClaimToken(): string {
  const value = new Uint32Array(1);
  window.crypto.getRandomValues(value);
  return String(value[0] % 1_000_000).padStart(6, '0');
}

function parseControllerIdentity(value: string): { deviceId: string; mac: string } | null {
  const normalized = value.trim().toLowerCase();
  const macHex = normalized.startsWith(DEVICE_ID_PREFIX)
    ? normalized.slice(DEVICE_ID_PREFIX.length)
    : normalized.replace(/[^0-9a-f]/g, '');
  if (!/^[0-9a-f]{12}$/.test(macHex)) return null;
  return {
    deviceId: `${DEVICE_ID_PREFIX}${macHex}`,
    mac: macHex.match(/.{2}/g)?.join(':').toUpperCase() || '',
  };
}

export function OnboardingDiscoverPage() {
  const history = useHistory();
  const { context, isAdministrator } = useAccess();
  const flow = onboardingFlow.load();
  const [controllerIdentity, setControllerIdentity] = useState(flow.deviceId || flow.mac || '');
  const [claimToken, setClaimToken] = useState(() => /^[0-9]{6}$/.test(flow.claimToken || '') ? flow.claimToken || '' : generateClaimToken());
  const [displayName, setDisplayName] = useState(flow.displayName || 'AHC9000 controller');
  const [domainId, setDomainId] = useState<number | undefined>(flow.selectedDomainId);
  const [siteId, setSiteId] = useState<number | undefined>(flow.selectedSiteId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ownerSites = (context?.sites || []).filter((site) => isAdministrator || site.role === 'owner');
  const domains = Array.from(new Map(ownerSites.map((site) => [site.domain_id, {
    id: site.domain_id,
    name: site.domain_name,
  }])).values());
  const sites = ownerSites.filter((site) => site.domain_id === domainId);

  useEffect(() => {
    setDomainId((current) => domains.some((domain) => domain.id === current) ? current : domains[0]?.id);
  }, [context, isAdministrator]);

  useEffect(() => {
    setSiteId((current) => sites.some((site) => site.id === current) ? current : sites[0]?.id);
  }, [domainId, context, isAdministrator]);

  const stage = async () => {
    const identity = parseControllerIdentity(controllerIdentity);
    if (!identity) {
      setError('Enter the controller MAC address or its full device ID.');
      return;
    }
    if (!/^[0-9]{6}$/.test(claimToken)) {
      setError('The claim code must contain exactly six digits.');
      return;
    }
    if (!domainId || !siteId || !displayName.trim()) {
      setError('Display name, domain and site are required.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const stagedAt = new Date().toISOString();
      const result = await deviceApi.stageBootstrap({
        device_id: identity.deviceId,
        claim_token: claimToken,
        domain_id: domainId,
        site_id: siteId,
        display_name: displayName.trim(),
        mac: identity.mac,
        product_type: 'hvac',
      });
      onboardingFlow.save({
        baseUrl: '',
        deviceId: identity.deviceId,
        mac: identity.mac,
        claimToken,
        displayName: displayName.trim(),
        selectedDomainId: domainId,
        selectedSiteId: siteId,
        claimResult: result,
        stagedAt,
        expiresAt: result.expires_at,
      });
      history.push('/app/onboarding/complete');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title="Onboarding" subtitle="Connect AHC9000 controller" />
      <IonContent className="ion-padding">
        <IonLoading isOpen={loading} message="Discovering..." />
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Step 1 of 2</p>
            <h2 className="text-lg font-semibold mt-1">Prepare controller</h2>
            <p className="text-sm text-muted mt-2">Stage a one-time code, then enter the same code as Custom Data in ESPTouch V2. No controller IP address is required.</p>
            <IonItem className="mt-3">
              <IonLabel position="stacked">Controller MAC or device ID</IonLabel>
              <IonInput
                value={controllerIdentity}
                onIonChange={(e) => setControllerIdentity(e.detail.value || '')}
                placeholder="AA:BB:CC:DD:EE:FF"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Six-digit claim code</IonLabel>
              <IonInput
                inputMode="numeric"
                maxlength={6}
                value={claimToken}
                onIonChange={(e) => setClaimToken((e.detail.value || '').replace(/\D/g, '').slice(0, 6))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Display name</IonLabel>
              <IonInput value={displayName} onIonChange={(e) => setDisplayName(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Domain</IonLabel>
              <IonSelect value={domainId} onIonChange={(e) => setDomainId(Number(e.detail.value))}>
                {domains.map((domain) => <IonSelectOption key={domain.id} value={domain.id}>{domain.name}</IonSelectOption>)}
              </IonSelect>
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Site</IonLabel>
              <IonSelect value={siteId} onIonChange={(e) => setSiteId(Number(e.detail.value))}>
                {sites.map((site) => <IonSelectOption key={site.id} value={site.id}>{site.name}</IonSelectOption>)}
              </IonSelect>
            </IonItem>
            <IonButton className="mt-4" expand="block" onClick={() => void stage()} disabled={loading}>
              Stage controller
            </IonButton>
            <IonButton className="mt-2" expand="block" fill="outline" href="/app/firmware/ahc9000/index.html" target="_blank">
              USB recovery
            </IonButton>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
