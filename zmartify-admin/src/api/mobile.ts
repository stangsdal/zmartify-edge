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
  device_type?: string;
  integration_mode?: string;
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

export interface MobileZoneByRefResponse {
  device_id: string;
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

export interface RealtimeTopicEvent {
  type: 'event';
  topic: string;
  event_type: string;
  payload: Record<string, unknown>;
}

const toRealtimeWsBase = (): string => {
  const rawBase = (localStorage.getItem('api_base_url') || window.location.origin || '').trim();
  if (!rawBase) return '';
  if (rawBase.startsWith('https://')) return rawBase.replace('https://', 'wss://');
  if (rawBase.startsWith('http://')) return rawBase.replace('http://', 'ws://');
  return window.location.protocol === 'https:' ? `wss://${rawBase}` : `ws://${rawBase}`;
};

export const subscribeRealtimeTopics = (
  topics: string[],
  onEvent: (event: RealtimeTopicEvent) => void,
): (() => void) => {
  const token = apiClient.getAuthToken();
  const wsBase = toRealtimeWsBase();
  const uniqueTopics = Array.from(new Set(topics.filter((topic) => topic && topic.trim().length > 0)));
  if (!token || !wsBase || uniqueTopics.length === 0) {
    return () => undefined;
  }

  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let stopped = false;

  const connect = () => {
    socket = new WebSocket(`${wsBase}/api/v2/ws?token=${encodeURIComponent(token)}`);

    socket.onopen = () => {
      socket?.send(
        JSON.stringify({
          type: 'subscribe',
          topics: uniqueTopics,
        }),
      );
    };

    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data);
        if (payload?.type !== 'event') return;
        onEvent(payload as RealtimeTopicEvent);
      } catch {
        // Ignore malformed messages.
      }
    };

    socket.onclose = () => {
      if (stopped) return;
      reconnectTimer = window.setTimeout(connect, 2000);
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
    }
    socket?.close();
  };
};

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

export interface IrrigationDeviceOverview {
  device_id: string;
  display_name: string;
  device_type?: string | null;
  integration_mode?: string | null;
  online: boolean;
  mqtt_connected: boolean;
  outputs: {
    total: number;
    active: number;
    faulted: number;
  };
  hydraulics?: {
    flow_lpm?: number | null;
    pressure_bar?: number | null;
    water_liters?: number | null;
    source_timestamp?: string | null;
    updated_at?: string | null;
  } | null;
  power?: {
    voltage_rms_v?: number | null;
    current_rms_a?: number | null;
    real_power_w?: number | null;
    power_factor?: number | null;
    source_timestamp?: string | null;
    updated_at?: string | null;
  } | null;
  weather?: {
    temperature_c?: number | null;
    rain_mm?: number | null;
    wind_mps?: number | null;
    eto_mm?: number | null;
    source_timestamp?: string | null;
    updated_at?: string | null;
  } | null;
  rain_delay?: {
    rain_delay_id?: string;
    active_until?: string;
    reason?: string | null;
    created_at?: string;
  } | null;
}

