import { useEffect, useMemo, useRef, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { useHistory, useParams } from 'react-router-dom';
import { arrowBackOutline } from 'ionicons/icons';
import { AppHeader } from '../components/AppHeader';
import { ThermostatDial } from '../components/ThermostatDial';
import { apiClient } from '../api/client';
import { mobileApi, MobileSetpointResponse, MobileZone } from '../api/mobile';
import { freshnessFromAgeMs } from '../utils/freshness';
import { displaySetpointMode, HvacZoneMode, SETPOINT_MODE_BY_NAME } from '../utils/hvacMode';

interface RouteParams {
  zoneRef: string;
}

export function RoomDetailPage() {
  const { zoneRef } = useParams<RouteParams>();
  const history = useHistory();
  const resolvedRef = decodeURIComponent(zoneRef);
  const [zone, setZone] = useState<MobileZone | null>(null);
  const [target, setTarget] = useState(21);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [setpointState, setSetpointState] = useState<'idle' | 'pending' | 'confirmed' | 'failed'>('idle');
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [streamState, setStreamState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [thermostatTheme, setThermostatTheme] = useState<'classical' | 'gunmalmg'>('classical');
  const [selectedMode, setSelectedMode] = useState<HvacZoneMode>('MANUAL');
  const lastAppliedRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingCommandRef = useRef<{ id: string | null; target: number } | null>(null);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  const applyIncomingZoneState = (nextZone: MobileZone) => {
    const pendingCommand = pendingCommandRef.current;
    const hasDifferentCommandOutcome =
      pendingCommand !== null &&
      pendingCommand.id !== null &&
      nextZone.setpoint_command_id !== null &&
      nextZone.setpoint_command_id !== pendingCommand.id;
    const commandMatches =
      pendingCommand !== null &&
      (pendingCommand.id === null || pendingCommand.id === nextZone.setpoint_command_id);

    // Do not let a late outcome for an older command replace the newer
    // setpoint currently being confirmed in this view.
    if (hasDifferentCommandOutcome) {
      setZone((previous) => previous ? {
        ...nextZone,
        target_temperature_c: pendingCommand.target,
        setpoint_pending: true,
        setpoint_command_state: 'pending_device_feedback',
        setpoint_command_id: pendingCommand.id,
        setpoint_requested_target_c: pendingCommand.target,
        setpoint_failure_reason: null,
      } : nextZone);
      return;
    }

    const awaitingReportedTarget = commandMatches && nextZone.setpoint_pending;
    const nextZoneForDisplay = awaitingReportedTarget
      ? { ...nextZone, target_temperature_c: pendingCommand.target }
      : nextZone;

    if (commandMatches && !nextZone.setpoint_pending) {
      pendingCommandRef.current = null;
    }

    setZone(nextZoneForDisplay);
    setRenameValue(nextZone.name === (nextZone.zone_key || `zone-${nextZone.zone_id}`) ? '' : nextZone.name || '');
    const nextTarget = nextZoneForDisplay.target_temperature_c ?? 21;

    if (nextZone.setpoint_pending || nextZone.setpoint_command_state === 'pending_device_feedback') {
      setSetpointState('pending');
      setSaveError('');
    } else if ((nextZone.setpoint_command_state || '').startsWith('failed')) {
      setSetpointState('failed');
      if (nextZone.setpoint_failure_reason) {
        setSaveError(String(nextZone.setpoint_failure_reason));
      }
    } else if (nextZone.setpoint_command_state === 'confirmed') {
      setSetpointState('confirmed');
      setSaveError('');
    }

    if (!dirtyRef.current && !savingRef.current) {
      const pendingRequested =
        nextZone.setpoint_pending && typeof nextZone.setpoint_requested_target_c === 'number'
          ? nextZone.setpoint_requested_target_c
          : null;
      const dialTarget = awaitingReportedTarget ? pendingCommand.target : pendingRequested ?? nextTarget;
      setTarget(dialTarget);
      lastAppliedRef.current = dialTarget;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const response = await mobileApi.getZoneByRef(resolvedRef);
      if (cancelled) return;
      applyIncomingZoneState(response.zone);
    };

    load().catch(console.error);
    const intervalId = window.setInterval(() => {
      load().catch(console.error);
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [resolvedRef]);

  useEffect(() => {
    const token = apiClient.getAuthToken();
    if (!token) return;

    const rawBase = localStorage.getItem('api_base_url') || window.location.origin;
    const wsBase = rawBase.startsWith('https://')
      ? rawBase.replace('https://', 'wss://')
      : rawBase.replace('http://', 'ws://');

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let stopped = false;

    const connect = () => {
      const endpoint = `${wsBase}/mobile/ws/zones/${encodeURIComponent(resolvedRef)}?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(endpoint);
      setStreamState('connecting');

      socket.onopen = () => {
        setStreamState('connected');
        if (pingTimer != null) window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
        }, 15000);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type !== 'zone_update' || !payload.zone) return;
          applyIncomingZoneState(payload.zone as MobileZone);
        } catch {
          // Ignore malformed websocket messages.
        }
      };

      socket.onclose = () => {
        if (stopped) return;
        if (pingTimer != null) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        setStreamState('reconnecting');
        mobileApi.getZoneByRef(resolvedRef)
          .then((response) => {
            if (!stopped) applyIncomingZoneState(response.zone);
          })
          .catch(console.error);
        reconnectTimer = window.setTimeout(connect, 2000);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      if (pingTimer != null) {
        window.clearInterval(pingTimer);
      }
      socket?.close();
    };
  }, [resolvedRef]);

  const statusText = useMemo(() => {
    if (!zone) return 'Loading room status...';
    const freshness = freshnessFromAgeMs(zone.freshness_age_ms);
    if (freshness.state === 'offline' || !zone.online) return 'Offline';
    if (freshness.state === 'stale') return 'Stale data';
    const heating = zone.demand ?? zone.active ?? false;
    if (zone.fault) return `Fault: ${zone.fault}`;
    if (heating) return 'Heating';
    return 'Comfortable';
  }, [zone]);

  const heatSignalText = useMemo(() => {
    if (!zone) return 'Unknown';
    const freshness = freshnessFromAgeMs(zone.freshness_age_ms);
    if (freshness.state !== 'fresh') return freshness.label;
    if (zone.demand != null) return `Demand (${zone.demand ? 'ON' : 'OFF'})`;
    if (zone.active != null) return `Active fallback (${zone.active ? 'ON' : 'OFF'})`;
    return 'Unavailable';
  }, [zone]);

  useEffect(() => {
    if (!zone || !dirty) return;
    if (lastAppliedRef.current === target) {
      setDirty(false);
      return;
    }

    const timer = window.setTimeout(() => {
      const applyTarget = async () => {
        setSaving(true);
        setSaveError('');
        try {
          const result: MobileSetpointResponse = await mobileApi.setZoneSetpoint(
            resolvedRef,
            target,
            SETPOINT_MODE_BY_NAME[selectedMode],
          );
          const pending = Boolean(result.pending || result.command_state === 'pending_device_feedback');
          lastAppliedRef.current = target;
          pendingCommandRef.current = pending ? { id: result.command_id ?? null, target } : null;
          setZone((prev) =>
            prev
              ? {
                  ...prev,
                  target_temperature_c: pending ? prev.target_temperature_c : target,
                  setpoint_pending: pending,
                  // Manual is an explicit controller profile. Omitting the
                  // field means "whatever profile is active per channel", so
                  // it can leave a multi-channel zone with mixed targets.
                  setpoint_mode: SETPOINT_MODE_BY_NAME[selectedMode],
                  setpoint_command_state: result.command_state,
                  setpoint_command_id: result.command_id ?? null,
                  setpoint_requested_target_c: target,
                  setpoint_failure_reason: pending ? null : prev.setpoint_failure_reason,
                }
              : prev,
          );
          setSetpointState(pending ? 'pending' : 'confirmed');
          setDirty(false);
        } catch (e) {
          setSetpointState('failed');
          setSaveError(String(e));
        } finally {
          setSaving(false);
        }
      };

      void applyTarget();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [dirty, resolvedRef, selectedMode, target]);

  useEffect(() => {
    if (zone && !dirty) {
      setSelectedMode(displaySetpointMode(zone.setpoint_mode));
    }
  }, [dirty, zone?.setpoint_mode]);

  const handleTargetChange = (nextTarget: number) => {
    setTarget(nextTarget);
    setDirty(true);
    setSaveError('');
    setSetpointState('idle');
  };

  const setpointStatusText = useMemo(() => {
    if (saving) return 'Sending setpoint...';
    if (dirty) return 'Will apply in a moment';
    if (setpointState === 'pending') return 'Waiting for device confirmation...';
    if (setpointState === 'failed') return 'Setpoint failed';
    if (setpointState === 'confirmed') return 'Controller confirmed setpoint';
    return 'Setpoint saved';
  }, [dirty, saving, setpointState]);

  const handleRename = async () => {
    const nextName = renameValue.trim();
    if (!nextName) {
      setRenameError('Room name cannot be empty.');
      return;
    }

    if (!resolvedRef) {
      setRenameError('Unable to resolve room identity for rename.');
      return;
    }

    setRenaming(true);
    setRenameError('');
    try {
      const renamed = await mobileApi.renameZoneByRef(resolvedRef, nextName);
      setZone((prev) => (prev ? { ...prev, name: renamed.name } : prev));
      setRenameValue(renamed.name);
    } catch (e) {
      setRenameError(String(e));
    } finally {
      setRenaming(false);
    }
  };

  const zoneKey = zone?.zone_key || (zone ? `zone-${zone.zone_id}` : 'Room');
  const displayName = zone?.name && zone.name !== zoneKey ? zone.name : zoneKey;
  const supportedModes: HvacZoneMode[] = ['MANUAL', 'ECO', 'KOMFORT', 'HOLIDAY', 'STANDBY', 'PARTY'];

  return (
    <IonPage>
      <AppHeader
        title={`${displayName}${(zone?.assigned_channel_ids?.length ? zone.assigned_channel_ids : zone?.controlled_element_ids)?.length
          ? ` [${(zone?.assigned_channel_ids?.length ? zone.assigned_channel_ids : zone?.controlled_element_ids)?.join(',')}]`
          : ''}`}
        subtitle={zone?.name && zone.name !== zoneKey ? zoneKey : 'Thermostat Control'}
      />
      <IonContent className="ion-padding">
        <div className="room-detail-fullscreen space-y-5 pb-8">
          <button type="button" className="room-detail-back" onClick={() => history.goBack()}>
            <IonIcon icon={arrowBackOutline} aria-hidden="true" />
            <span>Back to HVAC</span>
          </button>
          <section className="rounded-3xl app-surface shadow-soft p-5">
            <div className="mb-3 flex items-center justify-end gap-2">
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  color: streamState === 'connected' ? '#067647' : '#b54708',
                  backgroundColor: streamState === 'connected' ? 'rgba(18,183,106,0.15)' : 'rgba(247,144,9,0.16)',
                }}
              >
                {streamState === 'connected' ? 'Connected' : streamState === 'connecting' ? 'Connecting' : 'Reconnecting'}
              </span>
              <details className="relative">
                <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-muted hover:bg-slate-100" aria-label="Thermostat options">
                  <span className="text-xl leading-none" aria-hidden="true">⋮</span>
                </summary>
                <div className="absolute right-0 top-12 z-10 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                  <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">Display</p>
                  <label className="menu-choice">
                    <span>Theme</span>
                    <select value={thermostatTheme} onChange={(event) => setThermostatTheme(event.target.value as 'classical' | 'gunmalmg')}>
                      <option value="classical">Classical</option>
                      <option value="gunmalmg">Gunmalmg</option>
                    </select>
                  </label>
                  <div className="my-2 border-t border-slate-100" />
                  <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">Zone name</p>
                  <input
                    className="w-full rounded-lg border border-slate-300/70 bg-white px-3 py-2 text-sm"
                    value={renameValue}
                    onChange={(event) => { setRenameValue(event.target.value); setRenameError(''); }}
                    placeholder={zoneKey}
                    maxLength={64}
                  />
                  <button type="button" className="menu-action menu-action--primary mt-2" onClick={() => { void handleRename(); }} disabled={renaming || !renameValue.trim() || renameValue.trim() === (zone?.name || '').trim()}>
                    {renaming ? 'Saving...' : 'Save name'}
                  </button>
                  {renameError ? <p className="px-2 pt-2 text-xs text-rose-600">{renameError}</p> : null}
                </div>
              </details>
            </div>
            <ThermostatDial
              value={target}
              currentTemperature={zone?.current_temperature_c ?? null}
              humidity={zone?.humidity ?? null}
              freshnessAgeMs={zone?.freshness_age_ms ?? null}
              online={(zone?.online !== false) && freshnessFromAgeMs(zone?.freshness_age_ms).state === 'fresh'}
              fault={zone?.fault ?? null}
              windowOpen={zone?.window_open ?? null}
              roomName={displayName}
              statusLabel={statusText}
              heating={Boolean(zone?.demand ?? zone?.active)}
              thermostatMode={zone?.thermostat_mode ?? zone?.mode ?? null}
              theme={thermostatTheme}
              onChange={handleTargetChange}
            />
            <p className="mt-3 text-center text-xs uppercase tracking-[0.22em] text-muted">
              {setpointStatusText}
            </p>
            <div className="thermostat-mode-list" aria-label="Supported thermostat modes">
              {supportedModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`thermostat-mode ${mode === selectedMode ? `thermostat-mode--${mode.toLowerCase()}` : 'thermostat-mode--inactive'}`}
                  onClick={() => { setSelectedMode(mode); setDirty(true); setSaveError(''); setSetpointState('idle'); }}
                  disabled={saving}
                >
                  {mode === 'KOMFORT' ? 'Comfort' : mode}
                </button>
              ))}
            </div>
            {saveError && <p className="text-center text-sm mt-2 text-rose-600">{saveError}</p>}
          </section>

          <section className="rounded-2xl app-surface shadow-soft p-4 space-y-2">
            <p className="text-sm text-muted">Status</p>
            <p className="text-base font-medium">{statusText}</p>
            <p className="text-sm text-muted">Heat Signal</p>
            <p className="text-base">{heatSignalText}</p>
            <p className="text-sm text-muted">Last Update</p>
            <p className="text-base">{zone?.freshness_age_ms == null ? 'Unknown' : `${Math.floor(zone.freshness_age_ms / 1000)}s ago`}</p>
          </section>

        </div>
      </IonContent>
    </IonPage>
  );
}
