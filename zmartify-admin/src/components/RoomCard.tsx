import { motion } from 'framer-motion';
import { IonButton, IonIcon } from '@ionic/react';
import { ellipsisVerticalOutline } from 'ionicons/icons';
import { HealthBadge } from './HealthBadge';
import { TemperatureBadge } from './TemperatureBadge';
import { MobileZone } from '../api/mobile';
import { displayHvacMode } from '../utils/hvacMode';

interface RoomCardProps {
  zone: MobileZone;
  onOpen: () => void;
  onHistory: () => void;
  onRename: () => void;
  onSetpointChange: (delta: number) => void;
  canOperate: boolean;
  canConfigure: boolean;
}

function zoneState(zone: MobileZone): { label: string; tone: 'good' | 'warn' | 'critical' | 'info' } {
  if (!zone.online) return { label: 'Offline', tone: 'critical' };
  if (zone.fault) return { label: 'Fault', tone: 'critical' };
  if (zone.demand) return { label: 'Heating', tone: 'warn' };
  return { label: 'Idle', tone: 'good' };
}

export function RoomCard({ zone, onOpen, onHistory, onRename, onSetpointChange, canOperate, canConfigure }: RoomCardProps) {
  const state = zoneState(zone);
  const zoneKey = zone.zone_key || `zone-${zone.zone_id}`;
  const displayName = zone.name && zone.name !== zoneKey ? zone.name : zoneKey;
  const mode = displayHvacMode(zone.thermostat_mode ?? zone.mode, Boolean(zone.demand ?? zone.active));
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="w-full text-left rounded-2xl p-4 app-surface shadow-soft border border-slate-100 min-h-[120px]"
    >
      <div className="w-full text-left flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold">{displayName}</p>
          <p className="text-xs text-muted mt-1">Target {zone.target_temperature_c?.toFixed(1) ?? '--'}°C</p>
        </div>
        <div className="flex items-center gap-2">
          <HealthBadge label={state.label} tone={state.tone} />
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
      <button type="button" onClick={onOpen} className="mt-3 w-full text-left">
        <div className="flex items-center justify-between gap-3">
          <TemperatureBadge value={zone.current_temperature_c} />
          <span className={`thermostat-mode thermostat-mode--${mode.toLowerCase()}`}>{mode}</span>
        </div>
      </button>
      <div className="mt-3 flex items-center justify-end gap-3">
        <div className="flex items-center gap-1">
          {canOperate ? <IonButton
            size="small"
            fill="clear"
            className="text-lg font-bold"
            onClick={(e) => { e.stopPropagation(); onSetpointChange(-0.5); }}
          >
            −
          </IonButton> : null}
          {canOperate ? <IonButton
            size="small"
            fill="clear"
            className="text-lg font-bold"
            onClick={(e) => { e.stopPropagation(); onSetpointChange(+0.5); }}
          >
            +
          </IonButton> : null}
        </div>
      </div>
    </motion.div>
  );
}
