import { apiClient } from './client';
import { DeviceHistory, ZoneHistory } from '../types/api';

export type HistoryWindow = '1h' | '24h' | '7d' | '30d';

export const historyApi = {
  getDeviceHistory: (deviceId: string, window: HistoryWindow, offsetMs = 0): Promise<DeviceHistory> =>
    apiClient.get(`/mobile/devices/${deviceId}/history?window=${window}&offset_ms=${offsetMs}`),

  getZoneHistory: (zoneRef: string, window: HistoryWindow, offsetMs = 0): Promise<ZoneHistory> =>
    apiClient.get(`/mobile/zones/${zoneRef}/history?window=${window}&offset_ms=${offsetMs}`),
};
