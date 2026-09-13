const DEVICE_ID_PREFIX = 'zmartify-hvac-ahc9000-';

export function parseControllerIdentity(value: string): { deviceId: string; mac: string } | null {
  const normalized = value.trim().toLowerCase();
  const macHex = normalized.startsWith(DEVICE_ID_PREFIX)
    ? normalized.slice(DEVICE_ID_PREFIX.length)
    : normalized.replace(/[^0-9a-f]/g, '');
  if (!/^[0-9a-f]{12}$/.test(macHex)) return null;
  return {
    deviceId: `${DEVICE_ID_PREFIX}${macHex}`,
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