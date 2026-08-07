import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { IrrigationZoneActionControl } from '../components/IrrigationZoneActionControl';
import { MobileEvent, mobileApi, MobileSiteSummary, subscribeRealtimeTopics } from '../api/mobile';
import { toIrrigationFeedback } from '../utils/irrigationErrors';
import { useIrrigationRunState } from '../hooks/useIrrigationRunState';
import { useAccess } from '../auth/AccessContext';

const durations = [5, 10, 15, 20, 30, 45];

const zoneKey = (deviceId: string, zoneRef: string) => `${deviceId}:${zoneRef}`;

export function IrrigationManualPage() {
  const { selectedSiteId, selectSite, can } = useAccess();
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const selectedSite = selectedSiteId ? String(selectedSiteId) : '';
  const [selectedZoneKey, setSelectedZoneKey] = useState('');
  const [duration, setDuration] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [lastCommandId, setLastCommandId] = useState('');
  const [traceRows, setTraceRows] = useState<MobileEvent[]>([]);
  const { zoneRuns, startZone, stopZone } = useIrrigationRunState(selectedSite);
  const canOperate = selectedSiteId != null && can(selectedSiteId, 'irrigation', 'operate');

  useEffect(() => {
    const loadSites = async () => {
      const response = await mobileApi.listSites();
      setSites(response.sites || []);
    };
    loadSites().catch(console.error);
  }, []);

  useEffect(() => {
    setSelectedZoneKey('');
    setFeedback('');
    setLastCommandId('');
  }, [selectedSite]);

  useEffect(() => {
    if (!zoneRuns.length) return;
    setSelectedZoneKey((previous) => previous || zoneKey(zoneRuns[0].deviceId, zoneRuns[0].zoneRef));
  }, [zoneRuns]);

  useEffect(() => {
    if (!selectedSite) return;

    let cleanup: (() => void) | undefined;
    const connectRealtime = async () => {
      const site = await mobileApi.getSite(selectedSite);
      const topics = site.devices.map((device) => `device:${device.device_id}:irrigation`);
      cleanup = subscribeRealtimeTopics(topics, (event) => {
        const receivedAt = new Date().toISOString();
        const envelope = (event.payload || {}) as Record<string, unknown>;
        const mappedType = typeof envelope.event_type === 'string' ? envelope.event_type : event.event_type;
        const wrapped = envelope.payload;
        const outcome = (wrapped && typeof wrapped === 'object' ? wrapped : envelope) as Record<string, unknown>;

        setTraceRows((prev) => {
          const next: MobileEvent = {
            event_id: `rt-manual-${receivedAt}-${mappedType}`,
            event_type: mappedType,
            created_at: receivedAt,
            device_id: typeof outcome.device_id === 'string'
              ? outcome.device_id
              : (typeof envelope.device_id === 'string' ? envelope.device_id : undefined),
            payload: outcome,
          };
          return [next, ...prev].slice(0, 25);
        });
      });
    };

    connectRealtime().catch(console.error);
    return () => cleanup?.();
  }, [selectedSite]);

  const selectedZone = useMemo(() => zoneRuns.find((zoneRun) =>
    zoneKey(zoneRun.deviceId, zoneRun.zoneRef) === selectedZoneKey,
  ) || null, [selectedZoneKey, zoneRuns]);

  const matchingTraceRows = useMemo(() => {
    if (!selectedZone) return traceRows.slice(0, 8);
    return traceRows
      .filter((row) => {
        const payload = (row.payload || {}) as Record<string, unknown>;
        const sameDevice = !row.device_id || row.device_id === selectedZone.deviceId;
        const sameCommand = !lastCommandId || payload.command_id === lastCommandId;
        const irrigationSignal = row.event_type.includes('irrigation') || row.event_type === 'controller_fault';
        return sameDevice && (sameCommand || irrigationSignal);
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
      const result = await startZone(selectedZone.deviceId, selectedZone.zoneRef, duration * 60);
      const commandId = typeof result.command_id === 'string' ? result.command_id : 'n/a';
      setLastCommandId(commandId === 'n/a' ? '' : commandId);
      setFeedback(`Starting ${selectedZone.zone.name || selectedZone.zone.local_ref} for ${duration} minutes.`);
    } catch (error) {
      setFeedback(toIrrigationFeedback(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const stopManual = async () => {
    if (!selectedZone) {
      setFeedback('Select a zone before stopping manual run.');
      return;
    }
    setIsSubmitting(true);
    setFeedback('');
    try {
      const result = await stopZone(selectedZone.deviceId, selectedZone.zoneRef);
      const commandId = typeof result.command_id === 'string' ? result.command_id : 'n/a';
      setLastCommandId(commandId === 'n/a' ? '' : commandId);
      setFeedback(`Stopping ${selectedZone.zone.name || selectedZone.zone.local_ref}.`);
    } catch (error) {
      setFeedback(toIrrigationFeedback(error));
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
            onChange={(siteId) => selectSite(Number(siteId))}
          />

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Selected zone</p>
            <div className="grid gap-2 mt-2">
              {zoneRuns.map((zone) => {
                const key = zoneKey(zone.deviceId, zone.zoneRef);
                const active = key === selectedZoneKey;
                const starting = zone.status === 'starting';
                const stopping = zone.status === 'stopping';
                const running = zone.status === 'running';
                return (
                  <button
                    key={key}
                    type="button"
                    className={`text-left rounded-xl px-3 py-2 border ${active ? 'border-teal-500 bg-teal-50' : 'border-slate-200'}`}
                    onClick={() => setSelectedZoneKey(key)}
                  >
                    <p className="font-semibold">{zone.zone.name || zone.zone.local_ref}</p>
                    <p className="text-sm text-muted">{zone.displayName} · {!zone.zone.enabled ? 'Disabled' : starting ? 'Starting...' : stopping ? 'Stopping...' : running ? 'Running' : 'Ready'}</p>
                  </button>
                );
              })}
              {!zoneRuns.length ? <p className="text-sm text-muted">No irrigation zones available.</p> : null}
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

          {canOperate ? <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Command preview</p>
            <p className="text-base mt-1 font-semibold">
              {selectedZone ? `${selectedZone.zone.name || selectedZone.zone.local_ref} for ${duration} minutes` : 'Select a zone'}
            </p>
            <div className="mt-3">
              <IrrigationZoneActionControl
                status={selectedZone?.status}
                disabled={!selectedZone || isSubmitting}
                onStart={() => { void runManual(); }}
                onStop={() => { void stopManual(); }}
              />
            </div>
            {feedback ? <p className="text-sm mt-2 text-muted">{feedback}</p> : null}
            {lastCommandId ? (
              <details className="text-xs text-muted mt-2">
                <summary>Command details</summary>
                <p className="mt-1">Command ID: {lastCommandId}</p>
              </details>
            ) : null}
          </section> : null}

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
