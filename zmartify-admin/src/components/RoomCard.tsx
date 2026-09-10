import { motion } from 'framer-motion';
import { IonIcon } from '@ionic/react';
import { batteryFullOutline, ellipsisVerticalOutline, flameOutline, wifiOutline } from 'ionicons/icons';
import { TemperatureBadge } from './TemperatureBadge';
import { MobileZone } from '../api/mobile';
import { displaySetpointMode, HvacZoneMode } from '../utils/hvacMode';

interface RoomCardProps {
  zone: MobileZone;
  controllerLabel?: string;
  onOpen: () => void;
  onHistory: () => void;
  onRename: () => void;
  onAdvancedSettings: () => void;
  onSetpointChange: (target: number) => void;
  onModeChange: (mode: HvacZoneMode) => void;
  canOperate: boolean;
  canConfigure: boolean;
}

function rssiQuality(zone: MobileZone): number | null {
  const values = [zone.rssi_element_dbm, zone.rssi_control_unit_dbm]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return null;
  const rssi = Math.min(...values);
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

export function RoomCard({ zone, controllerLabel, onOpen, onHistory, onRename, onAdvancedSettings, onSetpointChange, onModeChange, canOperate, canConfigure }: RoomCardProps) {
  const zoneKey = zone.zone_key || `zone-${zone.zone_id}`;
  const hasDescriptiveName = Boolean(zone.name && zone.name !== zoneKey);
  const displayName = hasDescriptiveName ? zone.name! : [controllerLabel, zoneKey].filter(Boolean).join(' ');
  const channelIds = zone.assigned_channel_ids?.length ? zone.assigned_channel_ids : zone.controlled_element_ids;
  const displayLabel = !hasDescriptiveName && channelIds?.length
    ? `${displayName} [${channelIds.join(',')}]`
    : displayName;
  const mode = displaySetpointMode(zone.setpoint_mode);
  const signalQuality = rssiQuality(zone);
  const signalLabel = signalQuality === null ? 'Signal unavailable' : `Signal quality ${signalQuality} of 4`;
  const modes: HvacZoneMode[] = ['MANUAL', 'ECO', 'KOMFORT', 'HOLIDAY', 'STANDBY', 'PARTY'];
  const closeMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
  };
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="thermostat-card thermostat-card--gunmalmg thermostat-card--overview w-full text-left"
    >
      <div className="w-full text-left flex items-center justify-between gap-2">
        <p className="thermostat-card__title text-base font-semibold" title={displayLabel}>{displayLabel}</p>
        <div className="flex shrink-0 items-center gap-2">
          <div className="thermostat-card__overview-status">
            <div className="thermostat-card__connection" title={signalLabel} aria-label={signalLabel}>
              <IonIcon icon={wifiOutline} aria-hidden="true" />
              <span className="thermostat-card__rssi" aria-hidden="true">
                {[1, 2, 3, 4].map((level) => <i key={level} className={signalQuality !== null && level <= signalQuality ? 'is-active' : ''} />)}
              </span>
            </div>
            <span
              className={`thermostat-card__heat-status ${zone.demand === true ? 'is-active' : ''}`}
              aria-label={zone.demand === true ? 'Heating on' : 'Heating off'}
              title={zone.demand === true ? 'Heating on' : 'Heating off'}
            >
              <IonIcon icon={flameOutline} aria-hidden="true" />
            </span>
          </div>
          {typeof zone.battery_percent === 'number' ? (
            <span
              className={`thermostat-card__battery ${zone.battery_percent <= 20 ? 'thermostat-card__battery--low' : ''}`}
              aria-label={`Battery ${zone.battery_percent}%`}
              title={`Battery ${zone.battery_percent}%`}
            >
              <IonIcon icon={batteryFullOutline} aria-hidden="true" />
              <span>{zone.battery_percent}%</span>
            </span>
          ) : null}
          <details className="relative" onClick={(event) => event.stopPropagation()}>
            <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-muted hover:bg-slate-100" aria-label={`More options for ${displayName}`}>
              <IonIcon icon={ellipsisVerticalOutline} aria-hidden="true" />
            </summary>
            <div className="absolute right-0 top-12 z-10 min-w-[150px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              <button type="button" className="menu-action" onClick={(event) => { closeMenu(event); onOpen(); }}>Open thermostat</button>
              <button type="button" className="menu-action" onClick={(event) => { closeMenu(event); onHistory(); }}>History</button>
              {canConfigure ? <button type="button" className="menu-action" onClick={(event) => { closeMenu(event); onRename(); }}>Rename zone</button> : null}
              {canConfigure ? <button type="button" className="menu-action" onClick={(event) => { closeMenu(event); onAdvancedSettings(); }}>Advanced settings</button> : null}
            </div>
          </details>
        </div>
      </div>
      <div className="thermostat-card__temperature-row">
        <button type="button" onClick={onOpen} className="mt-3 text-left" aria-label={`Open ${displayName} thermostat`}>
          <TemperatureBadge value={zone.current_temperature_c} />
        </button>
        <div className="thermostat-mode-select" onClick={(event) => event.stopPropagation()}>
          <label htmlFor={`mode-${zoneKey}`} className="sr-only">Temperature mode</label>
          <select
            id={`mode-${zoneKey}`}
            aria-label="Temperature mode"
            value={mode}
            disabled={!canOperate}
            onChange={(event) => onModeChange(event.target.value as HvacZoneMode)}
          >
            {modes.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate === 'KOMFORT' ? 'Comfort' : candidate}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="thermostat-card__lever" onClick={(event) => event.stopPropagation()}>
        <span className="thermostat-card__lever-label">
          {zone.target_temperature_c?.toFixed(1) ?? '--'}°
        </span>
        <input
          aria-label={`Setpoint for ${displayName}`}
          type="range"
          min="5"
          max="35"
          step="0.5"
          value={zone.target_temperature_c ?? 20}
          disabled={!canOperate}
          onChange={(event) => onSetpointChange(Number(event.target.value))}
        />
      </div>
    </motion.div>
  );
}
