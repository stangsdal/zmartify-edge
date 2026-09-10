import { describe, expect, it } from 'vitest';
import { Device } from '../types/api';
import { filterControllers, paginateControllers } from './controllerFleet';

const devices: Device[] = [
  { device_id: 'ahc-001', display_name: 'North floor', device_type: 'ahc9000', site_id: 4, online: true },
  { device_id: 'nilan-002', display_name: 'Plant room', device_type: 'nilan', site_id: 8, online: false },
  { device_id: 'ahc-003', display_name: 'Unassigned', device_type: 'ahc9000' },
];

describe('controllerFleet', () => {
  it('combines search, status, type and site filters', () => {
    expect(filterControllers(devices, {
      query: 'north', status: 'online', type: 'ahc9000', site: '4',
    }).map((device) => device.device_id)).toEqual(['ahc-001']);
  });

  it('treats missing online state as offline and supports unassigned controllers', () => {
    expect(filterControllers(devices, {
      query: '', status: 'offline', type: 'all', site: 'unassigned',
    }).map((device) => device.device_id)).toEqual(['ahc-003']);
  });

  it('paginates without mutating the source list', () => {
    expect(paginateControllers(devices, 2, 2).map((device) => device.device_id)).toEqual(['ahc-003']);
    expect(devices).toHaveLength(3);
  });
});