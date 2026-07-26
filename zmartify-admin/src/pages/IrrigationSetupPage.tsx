import { IonButton, IonContent, IonPage } from '@ionic/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { IrrigationOutput, IrrigationZone, mobileApi, MobileSiteDevice, MobileSiteSummary } from '../api/mobile';
import { commandsApi } from '../api/commands';

const defaultZoneName = (ref: string) => `Zone ${ref.replace(/^zone[-_]?/i, '') || ref}`;
const TEST_RUN_SECONDS = 60;

const zoneNumberFromRef = (ref: string): number | null => {
  const match = ref.match(/(?:zone|out|output|valve)[-_]?(\d+)$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const zoneRefForNumber = (zoneNumber: number) => `zone-${zoneNumber}`;
const fallbackOutputRefForZone = (zoneRef: string) => {
  const zoneNumber = zoneNumberFromRef(zoneRef);
  return zoneNumber == null ? `${zoneRef}-valve` : `output-${zoneNumber}`;
};

const valveLabelForZone = (zoneRef: string) => {
  const zoneNumber = zoneNumberFromRef(zoneRef);
  return zoneNumber == null ? 'Valve' : `Valve ${zoneNumber}`;
};

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
  const [zoneDrafts, setZoneDrafts] = useState<Record<string, { name: string; enabled: boolean }>>({});
  const [testRunZoneRefs, setTestRunZoneRefs] = useState<Record<string, boolean>>({});
  const [busyAction, setBusyAction] = useState('');
  const [feedback, setFeedback] = useState('');
  const testRunTimers = useRef<Record<string, number>>({});

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
    setZoneDrafts((prev) => {
      const next: Record<string, { name: string; enabled: boolean }> = {};
      for (const zone of zones) {
        const key = zone.zone_id;
        next[key] = prev[key] || {
          name: zone.name || defaultZoneName(zone.local_ref || zone.zone_id),
          enabled: zone.enabled,
        };
      }
      return next;
    });
  }, [zones]);

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
      const overview = await mobileApi.getIrrigationOverview(selectedSite);
      const controllerDevices = (overview.devices || []).map((device) => ({
        device_id: device.device_id,
        display_name: device.display_name,
        device_type: 'irrigation',
        integration_mode: 'irrigation',
        online: true,
        mqtt_connected: true,
      })).filter(isIrrigationController);
      setDevices(controllerDevices);
      setSelectedDeviceId((prev) => (controllerDevices.some((device) => device.device_id === prev) ? prev : controllerDevices[0]?.device_id || ''));
    };
    loadDevices().catch(console.error);
  }, [selectedSite]);

  useEffect(() => {
    if (!selectedDeviceId) {
      setZones([]);
      setOutputs([]);
      setTestRunZoneRefs({});
      return;
    }
    reloadDeviceSetup(selectedDeviceId).catch(console.error);
  }, [reloadDeviceSetup, selectedDeviceId]);

  useEffect(() => () => {
    Object.values(testRunTimers.current).forEach((timerId) => window.clearTimeout(timerId));
  }, []);

  const outputRefForZone = useCallback((zoneRef: string) => {
    const zoneNumber = zoneNumberFromRef(zoneRef);
    const matchingOutput = zoneNumber == null
      ? null
      : outputs.find((output) => zoneNumberFromRef(output.local_ref || output.output_id) === zoneNumber && !output.is_master_valve);
    return matchingOutput?.local_ref || fallbackOutputRefForZone(zoneRef);
  }, [outputs]);

  const saveZone = async (zone: IrrigationZone, draft = zoneDrafts[zone.zone_id]) => {
    const localRef = (zone.local_ref || zone.zone_id).trim();
    if (!selectedDeviceId || !localRef || !draft) {
      setFeedback('Select a controller before saving zones.');
      return;
    }
    setBusyAction(`zone:${zone.zone_id}`);
    setFeedback('');
    try {
      const name = draft.name.trim() || defaultZoneName(localRef);
      await mobileApi.upsertIrrigationZone(selectedDeviceId, {
        local_ref: localRef,
        name,
        enabled: draft.enabled,
      });
      await mobileApi.upsertIrrigationOutput(selectedDeviceId, {
        local_ref: outputRefForZone(localRef),
        name: valveLabelForZone(localRef),
        enabled: draft.enabled,
        active: false,
        fault: null,
        is_master_valve: false,
      });
      await reloadDeviceSetup(selectedDeviceId);
      setFeedback(`Saved zone ${name}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction('');
    }
  };

  const addZone = async () => {
    if (!selectedDeviceId) {
      setFeedback('Select a controller before adding a zone.');
      return;
    }
    const usedNumbers = new Set(zones.map((zone) => zoneNumberFromRef(zone.local_ref || zone.zone_id)).filter((value): value is number => value != null));
    let nextNumber = 1;
    while (usedNumbers.has(nextNumber)) nextNumber += 1;

    const localRef = zoneRefForNumber(nextNumber);
    const name = defaultZoneName(localRef);
    setBusyAction('add-zone');
    setFeedback('');
    try {
      await mobileApi.upsertIrrigationZone(selectedDeviceId, {
        local_ref: localRef,
        name,
        enabled: true,
      });
      await mobileApi.upsertIrrigationOutput(selectedDeviceId, {
        local_ref: fallbackOutputRefForZone(localRef),
        name: valveLabelForZone(localRef),
        enabled: true,
        active: false,
        fault: null,
        is_master_valve: false,
      });
      await reloadDeviceSetup(selectedDeviceId);
      setFeedback(`Added ${name}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction('');
    }
  };

  const updateZoneDraft = (zoneId: string, patch: Partial<{ name: string; enabled: boolean }>) => {
    setZoneDrafts((prev) => ({
      ...prev,
      [zoneId]: {
        name: prev[zoneId]?.name || '',
        enabled: prev[zoneId]?.enabled ?? true,
        ...patch,
      },
    }));
  };

  const clearTestRun = useCallback((zoneRef: string) => {
    const timerId = testRunTimers.current[zoneRef];
    if (timerId != null) {
      window.clearTimeout(timerId);
      delete testRunTimers.current[zoneRef];
    }
    setTestRunZoneRefs((prev) => {
      const next = { ...prev };
      delete next[zoneRef];
      return next;
    });
  }, []);

  const markTestRunning = useCallback((zoneRef: string) => {
    clearTestRun(zoneRef);
    setTestRunZoneRefs((prev) => ({ ...prev, [zoneRef]: true }));
    testRunTimers.current[zoneRef] = window.setTimeout(() => {
      clearTestRun(zoneRef);
    }, TEST_RUN_SECONDS * 1000);
  }, [clearTestRun]);

  const activeTestZoneRef = Object.keys(testRunZoneRefs)[0] || '';

  const toggleZoneTest = async (zone: IrrigationZone) => {
    const localRef = zone.local_ref || zone.zone_id;
    if (!selectedDeviceId || !localRef) {
      setFeedback('Select a controller before testing a zone.');
      return;
    }
    const isRunning = Boolean(testRunZoneRefs[localRef]);
    if (!isRunning && activeTestZoneRef && activeTestZoneRef !== localRef) {
      setFeedback(`Stop the running test for ${activeTestZoneRef} before starting another zone.`);
      return;
    }
    setBusyAction(`test:${zone.zone_id}`);
    setFeedback('');
    try {
      if (isRunning) {
        await commandsApi.stopIrrigationZone(selectedDeviceId, localRef);
        clearTestRun(localRef);
        setFeedback(`Stopped test run for ${localRef}.`);
      } else {
        await commandsApi.startIrrigationZone(selectedDeviceId, localRef, TEST_RUN_SECONDS);
        markTestRunning(localRef);
        setFeedback(`Started ${TEST_RUN_SECONDS} second test run for ${localRef}.`);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction('');
    }
  };

  const masterValveEnabled = zones.some((zone) => zoneDrafts[zone.zone_id]?.enabled ?? zone.enabled);

  return (
    <IonPage>
      <AppHeader title="Irrigation setup" subtitle="Controller zone configuration" />
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

          {feedback ? <p className="text-sm text-muted">{feedback}</p> : null}

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Irrigation zones</h2>
                <p className="text-sm text-muted mt-1">Fixed zone identifiers map directly to valve numbers.</p>
              </div>
              <IonButton size="small" disabled={!selectedDeviceId || busyAction === 'add-zone'} onClick={() => { void addZone(); }}>
                {busyAction === 'add-zone' ? 'Adding...' : 'Add zone'}
              </IonButton>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {zones.map((zone) => {
                const draft = zoneDrafts[zone.zone_id] || { name: zone.name || defaultZoneName(zone.local_ref || zone.zone_id), enabled: zone.enabled };
                const localRef = zone.local_ref || zone.zone_id;
                const output = outputs.find((item) => item.local_ref === outputRefForZone(localRef));
                const isSaving = busyAction === `zone:${zone.zone_id}`;
                const isTesting = busyAction === `test:${zone.zone_id}`;
                const isTestRunning = Boolean(testRunZoneRefs[localRef]);
                const isAnotherTestRunning = Boolean(activeTestZoneRef && activeTestZoneRef !== localRef);
                return (
                  <article key={zone.zone_id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{localRef}</p>
                        <p className="text-xs text-muted">{valveLabelForZone(localRef)}{output?.fault ? ` · Fault: ${output.fault}` : ''}</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          onChange={(event) => updateZoneDraft(zone.zone_id, { enabled: event.target.checked })}
                        />
                        Enabled
                      </label>
                    </div>
                    <input
                      className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      placeholder="Description"
                      value={draft.name}
                      onChange={(event) => updateZoneDraft(zone.zone_id, { name: event.target.value })}
                    />
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <IonButton size="small" expand="block" disabled={!selectedDeviceId || isSaving || isTesting} onClick={() => { void saveZone(zone, draft); }}>
                        {isSaving ? 'Saving...' : 'Save'}
                      </IonButton>
                      <IonButton
                        size="small"
                        expand="block"
                        color={isTestRunning ? 'danger' : 'medium'}
                        disabled={!selectedDeviceId || isSaving || isTesting || isAnotherTestRunning || (!draft.enabled && !isTestRunning)}
                        onClick={() => { void toggleZoneTest(zone); }}
                      >
                        {isTesting ? 'Sending...' : isTestRunning ? 'Stop test' : isAnotherTestRunning ? 'Test running' : 'Test 1 min'}
                      </IonButton>
                    </div>
                  </article>
                );
              })}
              {!zones.length ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-muted">
                  No zones configured yet.
                </div>
              ) : null}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-muted">
              Master valve: {masterValveEnabled ? 'enabled when at least one zone is enabled' : 'disabled until a zone is enabled'}.
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}