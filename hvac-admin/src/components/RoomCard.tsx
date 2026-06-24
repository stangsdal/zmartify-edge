import { motion } from 'framer-motion';
import { IonButton } from '@ionic/react';
import { HealthBadge } from './HealthBadge';
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
  const target = zone.target_temperature_c;
  const current = zone.current_temperature_c;
  const humidity = zone.humidity;
  const targetText = typeof target === 'number' ? target.toFixed(1) : '--';
  const currentText = typeof current === 'number' ? current.toFixed(1) : '--';
  const modeMap: Record<number, string> = {
    0: 'Manual',
    1: 'Standby',
    2: 'Eco',
    3: 'Comfort',
  };
  const modeLabel =
    typeof zone.thermostat_mode === 'number' && zone.thermostat_mode in modeMap
      ? modeMap[zone.thermostat_mode]
      : typeof zone.mode === 'number' && zone.mode in modeMap
        ? modeMap[zone.mode]
        : zone.demand
          ? 'Comfort'
          : 'Manual';
  // Map setpoint to marker position on a 16-30C control rail.
  const markerRatio = Math.max(0, Math.min(1, ((target ?? 20) - 16) / (30 - 16)));

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      whileHover={{ y: -2 }}
      className="w-full text-left rounded-3xl p-5 app-surface shadow-soft border border-slate-100 min-h-[200px] cursor-pointer"
    >
      <div onClick={onOpen} className="flex items-start justify-between">
        <div>
          <p className="text-base font-semibold">{zone.name}</p>
          <p className="text-xs text-muted mt-1">Mini climate control</p>
        </div>
        <HealthBadge label={state.label} tone={state.tone} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" onClick={onOpen}>
        <span className="rounded-full bg-brand-primary/10 text-brand-primary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em]">
          {modeLabel}
        </span>
        <span className="rounded-full bg-slate-100 text-slate-700 px-2.5 py-1 text-[11px] font-medium">
          Room {currentText}°C
        </span>
        <span className="rounded-full bg-slate-100 text-slate-700 px-2.5 py-1 text-[11px] font-medium">
          Humidity {typeof humidity === 'number' ? `${humidity}%` : '--'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-4 items-stretch">
        <div onClick={onOpen} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted">Setpoint</p>
          <div className="mt-1 flex items-end gap-1">
            <p className="text-5xl leading-none font-semibold text-brand-primary">{targetText}</p>
            <p className="text-lg leading-7 text-brand-primary">°C</p>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted">Room</span>
            <span className="font-medium text-slate-700">{currentText}°C</span>
          </div>
        </div>

        <div className="flex items-center">
          <div className="rounded-[20px] border border-slate-100 bg-slate-50/70 px-2 py-2.5 flex flex-col items-center gap-2">
            <IonButton
              size="small"
              fill="clear"
              className="!m-0 !w-9 !h-9 !min-w-[36px] !min-h-[36px] !rounded-full !text-xl !font-semibold !text-brand-primary"
              onClick={(e) => {
                e.stopPropagation();
                onSetpointChange(+0.5);
              }}
            >
              +
            </IonButton>

            <div className="relative h-24 w-6 rounded-full bg-gradient-to-b from-[#98c6ff] via-[#9d95ff] to-[#5870ff] overflow-hidden shadow-inner">
              <div
                className="absolute left-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-white shadow"
                style={{ bottom: `calc(${(markerRatio * 100).toFixed(2)}% - 6px)` }}
              />
            </div>

            <IonButton
              size="small"
              fill="clear"
              className="!m-0 !w-9 !h-9 !min-w-[36px] !min-h-[36px] !rounded-full !text-xl !font-semibold !text-brand-primary"
              onClick={(e) => {
                e.stopPropagation();
                onSetpointChange(-0.5);
              }}
            >
              −
            </IonButton>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
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
