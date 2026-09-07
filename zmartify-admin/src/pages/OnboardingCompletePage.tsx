import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { deviceApi } from '../api/devices';
import { DeviceFreshness } from '../types/api';
import { onboardingFlow } from '../utils/onboardingFlow';
import { parseApiError } from '../utils/apiError';
import { useAccess } from '../auth/AccessContext';

function isConnectedSinceStaging(status: DeviceFreshness, stagedAt?: string): boolean {
  const updatedAt = status.device?.updated_at ? Date.parse(status.device.updated_at) : 0;
  const stagedAtMs = stagedAt ? Date.parse(stagedAt) : 0;
  return status.device?.online === true
    && status.device?.mqtt_connected === true
    && updatedAt >= stagedAtMs;
}

export function OnboardingCompletePage() {
  const history = useHistory();
  const { context, selectedSiteId } = useAccess();
  const flow = onboardingFlow.load();
  const deviceId = flow.deviceId || flow.claimResult?.device?.device_id;
  const [statusText, setStatusText] = useState('Waiting for the controller...');
  const [status, setStatus] = useState<DeviceFreshness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!deviceId) {
      history.replace('/app/onboarding/discover');
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        for (let i = 0; i < 200; i += 1) {
          const nextStatus = await deviceApi.getFreshness(deviceId);
          if (cancelled) return;
          setStatus(nextStatus);
          const connected = isConnectedSinceStaging(nextStatus, flow.stagedAt);
          setStatusText(connected ? 'Online and connected to Zmartify' : 'Waiting for ESPTouch and MQTT connection...');
          if (connected) {
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
        }
      } catch (e) {
        if (!cancelled) setError(parseApiError(e));
      }
    };

    poll().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  const refreshStatus = async () => {
    if (!deviceId) return;
    try {
      setBusy(true);
      const nextStatus = await deviceApi.getFreshness(deviceId);
      setStatus(nextStatus);
      setStatusText(isConnectedSinceStaging(nextStatus, flow.stagedAt)
        ? 'Online and connected to Zmartify'
        : 'Waiting for ESPTouch and MQTT connection...');
      setError('');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const selectedSite = context?.sites.find((site) => site.id === selectedSiteId);

  return (
    <IonPage>
      <AppHeader title="Onboarding" subtitle="Connect with ESPTouch V2" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Step 2 of 2</p>
            <h2 className="text-lg font-semibold mt-1">Connect controller to Wi-Fi</h2>
            <p className="text-sm text-muted mt-2">Device ID: {deviceId || 'n/a'}</p>
            <p className="text-sm text-muted mt-1">Claim code: <strong>{flow.claimToken || 'n/a'}</strong></p>
            <ol className="text-sm text-muted mt-3 list-decimal pl-5 space-y-1">
              <li>Open the official Espressif ESPTouch app and select ESPTouch V2.</li>
              <li>Enter the local 2.4 GHz Wi-Fi password.</li>
              <li>Enter <strong>{flow.claimToken || 'the claim code'}</strong> in Custom Data and start provisioning.</li>
              <li>Return here when ESPTouch reports success. Status updates automatically.</li>
            </ol>
            <p className="text-sm mt-2">Status: {statusText}</p>
            {status ? (
              <div className="text-sm text-muted mt-2">
                <p>Online: {isConnectedSinceStaging(status, flow.stagedAt) ? 'Yes' : 'No'}</p>
                <p>MQTT Connected: {isConnectedSinceStaging(status, flow.stagedAt) ? 'Yes' : 'No'}</p>
              </div>
            ) : null}
            <div className="mt-4 flex gap-2">
              <IonButton fill="outline" onClick={() => void refreshStatus()} disabled={busy}>
                Refresh status
              </IonButton>
            </div>
            <div className="mt-2 flex gap-2">
              <IonButton
                fill="outline"
                onClick={() => {
                  onboardingFlow.clear();
                  history.push('/app/onboarding/discover');
                }}
              >
                New onboarding
              </IonButton>
              <IonButton onClick={() => history.push(selectedSite ? `/app/sites/${selectedSite.uuid || selectedSite.id}/hvac` : '/app/devices')}>
                Open HVAC
              </IonButton>
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
