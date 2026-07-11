import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { deviceApi } from '../api/devices';
import { historyApi, type HistoryWindow } from '../api/history';
import { DeviceHistory, HistoryPoint, ZoneHistory } from '../types/api';

function TrendCard({ title, points, color }: { title: string; points: HistoryPoint[]; color: string }) {
  const width = 360;
  const height = 120;

  const polyline = useMemo(() => {
    if (!points.length) return '';
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(0.001, max - min);

    return points
      .map((point, index) => {
        const x = (index / Math.max(1, points.length - 1)) * width;
        const y = height - ((point.value - min) / span) * height;
        return `${x},${y}`;
      })
      .join(' ');
  }, [points]);

  return (
    <IonCard>
      <IonCardContent>
        <strong>{title}</strong>
        {!points.length ? (
          <p style={{ color: '#666' }}>No data in selected window.</p>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '120px', marginTop: '8px' }}>
            <polyline fill="none" stroke={color} strokeWidth="3" points={polyline} />
          </svg>
        )}
      </IonCardContent>
    </IonCard>
  );
}

export function DeviceHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const [window, setWindow] = useState<HistoryWindow>('24h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deviceHistory, setDeviceHistory] = useState<DeviceHistory | null>(null);
  const [zoneHistory, setZoneHistory] = useState<ZoneHistory | null>(null);
  const [zoneRef, setZoneRef] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const run = async () => {
      try {
        setLoading(true);
        const device = await deviceApi.get(id);
        const zones = device.zones || [];
        const selectedZoneRef = zones.length ? String(zones[0].zone_uuid || `${id}:${zones[0].zone_id}`) : null;
        setZoneRef(selectedZoneRef);

        const [dh, zh] = await Promise.all([
          historyApi.getDeviceHistory(id, window),
          selectedZoneRef ? historyApi.getZoneHistory(selectedZoneRef, window) : Promise.resolve(null),
        ]);

        setDeviceHistory(dh);
        setZoneHistory(zh);
        setError('');
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [id, window]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Device History</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonItem>
          <IonLabel>Window</IonLabel>
          <IonSelect value={window} onIonChange={(e) => setWindow(e.detail.value as HistoryWindow)} interface="popover">
            <IonSelectOption value="1h">1 Hour</IonSelectOption>
            <IonSelectOption value="24h">24 Hours</IonSelectOption>
            <IonSelectOption value="7d">7 Days</IonSelectOption>
            <IonSelectOption value="30d">30 Days</IonSelectOption>
          </IonSelect>
        </IonItem>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
            <IonSpinner name="crescent" />
            <span>Loading history...</span>
          </div>
        ) : null}

        {error ? (
          <IonCard>
            <IonCardContent style={{ color: 'red' }}>{error}</IonCardContent>
          </IonCard>
        ) : null}

        {!loading && deviceHistory ? (
          <>
            <TrendCard title="Device Online Ratio" points={deviceHistory.online} color="#0b69ff" />
            <TrendCard title="MQTT Connected Ratio" points={deviceHistory.mqtt_connected} color="#027a48" />
          </>
        ) : null}

        {!loading && zoneHistory ? (
          <>
            <TrendCard title="Zone Current Temperature" points={zoneHistory.temperature_current} color="#7a4f01" />
            <TrendCard title="Zone Target Temperature" points={zoneHistory.temperature_target} color="#a61e4d" />
            <TrendCard title="Zone Demand Ratio" points={zoneHistory.demand} color="#6b21a8" />
          </>
        ) : null}

        {!loading && !zoneRef ? (
          <IonCard>
            <IonCardContent>No zone available for history graphing.</IonCardContent>
          </IonCard>
        ) : null}
      </IonContent>
    </IonPage>
  );
}
