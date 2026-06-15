import { useState, useEffect } from 'react';
import { deviceApi } from '../api/devices';
import { Zone } from '../types/api';
import { freshnessFromAgeMs, type FreshnessInfo } from '../utils/freshness';

export interface ZoneData {
  zone_id: string | number;
  name: string;
  target_temperature_c?: number;
  current_temperature_c?: number;
  mode?: 'heat' | 'cool' | 'auto' | 'off';
  humidity?: number;
  freshness_age_ms?: number | null;
}

export interface DeviceZoneState {
  device_id: string;
  online?: boolean;
  mqtt_connected?: boolean;
  freshness_age_ms?: number | null;
  freshness: FreshnessInfo;
  zones: ZoneData[];
  last_updated: string;
}

export function useDeviceZones(deviceId: string) {
  const [zoneState, setZoneState] = useState<DeviceZoneState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchZones = async () => {
    try {
      setLoading(true);
      const device = await deviceApi.get(deviceId);
      const freshness = await deviceApi.getFreshness(deviceId);
      const freshnessByZone = new Map<number, number | null>();
      for (const zone of freshness.zones || []) {
        freshnessByZone.set(zone.zone_id, zone.freshness_age_ms ?? null);
      }

      setZoneState({
        device_id: device.device_id,
        online: freshness.device.online ?? device.online,
        mqtt_connected: freshness.device.mqtt_connected ?? device.mqtt_connected,
        freshness_age_ms: freshness.device.freshness_age_ms ?? null,
        freshness: freshnessFromAgeMs(freshness.device.freshness_age_ms),
        zones: (device.zones || []).map((zone: Zone) => {
          const zoneKey = Number(zone.zone_id);
          return {
            ...zone,
            freshness_age_ms:
              freshnessByZone.get(zoneKey) ??
              (zone.freshness_age_ms === undefined ? null : zone.freshness_age_ms),
          };
        }),
        last_updated: new Date().toISOString(),
      });
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deviceId) {
      fetchZones();
    }
  }, [deviceId]);

  const updateZoneSetpoint = async (zoneId: string | number, temperature: number) => {
    // Phase 5: Placeholder for setpoint control API
    // Will be connected to actual endpoint in Phase 9 cloud abstraction
    setZoneState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        zones: prev.zones.map((zone) =>
          zone.zone_id === zoneId
            ? { ...zone, target_temperature_c: temperature }
            : zone
        ),
      };
    });
  };

  return {
    zoneState,
    loading,
    error,
    refetch: fetchZones,
    updateZoneSetpoint,
  };
}
