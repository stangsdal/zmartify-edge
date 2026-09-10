import { useEffect, useRef, useState } from 'react';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonSpinner, IonTitle, IonToolbar } from '@ionic/react';
import {
  arrowDownOutline,
  arrowUpOutline,
  closeOutline,
  ellipsisVerticalOutline,
  filterOutline,
  speedometerOutline,
  thermometerOutline,
  waterOutline,
} from 'ionicons/icons';
import { deviceApi } from '../api/devices';
import { subscribeRealtimeTopics } from '../api/mobile';
import { NilanCommand, NilanHvacState } from '../types/api';
import { MobileSiteDevice } from '../api/mobile';

interface NilanControlPanelProps {
  devices: MobileSiteDevice[];
  canOperate: boolean;
}

const isNilanDevice = (device: MobileSiteDevice): boolean => {
  const haystack = [device.device_id, device.display_name, device.device_type, device.integration_mode]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes('nilan') || haystack.includes('cts602') || haystack.includes('comfort-302');
};

const value = (reading: number | null | undefined, suffix = '') => (
  reading == null ? 'Ikke tilgængelig' : `${reading}${suffix}`
);

const NILAN_MODES = [
  { value: 0, label: 'Off', disabled: false },
  { value: 1, label: 'Heat', disabled: false },
  { value: 2, label: 'Cool', disabled: false },
  { value: 3, label: 'Auto', disabled: false },
  { value: 4, label: 'Service', disabled: true },
] as const;

const nilanModeLabel = (mode: number | null | undefined): string => (
  NILAN_MODES.find((candidate) => candidate.value === mode)?.label ?? 'Unknown'
);

const bypassLabel = (open: boolean | null | undefined, close: boolean | null | undefined): string => {
  if (open == null || close == null) return 'Not available';
  if (open && close) return 'Open + close active';
  if (open) return 'Opening';
  if (close) return 'Closing';
  return 'Idle';
};

const NILAN_FILTER_INTERVALS = [
  { months: 6, days: 183 },
  { months: 9, days: 274 },
  { months: 12, days: 365 },
] as const;

const filterStatusClass = (daysRemaining: number | null | undefined, intervalDays: number): string => {
  if (daysRemaining == null) return '';
  if (daysRemaining <= 0) return 'is-overdue';
  if (daysRemaining <= intervalDays * 0.25) return 'is-due-soon';
  return 'is-healthy';
};

const isFreshState = (state: NilanHvacState): boolean => (
  state.available === true && state.online === true && state.controller_online === true && state.status !== 'stale'
);

const mergeNilanState = (previous: NilanHvacState | null, incoming: NilanHvacState): NilanHvacState => {
  if (!previous) return incoming;

  const previousTimestamp = previous.source_timestamp ? Date.parse(previous.source_timestamp) : NaN;
  const incomingTimestamp = incoming.source_timestamp ? Date.parse(incoming.source_timestamp) : NaN;
  if (Number.isFinite(previousTimestamp) && Number.isFinite(incomingTimestamp) && incomingTimestamp < previousTimestamp) {
    return previous;
  }

  const reportedValues = Object.fromEntries(
    Object.entries(incoming).filter(([, reportedValue]) => reportedValue !== null && reportedValue !== undefined),
  ) as Partial<NilanHvacState>;
  return { ...previous, ...reportedValues };
};

export function NilanControlPanel({ devices, canOperate }: NilanControlPanelProps) {
  const nilanDevices = devices.filter(isNilanDevice);
  if (!nilanDevices.length) return null;

  return (
    <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {nilanDevices.map((device) => (
        <NilanDeviceCard key={device.device_id} device={device} canOperate={canOperate} />
      ))}
    </section>
  );
}

