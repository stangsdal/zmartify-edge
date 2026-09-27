const DEFAULT_DEVICE_ID_PREFIX = 'zmartify-hvac-ahc9000-';
const DEVICE_ID_PATTERN = /^(zmartify-[a-z0-9-]+-)([0-9a-f]{12})$/;
const STABLE_DEVICE_ID_PATTERN = /^zmartify-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ControllerProductType = 'hvac' | 'irrigation' | 'weather' | 'energy';

export function inferControllerProductType(deviceId: string): ControllerProductType {
  const normalized = deviceId.trim().toLowerCase();
  if (normalized.startsWith('zmartify-irrigation-')) return 'irrigation';
  if (normalized.startsWith('zmartify-weather-')) return 'weather';
  if (normalized.startsWith('zmartify-energy-')) return 'energy';
  return 'hvac';
}

export function parseControllerIdentity(value: string): { deviceId: string; mac: string } | null {
  const normalized = value.trim().toLowerCase();
  const deviceIdMatch = normalized.match(DEVICE_ID_PATTERN);
  if (!deviceIdMatch && STABLE_DEVICE_ID_PATTERN.test(normalized)) {
    return { deviceId: normalized, mac: '' };
  }
  const macHex = deviceIdMatch?.[2] || normalized.replace(/[^0-9a-f]/g, '');
  if (!/^[0-9a-f]{12}$/.test(macHex)) return null;
  return {
    deviceId: deviceIdMatch ? normalized : `${DEFAULT_DEVICE_ID_PREFIX}${macHex}`,
    mac: macHex.match(/.{2}/g)?.join(':').toUpperCase() || '',
  };
}

export function parseFactoryLabel(value: string): { deviceId: string; pairingCode: string } | null {
  try {
    const url = new URL(value, 'https://app.zmartify.dk');
    const deviceId = url.searchParams.get('device_id') || '';
    const pairingCode = (url.searchParams.get('pairing_code') || '').toUpperCase();
    return parseControllerIdentity(deviceId) && /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(pairingCode)
      ? { deviceId, pairingCode }
      : null;
  } catch {
    return null;
  }
}