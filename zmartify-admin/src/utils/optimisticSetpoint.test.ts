import { describe, expect, it } from 'vitest';
import { MobileZone } from '../api/mobile';
import { reconcileDesiredSetpoint } from './optimisticSetpoint';

const zone = (overrides: Partial<MobileZone>): MobileZone => ({
  zone_id: 1,
  name: 'Living room',
  target_temperature_c: 20,
  ...overrides,
});

describe('reconcileDesiredSetpoint', () => {
  it('keeps the desired target over stale polling data', () => {
    const result = reconcileDesiredSetpoint(zone({}), 22);

    expect(result.zone.target_temperature_c).toBe(22);
    expect(result.settled).toBe(false);
  });

  it('keeps the desired target while device feedback is pending', () => {
    const result = reconcileDesiredSetpoint(zone({
      setpoint_pending: true,
      setpoint_command_state: 'pending_device_feedback',
      setpoint_requested_target_c: 22,
    }), 22);

    expect(result.zone.target_temperature_c).toBe(22);
    expect(result.settled).toBe(false);
  });

  it('settles after the desired target is confirmed', () => {
    const result = reconcileDesiredSetpoint(zone({
      target_temperature_c: 22,
      setpoint_pending: false,
      setpoint_command_state: 'confirmed',
    }), 22);

    expect(result.zone.target_temperature_c).toBe(22);
    expect(result.settled).toBe(true);
  });

  it('settles and exposes the reported target after failure', () => {
    const result = reconcileDesiredSetpoint(zone({
      setpoint_command_state: 'failed_device_rejected',
    }), 22);

    expect(result.zone.target_temperature_c).toBe(20);
    expect(result.settled).toBe(true);
  });
});