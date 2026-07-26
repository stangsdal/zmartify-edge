import { IonButton, IonContent, IonPage } from '@ionic/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { IrrigationOutput, IrrigationZone, mobileApi, MobileSiteDevice, MobileSiteSummary } from '../api/mobile';

const defaultZoneName = (ref: string) => `Zone ${ref.replace(/^zone[-_]?/i, '') || ref}`;
const defaultOutputName = (ref: string) => `Output ${ref.replace(/^out[-_]?/i, '') || ref}`;

const isIrrigationController = (device: MobileSiteDevice): boolean => {
  const haystack = [device.device_id, device.display_name, device.device_type, device.integration_mode]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes('irrigation');
};

export function IrrigationSetupPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [devices, setDevices] = useState<MobileSiteDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [zones, setZones] = useState<IrrigationZone[]>([]);
  const [outputs, setOutputs] = useState<IrrigationOutput[]>([]);
  const [zoneRef, setZoneRef] = useState('zone-1');
  const [zoneName, setZoneName] = useState('Zone 1');
  const [zoneEnabled, setZoneEnabled] = useState(true);
  const [outputRef, setOutputRef] = useState('out-1');
  const [outputName, setOutputName] = useState('Output 1');
  const [outputEnabled, setOutputEnabled] = useState(true);
  const [isMasterValve, setIsMasterValve] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [feedback, setFeedback] = useState('');

  const selectedDevice = useMemo(
    () => devices.find((device) => device.device_id === selectedDeviceId) || null,
    [devices, selectedDeviceId],
  );

  const reloadDeviceSetup = useCallback(async (deviceId: string) => {
    const [zoneResponse, outputResponse] = await Promise.all([
      mobileApi.listIrrigationZones(deviceId),
      mobileApi.listIrrigationOutputs(deviceId),
    ]);
    setZones(zoneResponse.zones || []);
    setOutputs(outputResponse.outputs || []);
  }, []);

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
    const loadDevices = async () => {
      const site = await mobileApi.getSite(selectedSite);
      const controllerDevices = (site.devices || []).filter(isIrrigationController);
      setDevices(controllerDevices);
      setSelectedDeviceId((prev) => (controllerDevices.some((device) => device.device_id === prev) ? prev : controllerDevices[0]?.device_id || ''));
    };
    loadDevices().catch(console.error);
  }, [selectedSite]);

  useEffect(() => {
    if (!selectedDeviceId) {
      setZones([]);
      setOutputs([]);
      return;
    }
    reloadDeviceSetup(selectedDeviceId).catch(console.error);
  }, [reloadDeviceSetup, selectedDeviceId]);

  const saveZone = async () => {
    const localRef = zoneRef.trim();
    if (!selectedDeviceId || !localRef) {
      setFeedback('Select a controller and provide a zone reference.');
      return;
    }
    setBusyAction('zone');
    setFeedback('');
    try {
      const name = zoneName.trim() || defaultZoneName(localRef);
      await mobileApi.upsertIrrigationZone(selectedDeviceId, {
        local_ref: localRef,
        name,
        enabled: zoneEnabled,
      });
      await reloadDeviceSetup(selectedDeviceId);
      setFeedback(`Saved zone ${name}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction('');
    }
  };

  const saveOutput = async () => {
    const localRef = outputRef.trim();
    if (!selectedDeviceId || !localRef) {
      setFeedback('Select a controller and provide an output reference.');
      return;
    }
    setBusyAction('output');
    setFeedback('');
    try {
      const name = outputName.trim() || defaultOutputName(localRef);
      await mobileApi.upsertIrrigationOutput(selectedDeviceId, {
        local_ref: localRef,
        name,
        enabled: outputEnabled,
        active: false,
        fault: null,
        is_master_valve: isMasterValve,
      });
      await reloadDeviceSetup(selectedDeviceId);
      setFeedback(`Saved output ${name}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction('');
    }
  };

  const loadZoneIntoForm = (zone: IrrigationZone) => {
    setZoneRef(zone.local_ref || zone.zone_id);
    setZoneName(zone.name || defaultZoneName(zone.local_ref || zone.zone_id));
    setZoneEnabled(zone.enabled);
  };

  const loadOutputIntoForm = (output: IrrigationOutput) => {
    setOutputRef(output.local_ref || output.output_id);
    setOutputName(output.name || defaultOutputName(output.local_ref || output.output_id));
    setOutputEnabled(output.enabled);
    setIsMasterValve(output.is_master_valve);
  };

  return (
    <IonPage>
      <AppHeader title="Irrigation setup" subtitle="Controller zone and valve output configuration" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Site"
            options={sites.map((site) => ({ site_id: site.site_id, site_name: site.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Controller</p>
            <select
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
              value={selectedDeviceId}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              disabled={!devices.length}
            >
              {!devices.length ? <option value="">No irrigation controllers found</option> : null}
              {devices.map((device) => (
                <option key={device.device_id} value={device.device_id}>{device.display_name} ({device.device_id})</option>
              ))}
            </select>
            {selectedDevice ? (
              <p className="text-xs text-muted mt-2">
                {selectedDevice.online ? 'Online' : 'Offline'} · MQTT {selectedDevice.mqtt_connected ? 'connected' : 'not connected'}
              </p>
            ) : <p className="text-sm text-muted mt-2">No irrigation controllers are assigned to this site.</p>}
          </section>

          <section className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
              <h2 className="text-lg font-semibold">Zones</h2>
              <p className="text-sm text-muted mt-1">Name watering areas and bind them to controller local refs.</p>
              <div className="grid gap-2 mt-3">
                <input
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Local ref, e.g. zone-1"
                  value={zoneRef}
                  onChange={(event) => {
                    setZoneRef(event.target.value);
                    if (!zoneName.trim()) setZoneName(defaultZoneName(event.target.value));
                  }}
                />
                <input
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Zone name"
                  value={zoneName}
                  onChange={(event) => setZoneName(event.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={zoneEnabled} onChange={(event) => setZoneEnabled(event.target.checked)} />
                  Enabled
                </label>
                <IonButton size="small" disabled={!selectedDeviceId || busyAction === 'zone'} onClick={() => { void saveZone(); }}>
                  {busyAction === 'zone' ? 'Saving...' : 'Save zone'}
                </IonButton>
              </div>
            </div>

            <div className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
              <h2 className="text-lg font-semibold">Valve outputs</h2>
              <p className="text-sm text-muted mt-1">Configure output labels and mark the master valve relay.</p>
              <div className="grid gap-2 mt-3">
                <input
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Local ref, e.g. out-1"
                  value={outputRef}
                  onChange={(event) => {
                    setOutputRef(event.target.value);
                    if (!outputName.trim()) setOutputName(defaultOutputName(event.target.value));
                  }}
                />
                <input
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Output name"
                  value={outputName}
                  onChange={(event) => setOutputName(event.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={outputEnabled} onChange={(event) => setOutputEnabled(event.target.checked)} />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={isMasterValve} onChange={(event) => setIsMasterValve(event.target.checked)} />
                  Master valve
                </label>
                <IonButton size="small" disabled={!selectedDeviceId || busyAction === 'output'} onClick={() => { void saveOutput(); }}>
                  {busyAction === 'output' ? 'Saving...' : 'Save output'}
                </IonButton>
              </div>
            </div>
          </section>

          {feedback ? <p className="text-sm text-muted">{feedback}</p> : null}

          <section className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
              <h2 className="text-lg font-semibold mb-3">Configured zones</h2>
              <div className="space-y-2">
                {zones.map((zone) => (
                  <button key={zone.zone_id} type="button" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left" onClick={() => loadZoneIntoForm(zone)}>
                    <p className="font-semibold">{zone.name || zone.local_ref}</p>
                    <p className="text-xs text-muted">{zone.local_ref} · {zone.enabled ? 'Enabled' : 'Disabled'}</p>
                  </button>
                ))}
                {!zones.length ? <p className="text-sm text-muted">No zones configured yet.</p> : null}
              </div>
            </div>

            <div className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
              <h2 className="text-lg font-semibold mb-3">Configured outputs</h2>
              <div className="space-y-2">
                {outputs.map((output) => (
                  <button key={output.output_id} type="button" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left" onClick={() => loadOutputIntoForm(output)}>
                    <p className="font-semibold">{output.name || output.local_ref}</p>
                    <p className="text-xs text-muted">
                      {output.local_ref} · {output.enabled ? 'Enabled' : 'Disabled'}{output.is_master_valve ? ' · Master valve' : ''}{output.fault ? ` · Fault: ${output.fault}` : ''}
                    </p>
                  </button>
                ))}
                {!outputs.length ? <p className="text-sm text-muted">No valve outputs configured yet.</p> : null}
              </div>
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}