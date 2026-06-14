import { apiClient } from './client';
import { Device } from '../types/api';

export const deviceApi = {
  list: () => apiClient.get('/devices'),
  
  get: (deviceId: string) => apiClient.get(`/mobile/devices/${deviceId}`),
  
  create: (
    deviceId: string,
    displayName: string,
    mac?: string,
    firmwareVersion?: string
  ): Promise<Device> =>
    apiClient.post('/devices', {
      device_id: deviceId,
      display_name: displayName,
      mac,
      firmware_version: firmwareVersion,
    }),
  
  assignToSite: (deviceId: string, siteId: number): Promise<Device> =>
    apiClient.post(`/devices/${deviceId}/site`, { site_id: siteId }),
  
  delete: (deviceId: string) => apiClient.delete(`/devices/${deviceId}`),
};
