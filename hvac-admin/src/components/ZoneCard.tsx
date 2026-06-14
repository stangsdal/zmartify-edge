import { IonCard, IonCardContent, IonButton } from '@ionic/react';
import { ZoneData } from '../hooks/useDeviceZones';

interface ZoneCardProps {
  zone: ZoneData;
  onSetpointChange: (zoneId: string, temp: number) => void;
}

export function ZoneCard({ zone, onSetpointChange }: ZoneCardProps) {
  const currentTemp = zone.current_temperature_c || 0;
  const targetTemp = zone.target_temperature_c || 21;

  return (
    <IonCard>
      <IonCardContent>
        <h3>{zone.name}</h3>
        <p>Zone ID: {zone.zone_id}</p>
        <p>Current: {currentTemp.toFixed(1)}°C</p>
        <p>Target: {targetTemp.toFixed(1)}°C</p>
        {zone.humidity && <p>Humidity: {zone.humidity}%</p>}
        {zone.mode && <p>Mode: {zone.mode.toUpperCase()}</p>}

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <IonButton
            size="small"
            onClick={() => onSetpointChange(zone.zone_id, targetTemp - 0.5)}
          >
            -0.5°C
          </IonButton>
          <IonButton
            size="small"
            onClick={() => onSetpointChange(zone.zone_id, targetTemp + 0.5)}
          >
            +0.5°C
          </IonButton>
        </div>
      </IonCardContent>
    </IonCard>
  );
}
