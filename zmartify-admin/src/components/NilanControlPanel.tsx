import { useEffect, useRef, useState } from 'react';
import { IonIcon, IonSpinner } from '@ionic/react';
import { ellipsisVerticalOutline } from 'ionicons/icons';
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
    <section className="space-y-3">
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
  const pendingVentSetRef = useRef<number | null>(null);

  const applyIncomingState = (incoming: NilanHvacState) => {
    setState((previous) => {
      const merged = mergeNilanState(previous, incoming);
      const pendingVentSet = pendingVentSetRef.current;
      if (pendingVentSet === null) return merged;
      if (merged.vent_set === pendingVentSet) {
        pendingVentSetRef.current = null;
        return merged;
      }
      return {
        ...merged,
        vent_set: pendingVentSet,
        ventilation_level: pendingVentSet,
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

  const sendCommand = async (command: NilanCommand, valueToSend: number) => {
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
      const response = await deviceApi.setNilanCommand(device.device_id, command, valueToSend);
      const field = command === 'ventilation' || command === 'vent_set'
        ? 'vent_set'
        : command === 'inlet_speed' ? 'inlet_speed' : 'exhaust_speed';
      setState((previous) => previous ? {
        ...previous,
        [field]: valueToSend,
        ...(command === 'ventilation' || command === 'vent_set' ? { ventilation_level: valueToSend } : {}),
      } : previous);
      setMessage(`Command accepted (${response.command_id}).`);
    } catch (e) {
      if (command === 'ventilation' || command === 'vent_set') {
        pendingVentSetRef.current = null;
        void loadState();
      }
      setError(e instanceof Error ? e.message : String(e));
      setMessage('');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted"><IonSpinner name="crescent" /> Henter Nilan-status...</div>;
  if (error && !state) return <p className="text-sm text-rose-600">Nilan-status: {error}</p>;
  if (!state?.available) return <p className="text-sm text-muted">Ingen Nilan-telemetri modtaget endnu.</p>;

  const fresh = isFreshState(state);
  const displayValue = (reading: number | null | undefined, suffix = '') => value(fresh ? reading : null, suffix);

  return (
    <div className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-base font-semibold">{device.display_name}</p>
          <p className="text-xs text-muted">{state.controller_online ? 'Controller online' : 'Controller offline'} · {state.status || 'Ukendt status'}</p>
        </div>
        <details className="relative">
          <summary
            className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-muted hover:bg-slate-100"
            aria-label={`Flere muligheder for ${device.display_name}`}
          >
            <IonIcon icon={ellipsisVerticalOutline} aria-hidden="true" />
          </summary>
          <div className="absolute right-0 top-12 z-10 min-w-[170px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
            <button type="button" className="menu-action" disabled>Avancerede indstillinger</button>
          </div>
        </details>
      </div>

      {!fresh ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Data er stale eller controlleren er offline. Målinger vises ikke som aktuelle værdier.
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <p><span className="text-muted">Ventilationstrin</span><br /><strong>{displayValue(state.vent_set ?? state.ventilation_level, ' / 4')}</strong></p>
        <p><span className="text-muted">Rumtemperatur</span><br /><strong>{displayValue(state.room_temperature_c, ' °C')}</strong></p>
        <p><span className="text-muted">Indblæsning</span><br /><strong>{displayValue(state.inlet_speed, '%')}</strong></p>
        <p><span className="text-muted">Udsugning</span><br /><strong>{displayValue(state.exhaust_speed, '%')}</strong></p>
        <p><span className="text-muted">Indblæsningstemp.</span><br /><strong>{displayValue(state.inlet_temperature_c, ' °C')}</strong></p>
        <p><span className="text-muted">Udsugningstemp.</span><br /><strong>{displayValue(state.extract_temperature_c, ' °C')}</strong></p>
        <p><span className="text-muted">Luftfugtighed</span><br /><strong>{displayValue(state.humidity_pct, '%')}</strong></p>
        <p><span className="text-muted">CO₂</span><br /><strong>{displayValue(state.co2_ppm, ' ppm')}</strong></p>
        <p><span className="text-muted">Filter</span><br /><strong>{displayValue(state.filter_days_remaining, ' dage')}</strong></p>
        <p><span className="text-muted">Data</span><br /><strong>{state.freshness_age_ms == null ? 'Ukendt' : `${Math.floor(state.freshness_age_ms / 1000)} sek. gammel`}</strong></p>
      </div>

      {canOperate ? (
        <div className="mt-4">
          <label className="text-sm">
            <span className="font-medium">Ventilationstrin</span>
            <div className="thermostat-slider mt-2">
              <div className="thermostat-slider__track" />
              <div
                className="thermostat-slider__fill"
                style={{ width: `${(((state.vent_set ?? state.ventilation_level ?? 1) - 1) / 3) * 100}%` }}
              />
              <input
                aria-label="Ventilationstrin"
                type="range"
                min="1"
                max="4"
                step="1"
                value={state.vent_set ?? state.ventilation_level ?? 1}
                onChange={(event) => { void sendCommand('vent_set', Number(event.target.value)); }}
                disabled={busy !== null}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted">
              {[1, 2, 3, 4].map((level) => <span key={level}>{level}</span>)}
            </div>
          </label>
          {(['inlet_speed', 'exhaust_speed'] as const).map((command) => {
            const current = state[command] ?? 0;
            const label = command === 'inlet_speed' ? 'Indblæsning (%)' : 'Udsugning (%)';
            return (
              <label className="mt-4 block text-sm" key={command}>
                <span className="font-medium">{label}</span>
                <div className="thermostat-slider mt-2">
                  <div className="thermostat-slider__track" />
                  <div className="thermostat-slider__fill" style={{ width: `${current}%` }} />
                  <input
                    aria-label={label}
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={current}
                    onChange={(event) => { void sendCommand(command, Number(event.target.value)); }}
                    disabled={busy !== null}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted"><span>0%</span><span>{current}%</span><span>100%</span></div>
              </label>
            );
          })}
        </div>
      ) : <p className="mt-3 text-sm text-muted">You have read-only access to ventilation controls.</p>}

      {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}
