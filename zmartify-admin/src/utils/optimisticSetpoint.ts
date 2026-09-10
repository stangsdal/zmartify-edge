import { MobileZone } from '../api/mobile';

export function reconcileDesiredSetpoint(
  zone: MobileZone,
  desiredTarget: number | undefined,
): { zone: MobileZone; settled: boolean } {
  if (desiredTarget === undefined) return { zone, settled: false };

  const commandState = String(zone.setpoint_command_state || '');
  const targetMatches = typeof zone.target_temperature_c === 'number'
    && Math.abs(zone.target_temperature_c - desiredTarget) < 0.01;
  const confirmed = targetMatches
    && (commandState === 'confirmed' || zone.setpoint_pending === false);
  const failed = commandState.startsWith('failed');

  if (confirmed || failed) return { zone, settled: true };

  return {
    zone: { ...zone, target_temperature_c: desiredTarget },
    settled: false,
  };
}