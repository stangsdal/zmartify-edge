import { apiClient } from './client';

export interface MobileSiteSummary {
  site_id: string;
  site_slug: string;
  site_name: string;
  domain_id: string;
  domain_name: string;
  domain_slug: string;
  device_count: number;
}

export interface MobileSiteDevice {
  device_id: string;
  device_uuid?: string;
  display_name: string;
  firmware_version?: string;
  online: boolean;
  mqtt_connected?: boolean;
  updated_at?: string;
}

export interface MobileSiteDetail {
  site_id: string;
  site_name: string;
  site_slug: string;
  domain: {
    domain_id: string;
    domain_name: string;
  };
  devices: MobileSiteDevice[];
}

export interface MobileSiteZonesDetail {
  site_id: string;
  site_name: string;
  devices: Array<{
    device_id: string;
    display_name: string;
    zones: MobileZone[];
  }>;
}

export interface MobileZone {
  zone_uuid?: string;
  zone_id: number;
  name: string;
  mode?: number | null;
  thermostat_mode?: number | null;
  humidity?: number | null;
  window_open?: boolean | null;
  current_temperature_c?: number;
  target_temperature_c?: number;
  demand?: boolean;
  active?: boolean;
  online?: boolean;
  fault?: string | null;
  freshness_age_ms?: number | null;
  setpoint_command_state?: string;
  setpoint_pending?: boolean;
  setpoint_command_id?: string | null;
  setpoint_requested_target_c?: number | null;
  setpoint_failure_reason?: string | null;
  setpoint_command_age_ms?: number | null;
}

export interface MobileSetpointResponse {
  device_id: string;
  zone_id: number;
  target_temperature_c: number;
  pending: boolean;
  command_state: string;
  command_id?: string | null;
  zone: MobileZone;
}

export interface MobileDeviceDetail {
  device_id: string;
  display_name: string;
  firmware_version?: string;
  online: boolean;
  integration_mode?: string;
  site?: {
    site_id: string;
    site_name: string;
  } | null;
  zones: MobileZone[];
}

export interface MobileEvent {
  event_id: string;
  event_type: string;
  created_at: string;
  device_id?: string;
  zone_id?: number;
  payload?: Record<string, unknown>;
}

export interface MobileDeviceFreshness {
  device_id: string;
  device: {
    online?: boolean | null;
    mqtt_connected?: boolean | null;
    updated_at?: string | null;
    source_timestamp?: string | null;
    freshness_age_ms?: number | null;
  };
  zones: Array<{
    zone_id: number;
    updated_at?: string | null;
    source_timestamp?: string | null;
    freshness_age_ms?: number | null;
  }>;
  channels: Array<{
    channel_id: number;
    updated_at?: string | null;
    source_timestamp?: string | null;
    freshness_age_ms?: number | null;
  }>;
}

export const mobileApi = {
  listSites: (): Promise<{ sites: MobileSiteSummary[] }> => apiClient.get('/mobile/sites'),

  getSite: (siteId: string): Promise<MobileSiteDetail> => apiClient.get(`/mobile/sites/${siteId}`),

  getSiteZones: (siteId: string): Promise<MobileSiteZonesDetail> =>
    apiClient.get(`/mobile/sites/${siteId}/zones`),

  getDevice: (deviceId: string): Promise<MobileDeviceDetail> => apiClient.get(`/mobile/devices/${deviceId}`),

  getDeviceFreshness: (deviceId: string): Promise<MobileDeviceFreshness> =>
    apiClient.get(`/mobile/devices/${deviceId}/freshness`),

  listEvents: (limit = 25): Promise<{ events: MobileEvent[] }> => apiClient.get(`/mobile/events?limit=${limit}`),

  setZoneSetpoint: (zoneRef: string, targetTemperatureC: number): Promise<MobileSetpointResponse> =>
    apiClient.post(`/mobile/zones/${zoneRef}/setpoint`, {
      target_temperature_c: targetTemperatureC,
    }),

  renameDeviceZone: (deviceId: string, zoneId: number, name: string): Promise<MobileZone> =>
    apiClient.post(`/devices/${deviceId}/zones/${zoneId}/rename`, { name }),

  renameZoneByRef: (zoneRef: string, name: string): Promise<MobileZone> =>
    apiClient.post(`/mobile/zones/${encodeURIComponent(zoneRef)}/rename`, { name }),
};
