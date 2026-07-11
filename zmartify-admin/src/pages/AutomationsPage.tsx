import { IonButton, IonContent, IonPage } from '@ionic/react';
import { useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { mobileApi, MobileEvent, MobileSiteSummary } from '../api/mobile';

export function AutomationsPage() {
  const history = useHistory();
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const siteRows = await mobileApi.listSites();
      setSites(siteRows.sites || []);
      const eventRows = await mobileApi.listEvents(120);
      setEvents(eventRows.events || []);
    };
    load().catch((e) => setError(String(e)));
  }, []);

  const metrics = useMemo(() => {
    const totalSites = sites.length;
    const totalDevices = sites.reduce((acc, site) => acc + (site.device_count || 0), 0);
    const irrigationEvents = events.filter((event) => event.event_type.toLowerCase().includes('irrigation')).length;
    const hvacEvents = events.filter((event) => event.event_type.toLowerCase().includes('setpoint')).length;
    return { totalSites, totalDevices, irrigationEvents, hvacEvents };
  }, [events, sites]);

  return (
    <IonPage>
      <AppHeader title="Automations" subtitle="Schedules, programs and automation controls" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Sites</p>
              <p className="text-2xl font-bold mt-1">{metrics.totalSites}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Devices</p>
              <p className="text-2xl font-bold mt-1">{metrics.totalDevices}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Irrigation events</p>
              <p className="text-2xl font-bold mt-1">{metrics.irrigationEvents}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">HVAC setpoint events</p>
              <p className="text-2xl font-bold mt-1">{metrics.hvacEvents}</p>
            </div>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold">Irrigation programs</h2>
            <p className="text-sm text-muted mt-1">
              Manage sequential watering programs, weather adjustments and manual overrides.
            </p>
            <IonButton className="mt-3" onClick={() => history.push('/app/control/irrigation/programs')}>
              Open programs
            </IonButton>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold">HVAC setpoint workflows</h2>
            <p className="text-sm text-muted mt-1">
              Configure room behavior patterns and monitor setpoint operations from Control and Insights.
            </p>
            <IonButton className="mt-3" fill="outline" onClick={() => history.push('/app/control/hvac/zones')}>
              Open HVAC zones
            </IonButton>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold">Onboarding automation</h2>
            <p className="text-sm text-muted mt-1">
              Start guided onboarding to provision credentials and assign devices to the correct site.
            </p>
            <IonButton className="mt-3" fill="outline" onClick={() => history.push('/app/onboarding/discover')}>
              Open onboarding flow
            </IonButton>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
