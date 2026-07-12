import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { mobileApi, MobileEvent, MobileSiteSummary, MobileZone, subscribeRealtimeTopics } from '../api/mobile';
import { commandsApi } from '../api/commands';

const durations = [5, 10, 15, 20, 30, 45];

interface ZoneCandidate {
  deviceId: string;
  zone: MobileZone;
  zoneRef: string;
}

export function IrrigationManualPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [zones, setZones] = useState<ZoneCandidate[]>([]);
  const [selectedZoneRef, setSelectedZoneRef] = useState('');
  const [duration, setDuration] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [lastCommandId, setLastCommandId] = useState('');
  const [traceRows, setTraceRows] = useState<MobileEvent[]>([]);

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
      const nextZones = detailRows.flatMap((detail) =>
        (detail.zones || []).map((zone) => ({
          deviceId: detail.device_id,
          zone,
          zoneRef: zone.zone_uuid || `${detail.device_id}:${zone.zone_id}`,
        }))
      );
      setZones(nextZones);
      if (nextZones.length) {
        const firstRef = nextZones[0].zoneRef;
        setSelectedZoneRef((prev) => prev || firstRef);
      } else {
        setSelectedZoneRef('');
      }
      setFeedback('');
    };
    loadSiteZones().catch(console.error);
  }, [selectedSite]);

  useEffect(() => {
    if (!selectedSite) return;

    let cleanup: (() => void) | undefined;
    const connectRealtime = async () => {
      const site = await mobileApi.getSite(selectedSite);
      const topics = site.devices.map((device) => `device:${device.device_id}:irrigation`);
      cleanup = subscribeRealtimeTopics(topics, (event) => {
        const receivedAt = new Date().toISOString();
        setTraceRows((prev) => {
          const next: MobileEvent = {
            event_id: `rt-manual-${receivedAt}-${event.event_type}`,
            event_type: event.event_type,
            created_at: receivedAt,
            device_id: typeof event.payload?.device_id === 'string' ? event.payload.device_id : undefined,
            payload: event.payload,
          };
          return [next, ...prev].slice(0, 25);
        });
      });
    };

    connectRealtime().catch(console.error);
    return () => cleanup?.();
  }, [selectedSite]);

  const selectedZone = useMemo(
    () => zones.find((zone) => zone.zoneRef === selectedZoneRef) || null,
    [selectedZoneRef, zones]
  );

  const matchingTraceRows = useMemo(() => {
    if (!selectedZone) return traceRows.slice(0, 8);
    return traceRows
      .filter((row) => {
        const payload = row.payload || {};
        const sameDevice = !row.device_id || row.device_id === selectedZone.deviceId;
        const sameCommand = !lastCommandId || payload.command_id === lastCommandId;
        return sameDevice && (sameCommand || row.event_type.includes('irrigation'));
      })
      .slice(0, 8);
  }, [lastCommandId, selectedZone, traceRows]);

  const runManual = async () => {
    if (!selectedZone) {
      setFeedback('Select a zone before starting manual run.');
      return;
    }

    setIsSubmitting(true);
    setFeedback('');
    try {
      const result = await commandsApi.startIrrigationZone(selectedZone.deviceId, selectedZone.zoneRef, duration * 60);
      const status = typeof result.status === 'string' ? result.status : 'accepted';
      const commandId = typeof result.command_id === 'string' ? result.command_id : 'n/a';
      setLastCommandId(commandId === 'n/a' ? '' : commandId);
      setFeedback(`Manual run command submitted (${status}). Command id: ${commandId}`);
    } catch (error) {
      setFeedback(String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

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
                const ref = zone.zoneRef;
                const active = ref === selectedZoneRef;
                return (
                  <button
                    key={ref}
                    type="button"
                    className={`text-left rounded-xl px-3 py-2 border ${active ? 'border-teal-500 bg-teal-50' : 'border-slate-200'}`}
                    onClick={() => setSelectedZoneRef(ref)}
                  >
                    <p className="font-semibold">{zone.zone.name || `Zone ${zone.zone.zone_id}`}</p>
                    <p className="text-sm text-muted">{zone.zone.active || zone.zone.demand ? 'Running' : 'Idle'}</p>
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
              {selectedZone ? `${selectedZone.zone.name || `Zone ${selectedZone.zone.zone_id}`} for ${duration} minutes` : 'Select a zone'}
            </p>
            <button
              type="button"
              className="mt-3 rounded-xl bg-teal-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
              onClick={() => {
                void runManual();
              }}
              disabled={!selectedZone || isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Start zone'}
            </button>
            {feedback ? <p className="text-sm mt-2 text-muted">{feedback}</p> : null}
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Feedback trace</p>
            <div className="space-y-2 mt-2">
              {matchingTraceRows.map((row) => {
                const payload = row.payload || {};
                const detail = [
                  typeof payload.action === 'string' ? payload.action : null,
                  typeof payload.detail === 'string' ? payload.detail : null,
                  typeof payload.result === 'string' ? `result ${payload.result}` : null,
                  typeof payload.command_id === 'string' ? `cmd ${payload.command_id}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <div key={row.event_id} className="rounded-xl border border-slate-200 px-3 py-2">
                    <p className="text-sm font-semibold">{row.event_type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted mt-1">{detail || 'Realtime irrigation feedback'}</p>
                    <p className="text-xs text-muted mt-1">{new Date(row.created_at).toLocaleString()}</p>
                  </div>
                );
              })}
              {!matchingTraceRows.length ? <p className="text-sm text-muted">No feedback events received yet.</p> : null}
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
