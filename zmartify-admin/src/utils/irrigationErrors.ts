import { parseApiError } from './apiError';

export const toIrrigationFeedback = (error: unknown): string => {
  const raw = parseApiError(error);
  const message = raw.toLowerCase();

  if (message.includes('an irrigation program is already running') || message.includes('controller is running')) {
    return 'Another program is currently running on this controller. Stop it first, then retry.';
  }
  if (message.includes('cannot change irrigation schedules while the controller is running')) {
    return 'Schedules are locked while a program is running. Stop the active run first, then retry your schedule change.';
  }
  if (message.includes('controller telemetry is stale')) {
    return 'Controller telemetry is stale. Wait for fresh controller updates, then retry.';
  }
  if (message.includes('controller_not_idle')) {
    return 'Controller rejected the run as not idle. If no zone is currently running, set controller mode to Automatic in Devices > Controller settings, then retry.';
  }
  if (message.includes('controller is offline or mqtt is disconnected')) {
    return 'Controller is offline or MQTT is disconnected. Reconnect it, then retry.';
  }
  if (message.includes('controller supports at most 8 irrigation program schedule groups')) {
    return 'Too many schedule groups for this controller. Merge or remove schedules so the total groups stay at 8 or fewer.';
  }

  return raw;
};
