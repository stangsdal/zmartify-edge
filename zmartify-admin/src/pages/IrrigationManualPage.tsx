import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { mobileApi, MobileSiteSummary, MobileZone } from '../api/mobile';

const durations = [5, 10, 15, 20, 30, 45];

export function IrrigationManualPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [zones, setZones] = useState<MobileZone[]>([]);
  const [selectedZoneRef, setSelectedZoneRef] = useState('');
  const [duration, setDuration] = useState(10);

  useEffect(() => {
    const loadSites = async () => {
      const response = await mobileApi.listSites();
      setSites(response.sites || []);
      if ((response.sites || []).length) {
        setSelectedSite((prev) => prev || response.sites[0].site_id);
      }
    };
    loadSites().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedSite) return;
    const loadSiteZones = async () => {
      const site = await mobileApi.getSite(selectedSite);
      const detailRows = await Promise.all(site.devices.map((device) => mobileApi.getDevice(device.device_id)));
      const nextZones = detailRows.flatMap((detail) => detail.zones || []);
      setZones(nextZones);
      if (nextZones.length) {
        const firstRef = nextZones[0].zone_uuid || `zone:${nextZones[0].zone_id}`;
        setSelectedZoneRef((prev) => prev || firstRef);
      } else {
        setSelectedZoneRef('');
      }
    };
    loadSiteZones().catch(console.error);
  }, [selectedSite]);

  const selectedZone = useMemo(
    () => zones.find((zone) => (zone.zone_uuid || `zone:${zone.zone_id}`) === selectedZoneRef) || null,
    [selectedZoneRef, zones]
  );

  return (
    <IonPage>
      <AppHeader title="Manual run" subtitle="Temporary zone activation with bounded duration" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Site"
            options={sites.map((site) => ({ site_id: site.site_id, site_name: site.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Selected zone</p>
            <div className="grid gap-2 mt-2">
              {zones.map((zone) => {
                const ref = zone.zone_uuid || `zone:${zone.zone_id}`;
                const active = ref === selectedZoneRef;
                return (
                  <button
                    key={ref}
                    type="button"
                    className={`text-left rounded-xl px-3 py-2 border ${active ? 'border-teal-500 bg-teal-50' : 'border-slate-200'}`}
                    onClick={() => setSelectedZoneRef(ref)}
                  >
                    <p className="font-semibold">{zone.name || `Zone ${zone.zone_id}`}</p>
                    <p className="text-sm text-muted">{zone.active || zone.demand ? 'Running' : 'Idle'}</p>
                  </button>
                );
              })}
              {!zones.length ? <p className="text-sm text-muted">No irrigation zones available.</p> : null}
            </div>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Duration</p>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {durations.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-xl px-3 py-2 border text-sm font-semibold ${duration === value ? 'border-teal-500 bg-teal-50' : 'border-slate-200'}`}
                  onClick={() => setDuration(value)}
                >
                  {value} min
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Command preview</p>
            <p className="text-base mt-1 font-semibold">
              {selectedZone ? `${selectedZone.name || `Zone ${selectedZone.zone_id}`} for ${duration} minutes` : 'Select a zone'}
            </p>
            <p className="text-sm text-muted mt-2">
              Live command execution endpoint for irrigation is not available yet in the current backend. This preview is wired to
              current site and zone data and is ready for command API integration.
            </p>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
