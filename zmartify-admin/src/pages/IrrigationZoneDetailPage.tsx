import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { mobileApi, MobileZone } from '../api/mobile';

interface RouteParams {
  zoneRef: string;
}

export function IrrigationZoneDetailPage() {
  const { zoneRef } = useParams<RouteParams>();
  const resolvedRef = decodeURIComponent(zoneRef);
  const [zone, setZone] = useState<MobileZone | null>(null);

  useEffect(() => {
    const load = async () => {
      const sites = await mobileApi.listSites();
      for (const site of sites.sites || []) {
        const siteDetail = await mobileApi.getSite(site.site_id);
        for (const device of siteDetail.devices) {
          const detail = await mobileApi.getDevice(device.device_id);
          for (const candidate of detail.zones || []) {
            const candidateRef = candidate.zone_uuid || `${device.device_id}:${candidate.zone_id}`;
            if (candidateRef === resolvedRef) {
              setZone(candidate);
              return;
            }
          }
        }
      }
      setZone(null);
    };
    load().catch(console.error);
  }, [resolvedRef]);

  const stateLabel = useMemo(() => {
    if (!zone) return 'Unknown';
    if (zone.online === false) return 'Offline';
    if (zone.active || zone.demand) return 'Running';
    return 'Idle';
  }, [zone]);

  return (
    <IonPage>
      <AppHeader title={zone?.name || 'Irrigation zone'} subtitle="Zone profile and runtime health" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Status</p>
            <p className="text-xl font-bold mt-1">{stateLabel}</p>
            <p className="text-sm text-muted mt-2">Zone ref: {resolvedRef}</p>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Current reading</p>
              <p className="text-2xl font-bold mt-1">
                {zone?.current_temperature_c == null ? '--' : `${zone.current_temperature_c.toFixed(1)}°`}
              </p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Target value</p>
              <p className="text-2xl font-bold mt-1">
                {zone?.target_temperature_c == null ? '--' : `${zone.target_temperature_c.toFixed(1)}°`}
              </p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Freshness</p>
              <p className="text-2xl font-bold mt-1">
                {zone?.freshness_age_ms == null ? '--' : `${Math.floor(zone.freshness_age_ms / 1000)}s`}
              </p>
            </div>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Operational note</p>
            <p className="text-sm mt-2">
              This zone detail view is bound to the current edge zone model. Dedicated irrigation schema fields can be
              exposed when the backend v2 irrigation model is introduced.
            </p>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
