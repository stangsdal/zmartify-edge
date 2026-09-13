export type AlertPriority = 'critical' | 'warning' | 'info';

export function priorityFromEventType(eventType: string): AlertPriority {
  if (eventType.includes('fault') || eventType.includes('failed') || eventType.includes('offline')) return 'critical';
  if (eventType === 'zone_setpoint_changed') return 'info';
  if (eventType.includes('alarm') || eventType.includes('setpoint')) return 'warning';
  return 'info';
}