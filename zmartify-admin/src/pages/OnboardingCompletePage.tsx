import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { deviceApi } from '../api/devices';
import { onboardingFlow } from '../utils/onboardingFlow';

export function OnboardingCompletePage() {
  const history = useHistory();
  const flow = onboardingFlow.load();
  const deviceId = flow.claimResult?.device?.device_id;
  const [statusText, setStatusText] = useState('Checking device status...');
  const [status, setStatus] = useState<any>(flow.claimResult?.onboarding_status || null);
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
        for (let i = 0; i < 15; i += 1) {
          const nextStatus = await deviceApi.getOnboardingStatus(deviceId);
          if (cancelled) return;
          setStatus(nextStatus);
          const stateText = `${nextStatus.state} · MQTT ${nextStatus.mqtt_connected ? 'connected' : 'not connected'}`;
          setStatusText(stateText);
          if (nextStatus.state === 'online' && nextStatus.mqtt_connected) {
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
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
      const nextStatus = await deviceApi.getOnboardingStatus(deviceId);
      setStatus(nextStatus);
      setStatusText(`${nextStatus.state} · MQTT ${nextStatus.mqtt_connected ? 'connected' : 'not connected'}`);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pushConfigAgain = async () => {
    if (!deviceId) return;
    try {
      setBusy(true);
      const nextStatus = await deviceApi.pushConfig(deviceId, {});
      setStatus(nextStatus);
      setStatusText(`${nextStatus.state} · MQTT ${nextStatus.mqtt_connected ? 'connected' : 'not connected'}`);
      setError('');
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title="Onboarding" subtitle="Completed" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Step 4 of 4</p>
            <h2 className="text-lg font-semibold mt-1">Device provisioned</h2>
            <p className="text-sm text-muted mt-2">Device ID: {deviceId || 'n/a'}</p>
            <p className="text-sm mt-2">Status: {statusText}</p>
            {status ? (
              <div className="text-sm text-muted mt-2">
                <p>State: {status.state || 'unknown'}</p>
                <p>MQTT Configured: {status.mqtt_configured ? 'Yes' : 'No'}</p>
                <p>MQTT Connected: {status.mqtt_connected ? 'Yes' : 'No'}</p>
                {status.last_error ? <p>Last Error: {String(status.last_error)}</p> : null}
              </div>
            ) : null}
            <div className="mt-4 flex gap-2">
              <IonButton fill="outline" onClick={() => void refreshStatus()} disabled={busy}>
                Refresh status
              </IonButton>
              <IonButton fill="outline" onClick={() => void pushConfigAgain()} disabled={busy}>
                Push config again
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
              <IonButton onClick={() => history.push('/app/devices')}>Go to devices</IonButton>
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
