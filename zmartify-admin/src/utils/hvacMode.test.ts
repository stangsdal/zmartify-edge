import { describe, expect, it } from 'vitest';
import { displaySetpointMode, mostCommonHvacMode, setpointForMode, SETPOINT_MODE_BY_NAME, ZONE_MODE_BY_NAME } from './hvacMode';

describe('HVAC mode mappings', () => {
  it('maps controller channel modes to their displayed names', () => {
    expect(displaySetpointMode(1)).toBe('STANDBY');
    expect(displaySetpointMode(3)).toBe('KOMFORT');
    expect(displaySetpointMode(4)).toBe('PARTY');
    expect(displaySetpointMode(5)).toBe('HOLIDAY');
  });

  it('keeps channel modes separate from setpoint profile indexes', () => {
    expect(ZONE_MODE_BY_NAME.KOMFORT).toBe(3);
    expect(SETPOINT_MODE_BY_NAME.KOMFORT).toBe(1);
    expect(ZONE_MODE_BY_NAME.HOLIDAY).toBe(5);
    expect(SETPOINT_MODE_BY_NAME.HOLIDAY).toBe(3);
  });

  it('selects the target from the corresponding profile immediately', () => {
    const profiles = { '0': 21, '1': 22.5, '2': 19, '3': 16, '4': 12, '5': 23 };

    expect(setpointForMode(profiles, 'KOMFORT')).toBe(22.5);
    expect(setpointForMode(profiles, 'HOLIDAY')).toBe(16);
    expect(setpointForMode(undefined, 'ECO')).toBeUndefined();
  });

  it('uses the most common site mode and keeps the first mode when tied', () => {
    expect(mostCommonHvacMode([1, 0, 1])).toBe('STANDBY');
    expect(mostCommonHvacMode([3, 0])).toBe('KOMFORT');
    expect(mostCommonHvacMode([])).toBe('MANUAL');
  });
});