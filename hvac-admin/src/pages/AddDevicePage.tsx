import { useEffect, useState } from 'react';
import {
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

  useEffect(() => {
    const loadDomains = async () => {
      try {
        const domainData = await domainApi.list();
        setDomains(domainData);
      } catch (e) {
        setError(String(e));
      }
    };
    loadDomains();
  }, []);

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
        setSelectedSiteId(siteData[0]?.id);
      } catch (e) {
        setError(String(e));
      }
    };
    loadSites();
  }, [selectedDomainId]);

  const handleDiscover = async () => {
    try {
      setLoading(true);
      const result = await deviceApi.discover(baseUrl);
      setDiscovery(result);
      setClaimToken(result.claim.claim_token);
      setDisplayName(result.identity.device_id);
      setClaimResult(null);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!discovery || !selectedDomainId || !selectedSiteId) {
      setError('Discovery, domain, and site are required');
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
      setError('');
    } catch (e) {
      setError(String(e));
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
              <p><strong>Device ID:</strong> {discovery.identity.device_id}</p>
              <p><strong>MAC:</strong> {discovery.identity.mac}</p>
              <p><strong>Firmware:</strong> {discovery.identity.firmware_version}</p>
              <p><strong>Hardware:</strong> {discovery.identity.hardware}</p>
              <p><strong>Device State:</strong> {discovery.status.state}</p>

              <IonItem>
                <IonLabel position="stacked">Claim Token</IonLabel>
                <IonInput value={claimToken} onIonChange={(e) => setClaimToken(e.detail.value || '')} />
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
                Claim and Provision
              </IonButton>
            </IonCardContent>
          </IonCard>
        )}

        {claimResult && (
          <IonCard>
            <IonCardContent>
              <h3>Onboarding Result</h3>
              <p><strong>Registered Device:</strong> {claimResult.device.device_id}</p>
              <p><strong>Assigned Site ID:</strong> {claimResult.device.site_id}</p>
              <p><strong>Local URL:</strong> {claimResult.device.local_url}</p>
              <p><strong>Onboarding State:</strong> {claimResult.onboarding_status.state}</p>
              <p><strong>MQTT Configured:</strong> {claimResult.onboarding_status.mqtt_configured ? 'Yes' : 'No'}</p>
              <p><strong>MQTT Connected:</strong> {claimResult.onboarding_status.mqtt_connected ? 'Yes' : 'No'}</p>
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
