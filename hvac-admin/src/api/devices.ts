import { apiClient } from './client';
import { Device, DeviceClaimRequest, DeviceDiscovery, DeviceFreshness } from '../types/api';

export const deviceApi = {
  list: () => apiClient.get('/devices'),
  
  get: (deviceId: string) => apiClient.get(`/mobile/devices/${deviceId}`),

  getFreshness: (deviceId: string): Promise<DeviceFreshness> =>
    apiClient.get(`/mobile/devices/${deviceId}/freshness`),
  
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

  discover: (baseUrl: string): Promise<DeviceDiscovery> =>
    apiClient.post('/devices/discover', { base_url: baseUrl }),

  claim: (payload: DeviceClaimRequest) =>
    apiClient.post('/devices/claim', payload),

  getOnboardingStatus: (deviceId: string) =>
    apiClient.get(`/devices/${deviceId}/onboarding-status`),
  
  assignToSite: (deviceId: string, siteId: number): Promise<Device> =>
    apiClient.post(`/devices/${deviceId}/site`, { site_id: siteId }),
  
  delete: (deviceId: string) => apiClient.delete(`/devices/${deviceId}`),
};
