import { apiClient } from './client';
import { DeviceHistory, ZoneHistory } from '../types/api';

export type HistoryWindow = '1h' | '24h' | '7d' | '30d';

export const historyApi = {
  getDeviceHistory: (deviceId: string, window: HistoryWindow): Promise<DeviceHistory> =>
    apiClient.get(`/mobile/devices/${deviceId}/history?window=${window}`),

  getZoneHistory: (zoneRef: string, window: HistoryWindow): Promise<ZoneHistory> =>
    apiClient.get(`/mobile/zones/${zoneRef}/history?window=${window}`),
};
