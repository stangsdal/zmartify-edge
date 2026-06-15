export interface Domain {
  id: number;
  slug: string;
  name: string;
}

export interface Site {
  id: number;
  domain_id: number;
  slug: string;
  name: string;
}

export interface Device {
  id?: number;
  device_id: string;
  display_name: string;
  mac?: string;
  firmware_version?: string;
  site_id?: number;
  local_url?: string;
  online?: boolean;
  mqtt_connected?: boolean;
  freshness_age_ms?: number | null;
  zones?: Zone[];
}

export interface DeviceDiscovery {
  base_url: string;
  identity: {
    device_id: string;
    mac: string;
    firmware_version: string;
    hardware: string;
    capabilities: string[];
  };
  claim: {
    device_id: string;
    claim_token: string;
    expires_in_s: number;
  };
  status: {
    state: string;
    device_id: string;
    edge_url?: string | null;
    mqtt_configured: boolean;
    mqtt_connected: boolean;
    last_error?: string | null;
  };
}

export interface DeviceClaimRequest {
  base_url: string;
  claim_token?: string;
  domain_id: number;
  site_id: number;
  display_name?: string;
}

export interface Zone {
  zone_id: string | number;
  name: string;
  target_temperature_c?: number;
  current_temperature_c?: number;
  freshness_age_ms?: number | null;
}

export interface DeviceFreshness {
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

export interface MqttClient {
  id: number;
  client_id: string;
  client_type: 'homey' | 'device' | 'admin' | 'service' | 'homeassistant';
  domain_id?: number;
  enabled: boolean;
  username: string;
  last_rotated?: string;
}

export interface SystemStatus {
  health: string;
  registry_status: string;
  acl_file_status: string;
  domain_count: number;
  site_count: number;
  device_count: number;
  mqtt_client_count: number;
  last_acl_generation?: string;
}

export interface AclPreview {
  client_id: string;
  rules: string[];
}

export interface LoginResponse {
  access_token: string;
  expires_at: string;
}

export interface SetupStatus {
  initialized: boolean;
}

export interface User {
  id: number;
  username: string;
  email?: string;
  display_name: string;
  enabled: number;
  created_at: string;
  updated_at?: string;
  last_login_at?: string;
  roles: string[];
}

export interface AuditLogEntry {
  id: number;
  user_id?: number;
  username?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  metadata?: string;
  created_at: string;
}
