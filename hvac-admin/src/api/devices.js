import { apiClient } from './client';
export const deviceApi = {
    list: () => apiClient.get('/devices'),
    get: (deviceId) => apiClient.get(`/mobile/devices/${deviceId}`),
    create: (deviceId, displayName, mac, firmwareVersion) => apiClient.post('/devices', {
        device_id: deviceId,
        display_name: displayName,
        mac,
        firmware_version: firmwareVersion,
    }),
    assignToSite: (deviceId, siteId) => apiClient.post(`/devices/${deviceId}/site`, { site_id: siteId }),
    delete: (deviceId) => apiClient.delete(`/devices/${deviceId}`),
};