function NilanDeviceCard({ device, canOperate }: { device: MobileSiteDevice; canOperate: boolean }) {
  const [state, setState] = useState<NilanHvacState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<NilanCommand | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [filterSettingsOpen, setFilterSettingsOpen] = useState(false);
  const [selectedFilterInterval, setSelectedFilterInterval] = useState(365);
  const pendingVentSetRef = useRef<number | null>(null);
  const pendingModeSetRef = useRef<number | null>(null);
  const closeOptionsMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
  };

  const applyIncomingState = (incoming: NilanHvacState) => {
    setState((previous) => {
      const merged = mergeNilanState(previous, incoming);
      const pendingVentSet = pendingVentSetRef.current;
      const pendingModeSet = pendingModeSetRef.current;
      if (pendingVentSet !== null && merged.vent_set === pendingVentSet) {
        pendingVentSetRef.current = null;
      }
      if (pendingModeSet !== null && merged.mode_set === pendingModeSet) {
        pendingModeSetRef.current = null;
      }
      return {
        ...merged,
        ...(pendingVentSetRef.current === null ? {} : {
          vent_set: pendingVentSetRef.current,
          ventilation_level: pendingVentSetRef.current,
        }),
        ...(pendingModeSetRef.current === null ? {} : { mode_set: pendingModeSetRef.current }),
      };
    });
  };

  const loadState = async () => {
    try {
      setLoading(true);
      const nextState = await deviceApi.getNilanState(device.device_id);
      applyIncomingState(nextState);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadState();
  }, [device.device_id]);

  useEffect(() => subscribeRealtimeTopics(
    [`device:${device.device_id}:state`],
    (event) => {
      const reported = event.payload.nilan;
      if (!reported || typeof reported !== 'object') return;
      applyIncomingState(reported as NilanHvacState);
    },
  ), [device.device_id]);

  const sendCommand = async (command: NilanCommand, valueToSend: number): Promise<boolean> => {
    try {
      setBusy(command);
      setError('');
      setMessage('Sending command...');
      if (command === 'ventilation' || command === 'vent_set') {
        pendingVentSetRef.current = valueToSend;
        setState((previous) => previous ? {
          ...previous,
          vent_set: valueToSend,
          ventilation_level: valueToSend,
        } : previous);
      }
      if (command === 'mode_set') {
        pendingModeSetRef.current = valueToSend;
        setState((previous) => previous ? { ...previous, mode_set: valueToSend } : previous);
      }
      const response = await deviceApi.setNilanCommand(device.device_id, command, valueToSend);
      const field = command === 'ventilation' || command === 'vent_set'
        ? 'vent_set'
        : command === 'mode_set' ? 'mode_set'
          : command === 'inlet_speed' ? 'inlet_speed'
            : command === 'exhaust_speed' ? 'exhaust_speed' : null;
      setState((previous) => previous ? {
        ...previous,
        ...(field ? { [field]: valueToSend } : {}),
        ...(command === 'ventilation' || command === 'vent_set' ? { ventilation_level: valueToSend } : {}),
        ...(command === 'filter_interval' || command === 'filter_reset' ? { filter_interval_days: valueToSend } : {}),
        ...(command === 'filter_reset' ? { filter_days_remaining: valueToSend } : {}),
      } : previous);
      setMessage(`Command accepted (${response.command_id}).`);
      return true;
    } catch (e) {
      if (command === 'ventilation' || command === 'vent_set') {
        pendingVentSetRef.current = null;
        void loadState();
      }
      if (command === 'mode_set') {
        pendingModeSetRef.current = null;
        void loadState();
      }
      setError(e instanceof Error ? e.message : String(e));
      setMessage('');
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted"><IonSpinner name="crescent" /> Henter Nilan-status...</div>;
  if (error && !state) return <p className="text-sm text-rose-600">Nilan-status: {error}</p>;
  if (!state?.available) return <p className="text-sm text-muted">Ingen Nilan-telemetri modtaget endnu.</p>;

  const fresh = isFreshState(state);
  const displayValue = (reading: number | null | undefined, suffix = '') => value(fresh ? reading : null, suffix);
  const ventSet = state.vent_set ?? state.ventilation_level ?? 0;
  const modeSet = state.mode_set ?? 3;
  const inletSpeed = state.inlet_speed;
  const exhaustSpeed = state.exhaust_speed;
  const filterIntervalDays = state.filter_interval_days ?? 365;
  const filterClass = fresh ? filterStatusClass(state.filter_days_remaining, filterIntervalDays) : '';
  const appVersion = [state.app_version_major, state.app_version_minor, state.app_version_release]
    .every((part) => part != null && part !== '')
    ? [state.app_version_major, state.app_version_minor, state.app_version_release].join('')
    : 'Not available';

  const openFilterSettings = () => {
    setSelectedFilterInterval(filterIntervalDays);
    setFilterSettingsOpen(true);
  };

  const saveFilterInterval = async () => {
    if (await sendCommand('filter_interval', selectedFilterInterval)) setFilterSettingsOpen(false);
  };

  const resetFilterCounter = async () => {
    if (await sendCommand('filter_reset', selectedFilterInterval)) setFilterSettingsOpen(false);
  };

  return (
    <>
      <div className="nilan-card thermostat-card thermostat-card--gunmalmg thermostat-card--overview">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="thermostat-card__title truncate text-base font-semibold">{device.display_name}</p>
            <p className="text-xs text-muted">Ventilation · {fresh ? 'Online' : 'Offline'}</p>
          </div>
          <details className="relative shrink-0">
            <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-muted hover:bg-slate-100" aria-label={`More options for ${device.display_name}`}>
              <IonIcon icon={ellipsisVerticalOutline} aria-hidden="true" />
            </summary>
            <div className="absolute right-0 top-12 z-10 min-w-[170px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              <button type="button" className="menu-action" onClick={(event) => { closeOptionsMenu(event); setDetailsOpen(true); }}>Open ventilation</button>
            </div>
          </details>
        </div>

        <div className="nilan-card__reading-row">
          <button type="button" className="nilan-card__temperature" onClick={() => setDetailsOpen(true)} aria-label={`Open ${device.display_name} ventilation`}>
            <span>{fresh && state.inlet_temperature_c != null ? state.inlet_temperature_c.toFixed(1) : '--'}</span>
            <small>°C</small>
            <em>Supply air</em>
          </button>
          <div className="thermostat-mode-select">
            <label htmlFor={`nilan-mode-${device.device_id}`} className="sr-only">Ventilation mode</label>
            <select
              id={`nilan-mode-${device.device_id}`}
              aria-label="Ventilation mode"
              value={modeSet}
              disabled={!canOperate || busy !== null}
              onChange={(event) => { void sendCommand('mode_set', Number(event.target.value)); }}
            >
              {NILAN_MODES.map((mode) => <option key={mode.value} value={mode.value} disabled={mode.disabled}>{mode.label}</option>)}
            </select>
          </div>
        </div>

        <label className="nilan-card__vent-control">
          <span>Ventilation <strong>{ventSet}</strong></span>
          <div className="thermostat-slider">
            <div className="thermostat-slider__track" />
            <div className="thermostat-slider__fill" style={{ width: `${(ventSet / 4) * 100}%` }} />
            <input aria-label="Ventilation level" type="range" min="0" max="4" step="1" value={ventSet} onChange={(event) => { void sendCommand('vent_set', Number(event.target.value)); }} disabled={!canOperate || busy !== null} />
          </div>
          <span className="nilan-card__vent-scale">{[0, 1, 2, 3, 4].map((level) => <i key={level}>{level}</i>)}</span>
        </label>

        <div className="nilan-card__status-line">
          <button type="button" className={`nilan-card__filter-button ${filterClass}`} title="Filter settings" onClick={openFilterSettings}>
            <IonIcon icon={filterOutline} aria-hidden="true" />
            {fresh && state.filter_days_remaining != null ? `${state.filter_days_remaining} days` : '--'}
          </button>
          <span title="Supply air"><IonIcon icon={arrowDownOutline} aria-hidden="true" />{displayValue(inletSpeed, '%')}</span>
          <span title="Extract air"><IonIcon icon={arrowUpOutline} aria-hidden="true" />{displayValue(exhaustSpeed, '%')}</span>
          <span className="is-humidity" title="Humidity"><IonIcon icon={waterOutline} aria-hidden="true" />{displayValue(state.humidity_pct, '%')}</span>
        </div>
      </div>

      <IonModal className="nilan-filter-modal" isOpen={filterSettingsOpen} onDidDismiss={() => setFilterSettingsOpen(false)}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Filter settings</IonTitle>
            <IonButtons slot="end"><IonButton onClick={() => setFilterSettingsOpen(false)} aria-label="Close"><IonIcon icon={closeOutline} /></IonButton></IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <div className="nilan-filter-settings">
            <div>
              <p className="nilan-filter-settings__label">Replacement interval</p>
              <div className="nilan-filter-settings__intervals">
                {NILAN_FILTER_INTERVALS.map((interval) => (
                  <label key={interval.days} className={selectedFilterInterval === interval.days ? 'is-selected' : ''}>
                    <input type="radio" name={`filter-interval-${device.device_id}`} value={interval.days} checked={selectedFilterInterval === interval.days} onChange={() => setSelectedFilterInterval(interval.days)} />
                    <strong>{interval.months} months</strong>
                    <small>{interval.days} days</small>
                  </label>
                ))}
              </div>
            </div>
            <IonButton expand="block" fill="outline" onClick={() => { void saveFilterInterval(); }} disabled={!canOperate || busy !== null}>Save interval</IonButton>
            <div className="nilan-filter-settings__reset">
              <IonIcon icon={filterOutline} aria-hidden="true" />
              <div><strong>Filter replaced?</strong><p>Reset the counter to {selectedFilterInterval} days.</p></div>
            </div>
            <IonButton expand="block" onClick={() => { void resetFilterCounter(); }} disabled={!canOperate || busy !== null}>Filter replaced - reset counter</IonButton>
            {!canOperate ? <p className="text-sm text-muted">You have read-only access to filter settings.</p> : null}
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          </div>
        </IonContent>
      </IonModal>

      <IonModal isOpen={detailsOpen} onDidDismiss={() => setDetailsOpen(false)}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>{device.display_name}</IonTitle>
            <IonButtons slot="end"><IonButton onClick={() => setDetailsOpen(false)} aria-label="Close"><IonIcon icon={closeOutline} /></IonButton></IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <div className="nilan-detail">
            <div className="nilan-airflow" aria-label="Ventilation airflow overview">
              <div className="nilan-airflow__stream nilan-airflow__stream--supply">
                <IonIcon icon={arrowDownOutline} />
                <span>Supply</span>
                <strong>{displayValue(state.t7_inlet_c, ' °C')}</strong>
                <small>{displayValue(inletSpeed, '%')}</small>
              </div>
              <div className="nilan-airflow__unit">
                <span>NILAN</span>
                <IonIcon icon={speedometerOutline} />
                <strong>Level {ventSet}</strong>
              </div>
              <div className="nilan-airflow__stream nilan-airflow__stream--extract">
                <IonIcon icon={arrowUpOutline} />
                <span>Extract</span>
                <strong>{displayValue(state.t3_exhaust_c, ' °C')}</strong>
                <small>{displayValue(exhaustSpeed, '%')}</small>
              </div>
            </div>

            <section className="nilan-detail__section">
              <h2>Operating status</h2>
              <div className="nilan-detail__metrics nilan-detail__metrics--status">
                <div><IonIcon icon={speedometerOutline} /><span>Control.RunAct</span><strong>{fresh && state.run_actual != null ? (state.run_actual ? 'On' : 'Off') : 'Not available'}</strong></div>
                <div><IonIcon icon={speedometerOutline} /><span>Control.ModeAct</span><strong>{fresh ? nilanModeLabel(state.mode_actual) : 'Not available'}</strong></div>
                <div><IonIcon icon={arrowUpOutline} /><span>Bypass</span><strong>{fresh ? bypassLabel(state.bypass_open, state.bypass_close) : 'Not available'}</strong></div>
              </div>
            </section>

            <section className="nilan-detail__section">
              <h2>Temperatures</h2>
              <div className="nilan-detail__metrics nilan-detail__metrics--temperatures">
                <div><IonIcon icon={thermometerOutline} /><span>T1 · Intake</span><strong>{displayValue(state.t1_intake_c, ' °C')}</strong></div>
                <div><IonIcon icon={thermometerOutline} /><span>T2 · Inlet</span><strong>{displayValue(state.t2_inlet_c, ' °C')}</strong></div>
                <div><IonIcon icon={thermometerOutline} /><span>T3 · Exhaust</span><strong>{displayValue(state.t3_exhaust_c, ' °C')}</strong></div>
                <div><IonIcon icon={thermometerOutline} /><span>T4 · Outlet</span><strong>{displayValue(state.t4_outlet_c, ' °C')}</strong></div>
                <div><IonIcon icon={thermometerOutline} /><span>T7 · Inlet after heater</span><strong>{displayValue(state.t7_inlet_c, ' °C')}</strong></div>
                <div><IonIcon icon={thermometerOutline} /><span>T8 · Outdoor</span><strong>{displayValue(state.t8_outdoor_c, ' °C')}</strong></div>
                <div><IonIcon icon={thermometerOutline} /><span>T9 · Heater</span><strong>{displayValue(state.t9_heater_c, ' °C')}</strong></div>
              </div>
            </section>

            <div className="nilan-detail__metrics">
              <div><IonIcon icon={thermometerOutline} /><span>Room</span><strong>{displayValue(state.room_temperature_c, ' °C')}</strong></div>
              <div><IonIcon icon={waterOutline} /><span>Humidity</span><strong>{displayValue(state.humidity_pct, '%')}</strong></div>
              <div><IonIcon icon={filterOutline} /><span>Filter</span><strong>{displayValue(state.filter_days_remaining, ' days')}</strong></div>
              <div><IonIcon icon={speedometerOutline} /><span>CO₂</span><strong>{displayValue(state.co2_ppm, ' ppm')}</strong></div>
            </div>

            {!fresh ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Data is stale or the controller is offline.</p> : null}

            <section className="nilan-detail__controls">
              <h2>Ventilation control</h2>
              <label>
                <span>Level <strong>{ventSet}</strong></span>
                <input type="range" min="0" max="4" step="1" value={ventSet} onChange={(event) => { void sendCommand('vent_set', Number(event.target.value)); }} disabled={!canOperate || busy !== null} />
              </label>
              {(['inlet_speed', 'exhaust_speed'] as const).map((command) => {
                const current = state[command] ?? 0;
                const label = command === 'inlet_speed' ? 'Supply fan' : 'Extract fan';
                return (
                  <label key={command}>
                    <span>{label} <strong>{current}%</strong></span>
                    <input type="range" min="0" max="100" step="1" value={current} onChange={(event) => { void sendCommand(command, Number(event.target.value)); }} disabled={!canOperate || busy !== null} />
                  </label>
                );
              })}
            </section>
            <section className="nilan-detail__section nilan-detail__advanced">
              <h2>Advanced information</h2>
              <div className="nilan-detail__metrics nilan-detail__metrics--status">
                <div><IonIcon icon={speedometerOutline} /><span>Bus.Version</span><strong>{fresh && state.bus_version != null ? state.bus_version : 'Not available'}</strong></div>
                <div><IonIcon icon={speedometerOutline} /><span>App.Version</span><strong>{fresh ? appVersion : 'Not available'}</strong></div>
                <div><IonIcon icon={thermometerOutline} /><span>Controller board</span><strong>{displayValue(state.controller_board_temperature_c, ' °C')}</strong></div>
              </div>
            </section>
            {!canOperate ? <p className="text-sm text-muted">You have read-only access to ventilation controls.</p> : null}
            {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          </div>
        </IonContent>
      </IonModal>
    </>
  );
}
