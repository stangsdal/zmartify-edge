import { useEffect, useMemo, useState } from 'react';
import { IonButton, IonContent, IonPage } from '@ionic/react';
import { useParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ThermostatDial } from '../components/ThermostatDial';
import { mobileApi, MobileZone } from '../api/mobile';

interface RouteParams {
  zoneRef: string;
}

export function RoomDetailPage() {
  const { zoneRef } = useParams<RouteParams>();
  const resolvedRef = decodeURIComponent(zoneRef);
  const [zone, setZone] = useState<MobileZone | null>(null);
  const [target, setTarget] = useState(21);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      const sites = await mobileApi.listSites();
      for (const site of sites.sites || []) {
        const detail = await mobileApi.getSite(site.site_id);
        for (const device of detail.devices) {
          const dev = await mobileApi.getDevice(device.device_id);
          for (const z of dev.zones || []) {
            const zref = z.zone_uuid || `${device.device_id}:${z.zone_id}`;
            if (zref === resolvedRef) {
              setZone(z);
              setTarget(z.target_temperature_c ?? 21);
              return;
            }
          }
        }
      }
    };
    load().catch(console.error);
  }, [resolvedRef]);

  const statusText = useMemo(() => {
    if (!zone) return 'Loading room status...';
    if (!zone.online) return 'Offline';
    if (zone.fault) return `Fault: ${zone.fault}`;
    if (zone.demand) return 'Heating';
    return 'Comfortable';
  }, [zone]);

  const applyTarget = async () => {
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      await mobileApi.setZoneSetpoint(resolvedRef, target);
      setZone((prev) => (prev ? { ...prev, target_temperature_c: target } : prev));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title={zone?.name || 'Room'} subtitle="Thermostat Control" />
      <IonContent className="ion-padding">
        <div className="space-y-5 pb-8">
          <section className="rounded-3xl app-surface shadow-soft p-5">
            <ThermostatDial
              value={target}
              currentTemperature={zone?.current_temperature_c ?? null}
              roomName={zone?.name}
              statusLabel={statusText}
              heating={!!zone?.demand}
              onChange={setTarget}
            />
            <IonButton expand="block" onClick={applyTarget} disabled={saving}>
              {saving ? 'Saving...' : 'Apply Temperature'}
            </IonButton>
            {saveSuccess && <p className="text-center text-sm font-semibold mt-2" style={{ color: '#027a48' }}>Setpoint updated</p>}
            {saveError && <p className="text-center text-sm mt-2 text-rose-600">{saveError}</p>}
          </section>

          <section className="rounded-2xl app-surface shadow-soft p-4 space-y-2">
            <p className="text-sm text-muted">Status</p>
            <p className="text-base font-medium">{statusText}</p>
            <p className="text-sm text-muted">Last Update</p>
            <p className="text-base">{zone?.freshness_age_ms == null ? 'Unknown' : `${Math.floor(zone.freshness_age_ms / 1000)}s ago`}</p>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
