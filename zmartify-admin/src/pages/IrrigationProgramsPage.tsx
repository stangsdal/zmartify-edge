import { IonContent, IonPage } from '@ionic/react';
import { useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { mobileApi, MobileSiteSummary, MobileZone } from '../api/mobile';

type SynthProgram = {
  name: string;
  enabled: boolean;
  startTime: string;
  days: string;
  seasonalAdjust: string;
  estimate: string;
};

export function IrrigationProgramsPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [zones, setZones] = useState<MobileZone[]>([]);

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
      setZones(detailRows.flatMap((detail) => detail.zones || []));
    };
    loadSiteZones().catch(console.error);
  }, [selectedSite]);

  const programs = useMemo<SynthProgram[]>(() => {
    const baseZones = zones.slice(0, Math.max(2, Math.min(6, zones.length)));
    const zoneFactor = Math.max(1, baseZones.length);
    return [
      {
        name: 'Morning program',
        enabled: true,
        startTime: '05:30',
        days: 'Mon Tue Wed Thu Fri Sat',
        seasonalAdjust: `${Math.max(65, 100 - zoneFactor * 3)}%`,
        estimate: `${(zoneFactor * 210).toLocaleString()} L`,
      },
      {
        name: 'Evening recovery',
        enabled: zoneFactor > 2,
        startTime: '20:45',
        days: 'Tue Thu Sat',
        seasonalAdjust: `${Math.max(55, 90 - zoneFactor * 2)}%`,
        estimate: `${(zoneFactor * 110).toLocaleString()} L`,
      },
    ];
  }, [zones]);

  return (
    <IonPage>
      <AppHeader title="Programs" subtitle="Schedule design and runtime planning" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Site"
            options={sites.map((site) => ({ site_id: site.site_id, site_name: site.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          {programs.map((program) => (
            <section key={program.name} className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{program.name}</h2>
                  <p className="text-sm text-muted">Start {program.startTime} • {program.days}</p>
                </div>
                <span
                  className="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                  style={{
                    color: program.enabled ? '#067647' : '#b54708',
                    backgroundColor: program.enabled ? 'rgba(18,183,106,0.15)' : 'rgba(247,144,9,0.16)',
                  }}
                >
                  {program.enabled ? 'Enabled' : 'Paused'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl p-3 app-system-card app-system-card--weather">
                  <p className="text-xs uppercase tracking-wide text-muted">Seasonal adjust</p>
                  <p className="text-xl font-bold mt-1">{program.seasonalAdjust}</p>
                </div>
                <div className="rounded-xl p-3 app-system-card app-system-card--irrigation">
                  <p className="text-xs uppercase tracking-wide text-muted">Estimated water</p>
                  <p className="text-xl font-bold mt-1">{program.estimate}</p>
                </div>
              </div>
            </section>
          ))}

          {!zones.length ? (
            <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
              <p className="text-sm text-muted">No irrigation zones are available for this site yet.</p>
            </section>
          ) : null}
        </div>
      </IonContent>
    </IonPage>
  );
}
