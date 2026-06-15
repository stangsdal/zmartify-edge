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

export interface MobileZone {
  zone_uuid?: string;
  zone_id: number;
  name: string;
  current_temperature_c?: number;
  target_temperature_c?: number;
  demand?: boolean;
  online?: boolean;
  fault?: string | null;
  freshness_age_ms?: number | null;
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

export const mobileApi = {
  listSites: (): Promise<{ sites: MobileSiteSummary[] }> => apiClient.get('/mobile/sites'),

  getSite: (siteId: string): Promise<MobileSiteDetail> => apiClient.get(`/mobile/sites/${siteId}`),

  getDevice: (deviceId: string): Promise<MobileDeviceDetail> => apiClient.get(`/mobile/devices/${deviceId}`),

  listEvents: (limit = 25): Promise<{ events: MobileEvent[] }> => apiClient.get(`/mobile/events?limit=${limit}`),

  setZoneSetpoint: (zoneRef: string, targetTemperatureC: number): Promise<any> =>
    apiClient.post(`/mobile/zones/${zoneRef}/setpoint`, {
      target_temperature_c: targetTemperatureC,
    }),
};
