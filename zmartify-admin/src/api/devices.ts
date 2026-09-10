import { apiClient } from './client';
import {
  Device,
  DeviceClaimRequest,
  DeviceControllerModeSetResponse,
  DeviceControllerRebootResponse,
  DeviceControllerSettings,
  DeviceControllerSettingsUpdate,
  DeviceDiscovery,
  DeviceFreshness,
  DeviceBootstrapStage,
  DeviceBootstrapStageRequest,
  NilanCommand,
  NilanCommandResponse,
  NilanHvacState,
  DeviceSdCardStatus,
  DeviceOtaStage,
  DeviceOtaTrigger,
  DeviceOtaStatus,
} from '../types/api';

export const deviceApi = {
  list: () => apiClient.get('/devices'),
  
  get: (deviceId: string) => apiClient.get(`/mobile/devices/${deviceId}`),

  getFreshness: (deviceId: string): Promise<DeviceFreshness> =>
    apiClient.get(`/mobile/devices/${deviceId}/freshness`),

  stageBootstrap: (payload: DeviceBootstrapStageRequest): Promise<DeviceBootstrapStage> =>
    apiClient.post('/api/v2/devices/bootstrap/stage', payload),

  getNilanState: (deviceId: string): Promise<NilanHvacState> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/hvac/nilan`),

  setNilanCommand: (deviceId: string, command: NilanCommand, value: number): Promise<NilanCommandResponse> =>
    apiClient.post(`/api/v2/devices/${encodeURIComponent(deviceId)}/hvac/nilan/command`, { command, value }),
  
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

  pushConfig: (deviceId: string, payload: { claim_token?: string } = {}) =>
    apiClient.post(`/devices/${deviceId}/push-config`, payload),

  getOnboardingStatus: (deviceId: string) =>
    apiClient.get(`/devices/${deviceId}/onboarding-status`),

  getControllerSettings: (deviceId: string): Promise<DeviceControllerSettings> =>
    apiClient.get(`/api/v2/devices/${deviceId}/controller-settings`),

  updateControllerSettings: (deviceId: string, payload: DeviceControllerSettingsUpdate): Promise<DeviceControllerSettings> =>
    apiClient.put(`/api/v2/devices/${deviceId}/controller-settings`, payload),

  setControllerMode: (deviceId: string, mode: 'auto' | 'manual' | 'off' | 'service'): Promise<DeviceControllerModeSetResponse> =>
    apiClient.post(`/api/v2/devices/${deviceId}/controller/mode`, { mode }),

  rebootController: (deviceId: string): Promise<DeviceControllerRebootResponse> =>
    apiClient.post(`/api/v2/devices/${deviceId}/controller/reboot`, {}),

  getSdCardStatus: (deviceId: string): Promise<DeviceSdCardStatus> =>
    apiClient.get(`/api/v2/devices/${deviceId}/storage/sd-card`),

  initializeSdCard: (deviceId: string, format = true): Promise<DeviceSdCardStatus> =>
    apiClient.post(`/api/v2/devices/${deviceId}/storage/sd-card/initialize`, { format }),

  stageCatalogFirmware: (deviceId: string, catalogId: string, version: string, force = false): Promise<DeviceOtaStage> =>
    apiClient.post(`/api/v2/devices/${encodeURIComponent(deviceId)}/ota/stage-catalog`, {
      catalog_id: catalogId,
      version,
      force,
    }),

  triggerFirmwareOta: (deviceId: string): Promise<DeviceOtaTrigger> =>
    apiClient.post(`/api/v2/devices/${encodeURIComponent(deviceId)}/ota/trigger`, {}),

  getFirmwareOtaStatus: (deviceId: string): Promise<DeviceOtaStatus> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/ota/status`),
  
  assignToSite: (deviceId: string, siteId: number): Promise<Device> =>
    apiClient.post(`/devices/${deviceId}/site`, { site_id: siteId }),
  
  delete: (deviceId: string) => apiClient.delete(`/devices/${deviceId}`),
};
