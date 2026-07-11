import { motion } from 'framer-motion';
import { IonButton } from '@ionic/react';
import { HealthBadge } from './HealthBadge';
import { TemperatureBadge } from './TemperatureBadge';
import { MobileZone } from '../api/mobile';

interface RoomCardProps {
  zone: MobileZone;
  onOpen: () => void;
  onHistory: () => void;
  onRename: () => void;
  onSetpointChange: (delta: number) => void;
}

function zoneState(zone: MobileZone): { label: string; tone: 'good' | 'warn' | 'critical' | 'info' } {
  if (!zone.online) return { label: 'Offline', tone: 'critical' };
  if (zone.fault) return { label: 'Fault', tone: 'critical' };
  if (zone.demand) return { label: 'Heating', tone: 'warn' };
  return { label: 'Idle', tone: 'good' };
}

export function RoomCard({ zone, onOpen, onHistory, onRename, onSetpointChange }: RoomCardProps) {
  const state = zoneState(zone);
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      whileHover={{ y: -2 }}
      className="w-full text-left rounded-2xl p-4 app-surface shadow-soft border border-slate-100 min-h-[120px] cursor-pointer"
    >
      <div onClick={onOpen} className="flex items-start justify-between">
        <div>
          <p className="text-base font-semibold">{zone.name}</p>
          <p className="text-xs text-muted mt-1">Target {zone.target_temperature_c?.toFixed(1) ?? '--'}°C</p>
        </div>
        <HealthBadge label={state.label} tone={state.tone} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex items-center gap-1">
          <IonButton
            size="small"
            fill="clear"
            className="text-lg font-bold"
            onClick={(e) => { e.stopPropagation(); onSetpointChange(-0.5); }}
          >
            −
          </IonButton>
          <div onClick={onOpen}>
            <TemperatureBadge value={zone.current_temperature_c} />
          </div>
          <IonButton
            size="small"
            fill="clear"
            className="text-lg font-bold"
            onClick={(e) => { e.stopPropagation(); onSetpointChange(+0.5); }}
          >
            +
          </IonButton>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <IonButton size="small" fill="outline" onClick={(e) => { e.stopPropagation(); onRename(); }}>
          Rename
        </IonButton>
        <IonButton size="small" fill="outline" onClick={(e) => { e.stopPropagation(); onHistory(); }}>
          History
        </IonButton>
      </div>
    </motion.div>
  );
}
