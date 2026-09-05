import { motion } from 'framer-motion';
import { IonIcon } from '@ionic/react';
import { batteryFullOutline, ellipsisVerticalOutline } from 'ionicons/icons';
import { HealthBadge } from './HealthBadge';
import { TemperatureBadge } from './TemperatureBadge';
import { MobileZone } from '../api/mobile';
import { displaySetpointMode, HvacZoneMode } from '../utils/hvacMode';

interface RoomCardProps {
  zone: MobileZone;
  onOpen: () => void;
  onHistory: () => void;
  onRename: () => void;
  onSetpointChange: (delta: number) => void;
  onModeChange: (mode: HvacZoneMode) => void;
  canOperate: boolean;
  canConfigure: boolean;
}

function zoneState(zone: MobileZone): { label: string; tone: 'good' | 'warn' | 'critical' | 'info' } {
  if (!zone.online) return { label: 'Offline', tone: 'critical' };
  if (zone.fault) return { label: 'Fault', tone: 'critical' };
  if (zone.demand) return { label: 'Heating', tone: 'warn' };
  return { label: 'Connected', tone: 'good' };
}

export function RoomCard({ zone, onOpen, onHistory, onRename, onSetpointChange, onModeChange, canOperate, canConfigure }: RoomCardProps) {
  const state = zoneState(zone);
  const zoneKey = zone.zone_key || `zone-${zone.zone_id}`;
  const displayName = zone.name && zone.name !== zoneKey ? zone.name : zoneKey;
  const mode = displaySetpointMode(zone.setpoint_mode);
  const modes: HvacZoneMode[] = ['MANUAL', 'ECO', 'KOMFORT', 'STANDBY'];
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="thermostat-card thermostat-card--gunmalmg thermostat-card--overview w-full text-left"
    >
      <div className="w-full text-left flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold">
            {displayName}{(zone.assigned_channel_ids?.length ? zone.assigned_channel_ids : zone.controlled_element_ids)?.length
              ? ` [${(zone.assigned_channel_ids?.length ? zone.assigned_channel_ids : zone.controlled_element_ids)?.join(',')}]`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="thermostat-card__overview-status">
            <HealthBadge label={state.label} tone={state.tone} />
            <div className="thermostat-card__signal" aria-label={zone.demand ? 'Heating on' : 'Heating off'}>
              <span className={zone.demand ? 'is-active' : ''} />{zone.demand ? 'ON' : 'OFF'}
            </div>
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
              <button type="button" className="menu-action" onClick={onOpen}>Open thermostat</button>
              <button type="button" className="menu-action" onClick={onHistory}>History</button>
              {canConfigure ? <button type="button" className="menu-action" onClick={onRename}>Rename zone</button> : null}
            </div>
          </details>
        </div>
      </div>
      <div className="thermostat-card__temperature-row">
        <button type="button" onClick={onOpen} className="mt-3 text-left" aria-label={`Open ${displayName} thermostat`}>
          <TemperatureBadge value={zone.current_temperature_c} />
        </button>
        <div className="thermostat-mode-list thermostat-mode-list--overview" aria-label="Thermostat modes">
          {modes.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={`thermostat-mode thermostat-mode--${candidate.toLowerCase()} ${candidate === mode ? '' : 'thermostat-mode--inactive'}`}
              disabled={!canOperate}
              onClick={(event) => { event.stopPropagation(); onModeChange(candidate); }}
            >
              {candidate === 'KOMFORT' ? 'Comfort' : candidate}
            </button>
          ))}
        </div>
      </div>
      <div className="thermostat-card__lever" onClick={(event) => event.stopPropagation()}>
        <span className="thermostat-card__lever-label">Setpoint</span>
        <input
          aria-label={`Setpoint for ${displayName}`}
          type="range"
          min="5"
          max="35"
          step="0.5"
          value={zone.target_temperature_c ?? 20}
          disabled={!canOperate}
          onChange={(event) => onSetpointChange(Number(event.target.value) - (zone.target_temperature_c ?? 20))}
        />
        <span className="thermostat-card__lever-value">{zone.target_temperature_c?.toFixed(1) ?? '--'}°</span>
      </div>
    </motion.div>
  );
}
