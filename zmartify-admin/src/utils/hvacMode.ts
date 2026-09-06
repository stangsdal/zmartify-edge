export type HvacZoneMode = 'MANUAL' | 'ECO' | 'KOMFORT' | 'HOLIDAY' | 'STANDBY' | 'PARTY';

const MODE_BY_NUMBER: Record<number, HvacZoneMode> = {
  0: 'MANUAL',
  1: 'STANDBY',
  2: 'ECO',
  3: 'KOMFORT',
  4: 'STANDBY',
  5: 'PARTY',
};

export const SETPOINT_MODE_BY_NAME: Record<HvacZoneMode, number> = {
  MANUAL: 0,
  KOMFORT: 1,
  ECO: 2,
  HOLIDAY: 3,
  STANDBY: 4,
  PARTY: 5,
};

export function displaySetpointMode(mode: number | null | undefined): HvacZoneMode {
  const entry = Object.entries(SETPOINT_MODE_BY_NAME).find(([, value]) => value === mode);
  return (entry?.[0] as HvacZoneMode | undefined) ?? 'MANUAL';
}

export function displayHvacMode(mode: number | string | null | undefined, heating = false): HvacZoneMode {
  if (typeof mode === 'number' && MODE_BY_NUMBER[mode]) return MODE_BY_NUMBER[mode];

  const normalized = String(mode ?? '').trim().toUpperCase();
  if (normalized === 'COMFORT') return 'KOMFORT';
  if (normalized === 'MANUAL' || normalized === 'ECO' || normalized === 'KOMFORT' || normalized === 'HOLIDAY' || normalized === 'STANDBY' || normalized === 'PARTY') {
    return normalized;
  }

  return heating ? 'KOMFORT' : 'MANUAL';
}
