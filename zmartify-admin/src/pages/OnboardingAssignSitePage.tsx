import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonItem, IonLabel, IonPage, IonSelect, IonSelectOption } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { domainApi } from '../api/domains';
import { siteApi } from '../api/sites';
import { deviceApi } from '../api/devices';
import { AppHeader } from '../components/AppHeader';
import { Domain, Site } from '../types/api';
import { onboardingFlow } from '../utils/onboardingFlow';
import { parseApiError } from '../utils/apiError';

export function OnboardingAssignSitePage() {
  const history = useHistory();
  const flow = onboardingFlow.load();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [domainId, setDomainId] = useState<number | undefined>(flow.selectedDomainId);
  const [siteId, setSiteId] = useState<number | undefined>(flow.selectedSiteId);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<any>(flow.claimResult?.onboarding_status || null);
  const [error, setError] = useState('');

  const deviceId = flow.claimResult?.device?.device_id;

  useEffect(() => {
    if (!deviceId) {
      history.replace('/app/onboarding/claim');
      return;
    }
    domainApi
      .list()
      .then((rows) => {
        setDomains(rows);
        if (!domainId && rows.length) setDomainId(rows[0].id);
      })
      .catch((e) => setError(parseApiError(e)));

    deviceApi
      .getOnboardingStatus(deviceId)
      .then((next) => setStatus(next))
      .catch((e) => setError(parseApiError(e)));
  }, []);

  useEffect(() => {
    if (!domainId) return;
    siteApi
      .listByDomain(domainId)
      .then((rows) => {
        setSites(rows);
        if (!siteId && rows.length) setSiteId(rows[0].id);
      })
      .catch((e) => setError(parseApiError(e)));
  }, [domainId]);

  const assign = async () => {
    if (!deviceId || !siteId) {
      setError('Device and site are required.');
      return;
    }
    try {
      setSaving(true);
      await deviceApi.assignToSite(deviceId, siteId);
      onboardingFlow.patch({ selectedDomainId: domainId, selectedSiteId: siteId });
      history.push('/app/onboarding/complete');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const refreshStatus = async () => {
    if (!deviceId) return;
    try {
      setBusy(true);
      const next = await deviceApi.getOnboardingStatus(deviceId);
      setStatus(next);
      setError('');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const pushConfigAgain = async () => {
    if (!deviceId) return;
    try {
      setBusy(true);
      const next = await deviceApi.pushConfig(deviceId, {});
      setStatus(next);
      setError('');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title="Onboarding" subtitle="Assign site" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Step 3 of 4</p>
            <h2 className="text-lg font-semibold mt-1">Confirm site assignment</h2>
            <p className="text-sm text-muted mt-2">Device: {deviceId || 'n/a'}</p>

            {status ? (
              <div className="text-sm text-muted mt-2">
                <p>State: {status.state || 'unknown'}</p>
                <p>MQTT Configured: {status.mqtt_configured ? 'Yes' : 'No'}</p>
                <p>MQTT Connected: {status.mqtt_connected ? 'Yes' : 'No'}</p>
                {status.last_error ? <p>Last Error: {String(status.last_error)}</p> : null}
              </div>
            ) : null}

            <IonItem className="mt-3">
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
              <IonButton fill="outline" onClick={() => history.push('/app/onboarding/claim')}>
                Back
              </IonButton>
              <IonButton fill="outline" onClick={() => void refreshStatus()} disabled={busy}>
                Refresh status
              </IonButton>
              <IonButton fill="outline" onClick={() => void pushConfigAgain()} disabled={busy}>
                Push config again
              </IonButton>
              <IonButton onClick={() => void assign()} disabled={saving}>
                {saving ? 'Saving...' : 'Assign and continue'}
              </IonButton>
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
