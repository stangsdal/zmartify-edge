import { Device } from '../types/api';

export type ControllerStatusFilter = 'all' | 'online' | 'offline';

export type ControllerFleetFilters = {
  query: string;
  status: ControllerStatusFilter;
  type: string;
  site: string;
};

export function filterControllers(devices: Device[], filters: ControllerFleetFilters): Device[] {
  const query = filters.query.trim().toLowerCase();
  return devices.filter((device) => {
    const searchable = [device.device_id, device.display_name, device.mac, device.firmware_version, device.device_type]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesQuery = !query || searchable.includes(query);
    const matchesStatus = filters.status === 'all'
      || (filters.status === 'online' ? device.online === true : device.online !== true);
    const matchesType = filters.type === 'all' || (device.device_type || 'unknown') === filters.type;
    const matchesSite = filters.site === 'all' || String(device.site_id ?? 'unassigned') === filters.site;
    return matchesQuery && matchesStatus && matchesType && matchesSite;
  });
}

export function paginateControllers(devices: Device[], page: number, pageSize: number): Device[] {
  const safePage = Math.max(1, page);
  return devices.slice((safePage - 1) * pageSize, safePage * pageSize);
}