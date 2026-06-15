export type FreshnessState = 'fresh' | 'stale' | 'offline';

export interface FreshnessInfo {
  state: FreshnessState;
  ageSeconds: number | null;
  label: string;
  color: string;
}

export function freshnessFromAgeMs(ageMs: number | null | undefined): FreshnessInfo {
  if (ageMs === null || ageMs === undefined) {
    return { state: 'offline', ageSeconds: null, label: 'Offline', color: '#b42318' };
  }

  const ageSeconds = Math.max(0, Math.floor(ageMs / 1000));
  if (ageSeconds < 60) {
    return { state: 'fresh', ageSeconds, label: `Fresh (${ageSeconds}s)`, color: '#027a48' };
  }
  if (ageSeconds <= 300) {
    return { state: 'stale', ageSeconds, label: `Stale (${ageSeconds}s)`, color: '#b54708' };
  }
  return { state: 'offline', ageSeconds, label: `Offline (${ageSeconds}s)`, color: '#b42318' };
}
