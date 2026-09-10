export type HvacZoneMode = 'MANUAL' | 'ECO' | 'KOMFORT' | 'HOLIDAY' | 'STANDBY' | 'PARTY';

const ZONE_MODE_BY_NUMBER: Record<number, HvacZoneMode> = {
  0: 'MANUAL',
  1: 'STANDBY',
  2: 'ECO',
  3: 'KOMFORT',
  4: 'PARTY',
  5: 'HOLIDAY',
};

export const ZONE_MODE_BY_NAME: Record<HvacZoneMode, number> = {
  MANUAL: 0,
  KOMFORT: 3,
  ECO: 2,
  HOLIDAY: 5,
  STANDBY: 1,
  PARTY: 4,
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
  return mode == null ? 'MANUAL' : ZONE_MODE_BY_NUMBER[mode] ?? 'MANUAL';
}

export function setpointForMode(
  profiles: Record<string, number> | null | undefined,
  mode: HvacZoneMode,
): number | undefined {
  const value = profiles?.[String(SETPOINT_MODE_BY_NAME[mode])];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function displayHvacMode(mode: number | string | null | undefined, heating = false): HvacZoneMode {
  if (typeof mode === 'number' && ZONE_MODE_BY_NUMBER[mode]) return ZONE_MODE_BY_NUMBER[mode];

  const normalized = String(mode ?? '').trim().toUpperCase();
  if (normalized === 'COMFORT') return 'KOMFORT';
  if (normalized === 'MANUAL' || normalized === 'ECO' || normalized === 'KOMFORT' || normalized === 'HOLIDAY' || normalized === 'STANDBY' || normalized === 'PARTY') {
    return normalized;
  }

  return heating ? 'KOMFORT' : 'MANUAL';
}

export function mostCommonHvacMode(modes: Array<number | null | undefined>): HvacZoneMode {
  if (!modes.length) return 'MANUAL';

  const counts = new Map<HvacZoneMode, number>();
  let mostCommon = displaySetpointMode(modes[0]);
  for (const value of modes) {
    const mode = displaySetpointMode(value);
    const count = (counts.get(mode) ?? 0) + 1;
    counts.set(mode, count);
    if (count > (counts.get(mostCommon) ?? 0)) mostCommon = mode;
  }
  return mostCommon;
}
