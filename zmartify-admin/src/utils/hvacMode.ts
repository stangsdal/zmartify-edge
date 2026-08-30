export type HvacZoneMode = 'MANUAL' | 'ECO' | 'KOMFORT' | 'STANDBY';

const MODE_BY_NUMBER: Record<number, HvacZoneMode> = {
  0: 'MANUAL',
  1: 'STANDBY',
  2: 'ECO',
  3: 'KOMFORT',
};

export function displayHvacMode(mode: number | string | null | undefined, heating = false): HvacZoneMode {
  if (typeof mode === 'number' && MODE_BY_NUMBER[mode]) return MODE_BY_NUMBER[mode];

  const normalized = String(mode ?? '').trim().toUpperCase();
  if (normalized === 'COMFORT') return 'KOMFORT';
  if (normalized === 'MANUAL' || normalized === 'ECO' || normalized === 'KOMFORT' || normalized === 'STANDBY') {
    return normalized;
  }

  return heating ? 'KOMFORT' : 'MANUAL';
}

