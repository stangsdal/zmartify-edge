import { useState, useEffect } from 'react';
import { deviceApi } from '../api/devices';

export interface ZoneData {
  zone_id: string;
  name: string;
  target_temperature_c?: number;
  current_temperature_c?: number;
  mode?: 'heat' | 'cool' | 'auto' | 'off';
  humidity?: number;
}

export interface DeviceZoneState {
  device_id: string;
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
      setZoneState({
        device_id: device.device_id,
        zones: device.zones || [],
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

  const updateZoneSetpoint = async (zoneId: string, temperature: number) => {
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