export interface IrrigationZone {
  zone_id: string;
  local_ref: string;
  name: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface IrrigationOutput {
  output_id: string;
  local_ref: string;
  name: string;
  enabled: boolean;
  active: boolean;
  fault?: string | null;
  is_master_valve: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface IrrigationZoneUpsertPayload {
  local_ref: string;
  name: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface IrrigationOutputUpsertPayload {
  local_ref: string;
  name: string;
  enabled?: boolean;
  active?: boolean;
  fault?: string | null;
  is_master_valve?: boolean;
  metadata?: Record<string, unknown>;
}

export interface IrrigationHydraulicsState {
  device_id: string;
  flow_lpm?: number | null;
  pressure_bar?: number | null;
  water_liters?: number | null;
  source_timestamp?: string | null;
  updated_at?: string | null;
}

export interface IrrigationPowerState {
  device_id: string;
  voltage_rms_v?: number | null;
  current_rms_a?: number | null;
  real_power_w?: number | null;
  power_factor?: number | null;
  source_timestamp?: string | null;
  updated_at?: string | null;
}

export interface IrrigationWeatherState {
  device_id: string;
  temperature_c?: number | null;
  rain_mm?: number | null;
  wind_mps?: number | null;
  eto_mm?: number | null;
  source_timestamp?: string | null;
  updated_at?: string | null;
}

export interface IrrigationSiteOverview {
  site_id: string;
  site_name: string;
  device_count: number;
  zone_count: number;
  program_count: number;
  active_run_count: number;
  devices: IrrigationDeviceOverview[];
}

export interface IrrigationProgramSummary {
  program_id: string;
  name: string;
  enabled: boolean;
  seasonal_adjustment: number;
  weather_mode: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface IrrigationScheduleSummary {
  schedule_id: string;
  name: string;
  start_local_time: string;
  weekdays: number[];
  recurrence_type?: string;
  interval_days?: number | null;
  anchor_date?: string | null;
  dates?: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface IrrigationProgramZoneSummary {
  program_zone_id: string;
  zone_id: string;
  local_ref: string;
  zone_name: string;
  zone_enabled: boolean;
  sort_order: number;
  duration_seconds: number;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface IrrigationRunStepSummary {
  step_id: string;
  local_ref?: string | null;
  zone_name?: string | null;
  duration_seconds: number;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface IrrigationRunSummary {
  run_id: string;
  program_id?: string | null;
  trigger_type: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  total_runtime_seconds?: number | null;
  created_at: string;
  updated_at: string;
  steps: IrrigationRunStepSummary[];
}

export const mobileApi = {
  listSites: (): Promise<{ sites: MobileSiteSummary[] }> => apiClient.get('/mobile/sites'),

  getSite: (siteId: string): Promise<MobileSiteDetail> => apiClient.get(`/mobile/sites/${siteId}`),

  getSiteZones: (siteId: string): Promise<MobileSiteZonesDetail> =>
    apiClient.get(`/mobile/sites/${siteId}/zones`),

  getDevice: (deviceId: string): Promise<MobileDeviceDetail> => apiClient.get(`/mobile/devices/${deviceId}`),

  getDeviceFreshness: (deviceId: string): Promise<MobileDeviceFreshness> =>
    apiClient.get(`/mobile/devices/${deviceId}/freshness`),

  getZoneByRef: (zoneRef: string): Promise<MobileZoneByRefResponse> =>
    apiClient.get(`/mobile/zones/${encodeURIComponent(zoneRef)}`),

  listEvents: (limit = 25, options?: { eventType?: string; siteId?: string }): Promise<{ events: MobileEvent[] }> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (options?.eventType) params.set('event_type', options.eventType);
    if (options?.siteId) params.set('site_id', options.siteId);
    return apiClient.get(`/mobile/events?${params.toString()}`);
  },

  getIrrigationOverview: (siteId: string): Promise<IrrigationSiteOverview> =>
    apiClient.get(`/api/v2/sites/${encodeURIComponent(siteId)}/irrigation/overview`),

  listIrrigationZones: (deviceId: string): Promise<{ device_id: string; zones: IrrigationZone[] }> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/zones`),

  upsertIrrigationZone: (
    deviceId: string,
    payload: IrrigationZoneUpsertPayload,
  ): Promise<{ device_id: string; zone: IrrigationZone }> =>
    apiClient.put(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/zones`, payload),

  listIrrigationOutputs: (deviceId: string): Promise<{ device_id: string; outputs: IrrigationOutput[] }> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/outputs`),

  upsertIrrigationOutput: (
    deviceId: string,
    payload: IrrigationOutputUpsertPayload,
  ): Promise<{ device_id: string; output: IrrigationOutput }> =>
    apiClient.put(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/outputs`, payload),

  getIrrigationHydraulics: (deviceId: string): Promise<IrrigationHydraulicsState> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/hydraulics`),

  getIrrigationPower: (deviceId: string): Promise<IrrigationPowerState> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/power`),

  getIrrigationWeather: (deviceId: string): Promise<IrrigationWeatherState> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/weather`),

  setZoneSetpoint: (zoneRef: string, targetTemperatureC: number): Promise<MobileSetpointResponse> =>
    apiClient.post(`/mobile/zones/${zoneRef}/setpoint`, {
      target_temperature_c: targetTemperatureC,
    }),

  renameDeviceZone: (deviceId: string, zoneId: number, name: string): Promise<MobileZone> =>
    apiClient.post(`/devices/${deviceId}/zones/${zoneId}/rename`, { name }),

  renameZoneByRef: (zoneRef: string, name: string): Promise<MobileZone> =>
    apiClient.post(`/mobile/zones/${encodeURIComponent(zoneRef)}/rename`, { name }),

  listIrrigationPrograms: (deviceId: string): Promise<{ device_id: string; programs: IrrigationProgramSummary[] }> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/programs`),

  listIrrigationRuns: (deviceId: string, limit = 20): Promise<{ device_id: string; runs: IrrigationRunSummary[] }> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/runs?limit=${encodeURIComponent(String(limit))}`),

  listIrrigationProgramSchedules: (
    deviceId: string,
    programId: string,
  ): Promise<{ device_id: string; program_id: string; schedules: IrrigationScheduleSummary[] }> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/programs/${encodeURIComponent(programId)}/schedules`),

  listIrrigationProgramZones: (
    deviceId: string,
    programId: string,
  ): Promise<{ device_id: string; program_id: string; zones: IrrigationProgramZoneSummary[] }> =>
    apiClient.get(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/programs/${encodeURIComponent(programId)}/zones`),

  replaceIrrigationProgramZones: (
    deviceId: string,
    programId: string,
    payload: { zones: Array<{ zone_id?: string; local_ref?: string; duration_seconds: number; sort_order: number; enabled: boolean }> },
  ): Promise<{ device_id: string; program_id: string; zones: IrrigationProgramZoneSummary[] }> =>
    apiClient.put(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/programs/${encodeURIComponent(programId)}/zones`, payload),

  createIrrigationProgram: (
    deviceId: string,
    payload: { name: string; enabled?: boolean; seasonal_adjustment?: number; weather_mode?: string },
  ): Promise<{ device_id: string; program: IrrigationProgramSummary }> =>
    apiClient.post(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/programs`, payload),

  updateIrrigationProgram: (
    deviceId: string,
    programId: string,
    payload: { name: string; enabled: boolean; seasonal_adjustment: number; weather_mode: string },
  ): Promise<{ device_id: string; program: IrrigationProgramSummary }> =>
    apiClient.put(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/programs/${encodeURIComponent(programId)}`, payload),

  createIrrigationProgramSchedule: (
    deviceId: string,
    programId: string,
    payload: {
      name: string;
      start_local_time: string;
      weekdays: number[];
      recurrence_type?: string;
      interval_days?: number | null;
      anchor_date?: string | null;
      dates?: string[];
      enabled?: boolean;
    },
  ): Promise<{ device_id: string; program_id: string; schedule: IrrigationScheduleSummary }> =>
    apiClient.post(
      `/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/programs/${encodeURIComponent(programId)}/schedules`,
      payload,
    ),

  updateIrrigationProgramSchedule: (
    deviceId: string,
    programId: string,
    scheduleId: string,
    payload: {
      name: string;
      start_local_time: string;
      weekdays: number[];
      recurrence_type?: string;
      interval_days?: number | null;
      anchor_date?: string | null;
      dates?: string[];
      enabled?: boolean;
    },
  ): Promise<{ device_id: string; program_id: string; schedule: IrrigationScheduleSummary }> =>
    apiClient.put(
      `/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/programs/${encodeURIComponent(programId)}/schedules/${encodeURIComponent(scheduleId)}`,
      payload,
    ),

  deleteIrrigationProgramSchedule: (
    deviceId: string,
    programId: string,
    scheduleId: string,
  ): Promise<{ deleted: boolean }> =>
    apiClient.delete(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/programs/${encodeURIComponent(programId)}/schedules/${encodeURIComponent(scheduleId)}`),

  startIrrigationProgramRun: (
    deviceId: string,
    programId: string,
    triggerType = 'manual',
  ): Promise<{ device_id: string; program_id: string; run: IrrigationRunSummary; command?: Record<string, unknown> | null }> =>
    apiClient.post(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/programs/${encodeURIComponent(programId)}/run`, {
      trigger_type: triggerType,
    }),

  stopIrrigationProgramRun: (
    deviceId: string,
    runId: string,
  ): Promise<{ device_id: string; run: IrrigationRunSummary; stopped_step?: IrrigationRunStepSummary | null; command?: Record<string, unknown> | null }> =>
    apiClient.post(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/runs/${encodeURIComponent(runId)}/stop`, {}),

  skipIrrigationProgramRunStep: (
    deviceId: string,
    runId: string,
  ): Promise<{
    device_id: string;
    run: IrrigationRunSummary;
    skipped_step?: IrrigationRunStepSummary | null;
    next_step?: IrrigationRunStepSummary | null;
    stop_command?: Record<string, unknown> | null;
    start_command?: Record<string, unknown> | null;
  }> =>
    apiClient.post(`/api/v2/devices/${encodeURIComponent(deviceId)}/irrigation/runs/${encodeURIComponent(runId)}/skip`, {}),
};
