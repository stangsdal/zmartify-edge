import { describe, expect, it } from 'vitest';
import { parseControllerIdentity, parseFactoryLabel } from '../utils/factoryLabel';

describe('factory onboarding label', () => {
  it('parses a valid factory QR URL', () => {
    expect(parseFactoryLabel(
      'https://app.zmartify.dk/app/onboarding/ble?device_id=zmartify-hvac-ahc9000-aabbccddeeff&pairing_code=F5G6-7RJD-Q6RM-6BCF',
    )).toEqual({
      deviceId: 'zmartify-hvac-ahc9000-aabbccddeeff',
      pairingCode: 'F5G6-7RJD-Q6RM-6BCF',
    });
  });

  it('rejects malformed pairing credentials', () => {
    expect(parseFactoryLabel(
      'https://app.zmartify.dk/app/onboarding/ble?device_id=zmartify-hvac-ahc9000-aabbccddeeff&pairing_code=123456',
    )).toBeNull();
  });

  it('normalizes a controller MAC address', () => {
    expect(parseControllerIdentity('AA:BB:CC:DD:EE:FF')).toEqual({
      deviceId: 'zmartify-hvac-ahc9000-aabbccddeeff',
      mac: 'AA:BB:CC:DD:EE:FF',
    });
  });
});