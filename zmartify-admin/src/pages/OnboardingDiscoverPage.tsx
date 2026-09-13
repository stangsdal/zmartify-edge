import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner';
import {
  EspProvisioning,
  ESPSecurity,
  ESPTransport,
  type ESPNetwork,
} from '@general-galactic/capacitor-esp-idf-provisioning';
import { IonButton, IonContent, IonIcon, IonInput, IonItem, IonLabel, IonLoading, IonPage, IonSelect, IonSelectOption } from '@ionic/react';
import { bluetoothOutline, qrCodeOutline } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { deviceApi } from '../api/devices';
import { onboardingFlow } from '../utils/onboardingFlow';
import { parseApiError } from '../utils/apiError';
import { parseControllerIdentity, parseFactoryLabel } from '../utils/factoryLabel';
import { useAccess } from '../auth/AccessContext';

function generateClaimToken(): string {
  const value = new Uint32Array(1);
  window.crypto.getRandomValues(value);
  return String(value[0] % 1_000_000).padStart(6, '0');
}

export function OnboardingDiscoverPage() {
  const history = useHistory();
  const { context, isAdministrator } = useAccess();
  const flow = onboardingFlow.load();
  const [controllerIdentity, setControllerIdentity] = useState(flow.deviceId || flow.mac || '');
  const [pairingCode, setPairingCode] = useState('');
  const [claimToken] = useState(generateClaimToken);
  const [displayName, setDisplayName] = useState(flow.displayName || 'AHC9000 controller');
  const [domainId, setDomainId] = useState<number | undefined>(flow.selectedDomainId);
  const [siteId, setSiteId] = useState<number | undefined>(flow.selectedSiteId);
  const [bleDeviceName, setBleDeviceName] = useState('');
  const [networks, setNetworks] = useState<ESPNetwork[]>([]);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [progressMessage, setProgressMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const nativePlatform = Capacitor.isNativePlatform();

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deviceId = params.get('device_id');
    const pairingCode = params.get('pairing_code');
    if (deviceId && parseControllerIdentity(deviceId)) setControllerIdentity(deviceId);
    if (pairingCode && /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/i.test(pairingCode)) setPairingCode(pairingCode.toUpperCase());
  }, []);

  const validateForm = () => {
    const identity = parseControllerIdentity(controllerIdentity);
    if (!identity) throw new Error('Enter the controller MAC address or its full device ID.');
    if (nativePlatform && !/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(pairingCode)) {
      throw new Error('Enter the pairing code printed on the controller label.');
    }
    if (!domainId || !siteId || !displayName.trim()) throw new Error('Display name, domain and site are required.');
    return identity;
  };

  const saveStagedFlow = (identity: { deviceId: string; mac: string }, result: Awaited<ReturnType<typeof deviceApi.stageBootstrap>>) => {
    onboardingFlow.save({
      baseUrl: '',
      deviceId: identity.deviceId,
      mac: identity.mac,
      claimToken,
      displayName: displayName.trim(),
      selectedDomainId: domainId,
      selectedSiteId: siteId,
      claimResult: result,
      stagedAt: new Date().toISOString(),
      expiresAt: result.expires_at,
    });
  };

  const scanFactoryLabel = async () => {
    try {
      setError('');
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
        scanInstructions: 'Scan the QR code on the controller',
      });
      const label = parseFactoryLabel(result.ScanResult);
      if (!label) throw new Error('This is not a valid Zmartify controller label.');
      setControllerIdentity(label.deviceId);
      setPairingCode(label.pairingCode);
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  const connectBle = async () => {
    try {
      setLoading(true);
      setError('');
      setProgressMessage('Looking for controller...');
      const identity = validateForm();
      if (Capacitor.getPlatform() === 'ios') {
        await EspProvisioning.checkStatus();
      }
      const permissions = await EspProvisioning.requestPermissions();
      if (permissions.ble !== 'granted' || permissions.location === 'denied') {
        throw new Error('Bluetooth permission is required to connect the controller.');
      }
      const status = await EspProvisioning.checkStatus();
      if (!status.ble.supported || !status.ble.allowed || !status.ble.poweredOn) {
        throw new Error('Turn on Bluetooth and allow access for Zmartify HVAC.');
      }
      const suffix = identity.mac.replace(/:/g, '').slice(-6);
      const result = await EspProvisioning.searchESPDevices({
        devicePrefix: 'ZMART_',
        transport: ESPTransport.ble,
        security: ESPSecurity.secure,
      });
      const device = result.devices?.find((candidate) => candidate.name.toUpperCase().endsWith(suffix));
      if (!device) throw new Error('The controller was not found nearby. Check that it is powered and not already connected to Wi-Fi.');
      const connection = await EspProvisioning.connect({ deviceName: device.name, proofOfPossession: pairingCode });
      if (!connection.connected) throw new Error('Could not authenticate the controller. Check the pairing code.');
      setBleDeviceName(device.name);
      setProgressMessage('Scanning Wi-Fi networks...');
      const scan = await EspProvisioning.scanWifiList({ deviceName: device.name });
      const sortedNetworks = [...(scan.networks || [])].sort((left, right) => right.rssi - left.rssi);
      setNetworks(sortedNetworks);
      setWifiSsid(sortedNetworks[0]?.ssid || '');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
      setProgressMessage('');
    }
  };

  const stage = async () => {
    try {
      setLoading(true);
      setError('');
      const identity = validateForm();
      const result = await deviceApi.stageBootstrap({
        device_id: identity.deviceId,
        claim_token: claimToken,
        domain_id: domainId!,
        site_id: siteId!,
        display_name: displayName.trim(),
        mac: identity.mac,
        product_type: 'hvac',
      });
      saveStagedFlow(identity, result);
      history.push('/app/onboarding/complete');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const provision = async () => {
    if (!bleDeviceName || !wifiSsid) {
      setError('Connect the controller and select a Wi-Fi network first.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const identity = validateForm();
      setProgressMessage('Preparing controller...');
      const result = await deviceApi.stageBootstrap({
        device_id: identity.deviceId,
        claim_token: claimToken,
        domain_id: domainId!,
        site_id: siteId!,
        display_name: displayName.trim(),
        mac: identity.mac,
        product_type: 'hvac',
      });
      saveStagedFlow(identity, result);
      const customData = await EspProvisioning.sendCustomDataString({
        deviceName: bleDeviceName,
        path: 'zmartify-claim',
        dataString: claimToken,
      });
      if (!customData.success || customData.returnString?.replace(/\0/g, '') !== 'SUCCESS') {
        throw new Error('The controller rejected the onboarding claim.');
      }
      setProgressMessage('Connecting controller to Wi-Fi...');
      const provisioned = await EspProvisioning.provision({
        deviceName: bleDeviceName,
        ssid: wifiSsid,
        passPhrase: wifiPassword,
      });
      if (!provisioned.success) throw new Error('The controller could not connect to the selected Wi-Fi network.');
      history.push('/app/onboarding/complete');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      await EspProvisioning.disconnect({ deviceName: bleDeviceName }).catch(() => undefined);
      setLoading(false);
      setProgressMessage('');
    }
  };

  return (
    <IonPage>
      <AppHeader title="Onboarding" subtitle="Connect AHC9000 controller" />
      <IonContent className="ion-padding">
        <IonLoading isOpen={loading} message={progressMessage || 'Preparing...'} />
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Step 1 of 2</p>
            <h2 className="text-lg font-semibold mt-1">Prepare controller</h2>
            <p className="text-sm text-muted mt-2">Scan the controller label and connect it directly to the local Wi-Fi network.</p>
            {nativePlatform ? (
              <IonButton className="mt-3" expand="block" fill="outline" onClick={() => void scanFactoryLabel()} disabled={loading}>
                <IonIcon slot="start" icon={qrCodeOutline} />
                Scan controller label
              </IonButton>
            ) : null}
            <IonItem className="mt-3">
              <IonLabel position="stacked">Controller MAC or device ID</IonLabel>
              <IonInput
                value={controllerIdentity}
                onIonChange={(e) => setControllerIdentity(e.detail.value || '')}
                placeholder="AA:BB:CC:DD:EE:FF"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Pairing code</IonLabel>
              <IonInput
                maxlength={19}
                value={nativePlatform ? pairingCode : claimToken}
                onIonChange={(e) => nativePlatform
                  ? setPairingCode((e.detail.value || '').toUpperCase().replace(/[^A-Z2-7-]/g, '').slice(0, 19))
                  : undefined}
                readonly={!nativePlatform}
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
            {nativePlatform && !bleDeviceName ? (
              <IonButton className="mt-4" expand="block" onClick={() => void connectBle()} disabled={loading}>
                <IonIcon slot="start" icon={bluetoothOutline} />
                Connect controller
              </IonButton>
            ) : null}
            {nativePlatform && bleDeviceName ? (
              <>
                <IonItem className="mt-3">
                  <IonLabel position="stacked">Wi-Fi network</IonLabel>
                  <IonSelect value={wifiSsid} onIonChange={(e) => setWifiSsid(String(e.detail.value || ''))}>
                    {networks.map((network) => <IonSelectOption key={network.ssid} value={network.ssid}>{network.ssid}</IonSelectOption>)}
                  </IonSelect>
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Wi-Fi password</IonLabel>
                  <IonInput type="password" value={wifiPassword} onIonChange={(e) => setWifiPassword(e.detail.value || '')} />
                </IonItem>
                <IonButton className="mt-4" expand="block" onClick={() => void provision()} disabled={loading || !wifiSsid}>
                  Connect to Wi-Fi
                </IonButton>
              </>
            ) : null}
            {!nativePlatform ? (
              <IonButton className="mt-4" expand="block" onClick={() => void stage()} disabled={loading}>
                Stage for ESPTouch
              </IonButton>
            ) : null}
            <IonButton className="mt-2" expand="block" fill="outline" href="/app/firmware/ahc9000/index.html" target="_blank">
              USB recovery
            </IonButton>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
