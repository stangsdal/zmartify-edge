import { useEffect, useState } from 'react';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonLoading,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { deviceApi } from '../api/devices';
import { domainApi } from '../api/domains';
import { siteApi } from '../api/sites';
import { DeviceClaimRequest, DeviceDiscovery, Domain, Site } from '../types/api';

export function AddDevicePage() {
  type OnboardingMode = 'new' | 'reclaim';

  const history = useHistory();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [baseUrl, setBaseUrl] = useState('http://192.168.10.57');
  const [claimToken, setClaimToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedDomainId, setSelectedDomainId] = useState<number | undefined>(undefined);
  const [selectedSiteId, setSelectedSiteId] = useState<number | undefined>(undefined);
  const [discovery, setDiscovery] = useState<DeviceDiscovery | null>(null);
  const [claimResult, setClaimResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<OnboardingMode>('new');
  const [statusPolling, setStatusPolling] = useState(false);
  const [liveStatus, setLiveStatus] = useState<any>(null);

  const parseApiError = (raw: unknown): string => {
    const message = String(raw || 'Unknown error');
    const jsonStart = message.indexOf('{');
    if (jsonStart >= 0) {
      try {
        const body = JSON.parse(message.slice(jsonStart));
        if (typeof body?.detail === 'string' && body.detail.trim()) {
          return body.detail;
        }
      } catch {
        // Fall back to original message.
      }
    }
    if (/Network error while calling/i.test(message)) {
      return 'Unable to reach backend. Check internet/API URL and try again.';
    }
    return message;
  };

  useEffect(() => {
    const loadDomains = async () => {
      try {
        const domainData = await domainApi.list();
        setDomains(domainData);
        if (!selectedDomainId && domainData.length) {
          setSelectedDomainId(domainData[0].id);
        }
      } catch (e) {
        setError(parseApiError(e));
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    loadDomains();
  }, [selectedDomainId]);

  useEffect(() => {
    const loadSites = async () => {
      if (!selectedDomainId) {
        setSites([]);
        setSelectedSiteId(undefined);
        return;
      }
      try {
        const siteData = await siteApi.listByDomain(selectedDomainId);
        setSites(siteData);
        if (siteData.length && !siteData.some((s: Site) => s.id === selectedSiteId)) {
          setSelectedSiteId(siteData[0].id);
        }
      } catch (e) {
        setError(parseApiError(e));
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    loadSites();
  }, [selectedDomainId, selectedSiteId]);

  const pollOnboardingStatus = async (deviceId: string, attempts = 18): Promise<void> => {
    setStatusPolling(true);
    try {
      for (let i = 0; i < attempts; i += 1) {
        const status = await deviceApi.getOnboardingStatus(deviceId);
        setLiveStatus(status);
        if (status?.state === 'online' && status?.mqtt_connected) {
          return;
        }
        // Wait 2.5s between status checks.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
      }
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setStatusPolling(false);
    }
  };

  const handleDiscover = async () => {
    try {
      setLoading(true);
      setError('');
      const result = await deviceApi.discover(baseUrl);
      setDiscovery(result);
      setBaseUrl(result.base_url || baseUrl);
      const isUnclaimed = result.status?.state === 'unclaimed';
      setMode(isUnclaimed ? 'new' : 'reclaim');
      setClaimToken(isUnclaimed ? result.claim?.claim_token || '' : '');
      setDisplayName(result.identity.device_id);
      setClaimResult(null);
      setLiveStatus(null);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!discovery || !selectedDomainId || !selectedSiteId) {
      setError('Discovery, domain, and site are required');
      return;
    }
    if (mode === 'new' && !claimToken.trim()) {
      setError('Claim token is required for new/unregistered devices. Run Discover again or paste the token from the gateway.');
      return;
    }

    try {
      setLoading(true);
      const payload: DeviceClaimRequest = {
        base_url: baseUrl,
        domain_id: selectedDomainId,
        site_id: selectedSiteId,
        display_name: displayName,
      };
      if (claimToken.trim()) {
        payload.claim_token = claimToken.trim();
      }
      const result = await deviceApi.claim(payload);
      setClaimResult(result);
      setLiveStatus(result.onboarding_status || null);
      setError('');
      if (result?.device?.device_id) {
        void pollOnboardingStatus(result.device.device_id);
      }
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePushConfigAgain = async () => {
    if (!claimResult?.device?.device_id) return;
    try {
      setLoading(true);
      const status = await deviceApi.pushConfig(claimResult.device.device_id, {});
      setLiveStatus(status);
      setError('');
      void pollOnboardingStatus(claimResult.device.device_id, 12);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Add Device</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonLoading isOpen={loading} message="Working..." />

        {error && (
          <IonCard>
            <IonCardContent style={{ color: 'red' }}>{error}</IonCardContent>
          </IonCard>
        )}

        <IonCard>
          <IonCardContent>
            <h3>Discover ESP32 Gateway</h3>
            <p>Step 1 of 3: Enter local ESP32 IP and discover onboarding state.</p>
            <IonItem>
              <IonLabel position="stacked">Gateway URL or IP</IonLabel>
              <IonInput
                value={baseUrl}
                onIonChange={(e) => setBaseUrl(e.detail.value || '')}
                placeholder="http://192.168.10.57"
              />
            </IonItem>
            <IonButton expand="block" className="ion-margin-top" onClick={handleDiscover}>
              Discover Device
            </IonButton>
          </IonCardContent>
        </IonCard>

        {discovery && (
          <IonCard>
            <IonCardContent>
              <h3>Claim Device</h3>
              <p>Step 2 of 3: Confirm assignment and provision credentials.</p>
              <div style={{ marginBottom: 12 }}>
                <IonBadge color={mode === 'new' ? 'primary' : 'warning'}>
                  {mode === 'new' ? 'New Device Claim' : 'Re-Claim Existing Device'}
                </IonBadge>
              </div>
              <p><strong>Device ID:</strong> {discovery.identity.device_id}</p>
              <p><strong>MAC:</strong> {discovery.identity.mac}</p>
              <p><strong>Firmware:</strong> {discovery.identity.firmware_version}</p>
              <p><strong>Hardware:</strong> {discovery.identity.hardware}</p>
              <p><strong>Device State:</strong> {discovery.status.state}</p>
              {discovery.claim?.error ? <p><strong>Discovery Note:</strong> {discovery.claim.error}</p> : null}

              <IonItem>
                <IonLabel position="stacked">Claim Token {mode === 'new' ? '(required)' : '(optional for re-claim)'}</IonLabel>
                <IonInput
                  value={claimToken}
                  onIonChange={(e) => setClaimToken(e.detail.value || '')}
                  placeholder={mode === 'new' ? 'Paste claim token' : 'Leave blank for owner/admin re-claim'}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Display Name</IonLabel>
                <IonInput value={displayName} onIonChange={(e) => setDisplayName(e.detail.value || '')} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Domain</IonLabel>
                <IonSelect value={selectedDomainId} onIonChange={(e) => setSelectedDomainId(Number(e.detail.value))}>
                  {domains.map((domain) => (
                    <IonSelectOption key={domain.id} value={domain.id}>{domain.name}</IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Site</IonLabel>
                <IonSelect value={selectedSiteId} onIonChange={(e) => setSelectedSiteId(Number(e.detail.value))}>
                  {sites.map((site) => (
                    <IonSelectOption key={site.id} value={site.id}>{site.name}</IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>

              <IonButton expand="block" className="ion-margin-top" onClick={handleClaim}>
                {mode === 'new' ? 'Claim and Provision' : 'Re-Claim and Re-Provision'}
              </IonButton>
            </IonCardContent>
          </IonCard>
        )}

        {claimResult && (
          <IonCard>
            <IonCardContent>
              <h3>Onboarding Result</h3>
              <p>Step 3 of 3: Verify device reaches online MQTT state.</p>
              <p><strong>Registered Device:</strong> {claimResult.device.device_id}</p>
              <p><strong>Assigned Site ID:</strong> {claimResult.device.site_id}</p>
              <p><strong>Local URL:</strong> {claimResult.device.local_url}</p>
              <p><strong>Onboarding State:</strong> {(liveStatus || claimResult.onboarding_status).state}</p>
              <p><strong>MQTT Configured:</strong> {(liveStatus || claimResult.onboarding_status).mqtt_configured ? 'Yes' : 'No'}</p>
              <p><strong>MQTT Connected:</strong> {(liveStatus || claimResult.onboarding_status).mqtt_connected ? 'Yes' : 'No'}</p>
              {statusPolling ? <p><strong>Status:</strong> Waiting for device to come online...</p> : null}
              {((liveStatus || claimResult.onboarding_status).last_error) ? (
                <p><strong>Last Error:</strong> {(liveStatus || claimResult.onboarding_status).last_error}</p>
              ) : null}
              <IonButton
                expand="block"
                fill="outline"
                className="ion-margin-top"
                onClick={() => {
                  void pollOnboardingStatus(claimResult.device.device_id, 8);
                }}
              >
                Refresh Onboarding Status
              </IonButton>
              <IonButton
                expand="block"
                fill="outline"
                className="ion-margin-top"
                onClick={handlePushConfigAgain}
              >
                Push Config Again
              </IonButton>
              <IonButton expand="block" fill="outline" className="ion-margin-top" onClick={() => history.push('/devices')}>
                Back to Devices
              </IonButton>
            </IonCardContent>
          </IonCard>
        )}
      </IonContent>
    </IonPage>
  );
}
