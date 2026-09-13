import { describe, expect, it } from 'vitest';
import { priorityFromEventType } from './alertPriority';

describe('priorityFromEventType', () => {
  it('treats a normal zone setpoint change as informational', () => {
    expect(priorityFromEventType('zone_setpoint_changed')).toBe('info');
  });

  it('keeps setpoint failures critical', () => {
    expect(priorityFromEventType('setpoint_write_failed')).toBe('critical');
  });
});