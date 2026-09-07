import { useEffect, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonModal,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { mobileApi, MobileZone } from '../api/mobile';
import { HvacZoneMode, SETPOINT_MODE_BY_NAME } from '../utils/hvacMode';

interface AdvancedThermostatSettingsProps {
  zone: MobileZone | null;
  zoneRef: string | null;
  isOpen: boolean;
  onDismiss: () => void;
  onSaved: (zone: MobileZone) => void;
}

const profiles: Array<{ mode: HvacZoneMode; label: string }> = [
  { mode: 'MANUAL', label: 'Manual' },
  { mode: 'KOMFORT', label: 'Comfort' },
  { mode: 'ECO', label: 'Eco' },
  { mode: 'HOLIDAY', label: 'Holiday' },
  { mode: 'STANDBY', label: 'Standby' },
  { mode: 'PARTY', label: 'Party' },
];

const numberValue = (value: number | null | undefined): string => value == null ? '' : String(value);
const halfDegree = (value: number): number => Math.round(value * 2) / 2;

export function AdvancedThermostatSettings({ zone, zoneRef, isOpen, onDismiss, onSaved }: AdvancedThermostatSettingsProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!zone || !isOpen) return;
    const profileValues = Object.fromEntries(
      profiles.map(({ mode }) => [
        String(SETPOINT_MODE_BY_NAME[mode]),
        numberValue(zone.setpoint_profiles?.[String(SETPOINT_MODE_BY_NAME[mode])]),
      ]),
    );
    const nextValues = {
      ...profileValues,
      min_temperature_c: numberValue(zone.configuration?.min_temperature_c),
      max_temperature_c: numberValue(zone.configuration?.max_temperature_c),
      floor_min_temperature_c: numberValue(zone.configuration?.floor_min_temperature_c),
      floor_max_temperature_c: numberValue(zone.configuration?.floor_max_temperature_c),
      hysteresis_c: numberValue(zone.configuration?.hysteresis_c),
    };
    setValues(nextValues);
    setInitialValues(nextValues);
    setError('');
  }, [zone, isOpen]);

  const setValue = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!zone || !zoneRef) return;
    setSaving(true);
    setError('');
    try {
      const numeric = (key: string): number | undefined => {
        const raw = values[key]?.trim();
        if (!raw) return undefined;
        const parsed = halfDegree(Number(raw));
        if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number`);
        return parsed;
      };
      const configuration = Object.fromEntries(
        ['min_temperature_c', 'max_temperature_c', 'floor_min_temperature_c', 'floor_max_temperature_c', 'hysteresis_c']
          .filter((key) => values[key] !== initialValues[key])
          .map((key) => [key, numeric(key)])
          .filter(([, value]) => value !== undefined),
      ) as Record<string, number>;
      const setpoint_profiles = Object.fromEntries(
        profiles
          .map(({ mode }) => [String(SETPOINT_MODE_BY_NAME[mode]), numeric(String(SETPOINT_MODE_BY_NAME[mode]))])
          .filter(([, value]) => value !== undefined),
      ) as Record<string, number>;
      if (!Object.keys(configuration).length && !Object.keys(setpoint_profiles).length) {
        throw new Error('Enter at least one setting before saving.');
      }
      const result = await mobileApi.configureZone(zoneRef, { ...configuration, setpoint_profiles });
      onSaved(result.zone);
      onDismiss();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const hasFloorSensor = zone?.floor_temperature_c != null;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Advanced thermostat settings</IonTitle>
          <IonButtons slot="end"><IonButton onClick={onDismiss}>Close</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <p className="text-sm text-muted mb-4">Setpoint values are sent only for fields you fill in.</p>
        <h2 className="text-sm font-semibold mb-2">Mode setpoints</h2>
        {profiles.map(({ mode, label }) => (
          <IonItem key={mode} lines="full">
            <IonLabel>{label}</IonLabel>
            <IonInput
              slot="end"
              type="number"
              inputMode="decimal"
              min="5"
              max="35"
              step="0.5"
              value={values[String(SETPOINT_MODE_BY_NAME[mode])] || ''}
              placeholder="Not reported"
              onIonInput={(event) => setValue(String(SETPOINT_MODE_BY_NAME[mode]), String(event.detail.value ?? ''))}
            />
          </IonItem>
        ))}
        <h2 className="text-sm font-semibold mt-6 mb-2">Room limits</h2>
        {[['min_temperature_c', 'Minimum room temperature'], ['max_temperature_c', 'Maximum room temperature'], ['hysteresis_c', 'Heating hysteresis']].map(([key, label]) => (
          <IonItem key={key} lines="full">
            <IonLabel>{label}</IonLabel>
            <IonInput slot="end" type="number" inputMode="decimal" step="0.5" value={values[key] || ''} onIonInput={(event) => setValue(key, String(event.detail.value ?? ''))} />
          </IonItem>
        ))}
        {hasFloorSensor ? (
          <>
            <h2 className="text-sm font-semibold mt-6 mb-2">Floor limits</h2>
            {[['floor_min_temperature_c', 'Minimum floor temperature'], ['floor_max_temperature_c', 'Maximum floor temperature']].map(([key, label]) => (
              <IonItem key={key} lines="full">
                <IonLabel>{label}</IonLabel>
                <IonInput slot="end" type="number" inputMode="decimal" step="0.5" value={values[key] || ''} onIonInput={(event) => setValue(key, String(event.detail.value ?? ''))} />
              </IonItem>
            ))}
          </>
        ) : null}
        {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
        <IonButton expand="block" className="mt-6" onClick={() => { void save(); }} disabled={saving}>
          {saving ? 'Saving...' : 'Save thermostat settings'}
        </IonButton>
      </IonContent>
    </IonModal>
  );
}