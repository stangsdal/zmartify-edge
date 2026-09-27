import { describe, expect, it } from 'vitest';
import { isIrrigationRuntimeActive } from './irrigationRuntime';

describe('irrigation runtime activity', () => {
  it('treats an idle controller snapshot with zero values as inactive', () => {
    expect(isIrrigationRuntimeActive({
      active_program_name: null,
      active_zone_id: 0,
      remaining_seconds: 0,
    })).toBe(false);
  });

  it('recognizes each reported activity signal', () => {
    expect(isIrrigationRuntimeActive({ active_program_name: 'Garden' })).toBe(true);
    expect(isIrrigationRuntimeActive({ active_zone_id: 2 })).toBe(true);
    expect(isIrrigationRuntimeActive({ remaining_seconds: 60 })).toBe(true);
  });
});