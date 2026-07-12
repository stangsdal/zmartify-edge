import { apiClient } from './client';

export interface DeviceCommandResult {
  command_id?: string;
  status?: string;
  [key: string]: unknown;
}

const normalizeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export const commandsApi = {
  async startIrrigationZone(deviceId: string, zoneRef: string, durationSeconds: number): Promise<DeviceCommandResult> {
    const commandPayload = {
      command_type: 'irrigation.zone.start',
      target_ref: zoneRef,
      parameters: {
        duration_seconds: durationSeconds,
      },
    };

    try {
      return await apiClient.post(`/api/v2/devices/${encodeURIComponent(deviceId)}/commands`, commandPayload);
    } catch (firstError) {
      const first = normalizeError(firstError);
      try {
        return await apiClient.post(`/devices/${encodeURIComponent(deviceId)}/commands`, commandPayload);
      } catch (secondError) {
        const second = normalizeError(secondError);
        throw new Error(`No compatible command endpoint detected. Tried v2 and legacy path. Details: ${first} | ${second}`);
      }
    }
  },
};
