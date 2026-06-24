import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonItem, IonLabel, IonPage, IonSelect, IonSelectOption, IonButton } from '@ionic/react';
import { useLocation } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { HistoryChart } from '../components/HistoryChart';
import { mobileApi, MobileSiteSummary, MobileZone } from '../api/mobile';
import { historyApi, HistoryWindow } from '../api/history';
import { DeviceHistory, ZoneHistory } from '../types/api';

export function HistoryPage() {
  const location = useLocation();
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [siteId, setSiteId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<Array<{ device_id: string; display_name: string }>>([]);
  const [zones, setZones] = useState<Array<MobileZone & { device_id: string; label: string }>>([]);
  const [zoneRef, setZoneRef] = useState('');
  const [window, setWindow] = useState<HistoryWindow>('24h');
  const [offsetMs, setOffsetMs] = useState(0);
  const [deviceHistory, setDeviceHistory] = useState<DeviceHistory | null>(null);
  const [zoneHistory, setZoneHistory] = useState<ZoneHistory | null>(null);
  const initialZoneRef = useMemo(() => new URLSearchParams(location.search).get('zoneRef') || '', [location.search]);

  useEffect(() => {
    setZoneRef(initialZoneRef);
  }, [initialZoneRef]);

  useEffect(() => {
    const loadSites = async () => {
      const res = await mobileApi.listSites();
      setSites(res.sites || []);
      if (!res.sites?.length) return;

      if (!initialZoneRef) {
        setSiteId(res.sites[0].site_id);
        return;
      }

      for (const site of res.sites) {
        try {
          const detail = await mobileApi.getSite(site.site_id);
          for (const device of detail.devices) {
            const deviceDetail = await mobileApi.getDevice(device.device_id);
            const matchingZone = (deviceDetail.zones || []).find((zone) => {
              const ref = zone.zone_uuid || `${device.device_id}:${zone.zone_id}`;
              return ref === initialZoneRef;
            });
            if (matchingZone) {
              setSiteId(site.site_id);
              setDeviceId(device.device_id);
              return;
            }
          }
        } catch (e) {
          console.error(e);
        }
      }

      setSiteId(res.sites[0].site_id);
    };
    loadSites().catch(console.error);
  }, [initialZoneRef]);

  useEffect(() => {
    if (!siteId) return;
    let canceled = false;
    const loadDevices = async () => {
      const site = await mobileApi.getSite(siteId);
      if (canceled) return;
      setDevices(site.devices.map((d) => ({ device_id: d.device_id, display_name: d.display_name })));
      if (site.devices.length) {
        if (!deviceId || !site.devices.some((device) => device.device_id === deviceId)) {
          setDeviceId(site.devices[0].device_id);
        }
      } else {
        setDeviceId('');
        setZones([]);
        setZoneRef('');
      }
    };
    loadDevices().catch(console.error);
    return () => {
      canceled = true;
    };
  }, [siteId]);

  useEffect(() => {
    if (!deviceId) return;
    const loadZones = async () => {
      const detail = await mobileApi.getDevice(deviceId);
      const nextZones = (detail.zones || []).map((zone) => ({
        ...zone,
        device_id: deviceId,
        label: zone.name || `Room ${zone.zone_id}`,
      }));
      setZones(nextZones);
      if (nextZones.length) {
        const preferred = initialZoneRef
          ? nextZones.find((zone) => (zone.zone_uuid || `${deviceId}:${zone.zone_id}`) === initialZoneRef) || nextZones[0]
          : nextZones[0];
        setZoneRef(preferred.zone_uuid || `${deviceId}:${preferred.zone_id}`);
      } else {
        setZoneRef('');
      }
    };
    loadZones().catch(console.error);
  }, [deviceId, initialZoneRef]);

  useEffect(() => {
    if (!deviceId) return;
    const loadHistory = async () => {
      const devHist = await historyApi.getDeviceHistory(deviceId, window, offsetMs);
      setDeviceHistory(devHist);
      if (!zoneRef) {
        setZoneHistory(null);
        return;
      }
      setZoneHistory(await historyApi.getZoneHistory(zoneRef, window, offsetMs));
    };
    loadHistory().catch(console.error);
  }, [deviceId, window, zoneRef, offsetMs]);

  const selectedZone = zones.find((zone) => (zone.zone_uuid || `${zone.device_id}:${zone.zone_id}`) === zoneRef) || null;

  const windowMsMap: Record<HistoryWindow, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };

  const timelineBounds = useMemo(() => {
    const windowMs = windowMsMap[window];
    const endMs = Date.now() - offsetMs;
    const startMs = endMs - windowMs;
    return { startMs, endMs };
  }, [window, offsetMs]);

  const rangeLabel = useMemo(() => {
    const fmt = (ms: number) => {
      const d = new Date(ms);
      const sameDay = new Date(timelineBounds.startMs).toDateString() === new Date(timelineBounds.endMs).toDateString();
      if (sameDay) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    return `${fmt(timelineBounds.startMs)} – ${fmt(timelineBounds.endMs)}`;
  }, [timelineBounds]);

  const isAtPresent = offsetMs === 0;
  const stepMs = windowMsMap[window];

  return (
    <IonPage>
      <AppHeader
        title="History"
        subtitle={selectedZone ? `Room: ${selectedZone.label}` : 'Temperature and system trends'}
      />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-8">
          <SiteSelector options={sites.map((s) => ({ site_id: s.site_id, site_name: s.site_name }))} value={siteId} onChange={setSiteId} />

          <IonItem className="rounded-2xl overflow-hidden app-surface shadow-soft">
            <IonLabel>Room Source Device</IonLabel>
            <IonSelect value={deviceId} onIonChange={(e) => setDeviceId(String(e.detail.value))} interface="popover">
              {devices.map((d) => (
                <IonSelectOption key={d.device_id} value={d.device_id}>{d.display_name}</IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>

          <IonItem className="rounded-2xl overflow-hidden app-surface shadow-soft">
            <IonLabel>Room</IonLabel>
            <IonSelect value={zoneRef} onIonChange={(e) => setZoneRef(String(e.detail.value))} interface="popover" disabled={!zones.length}>
              {zones.map((zone) => {
                const ref = zone.zone_uuid || `${zone.device_id}:${zone.zone_id}`;
                return (
                  <IonSelectOption key={ref} value={ref}>
                    {zone.label}
                  </IonSelectOption>
                );
              })}
            </IonSelect>
          </IonItem>

          <IonItem className="rounded-2xl overflow-hidden app-surface shadow-soft">
            <IonLabel>Window</IonLabel>
            <IonSelect value={window} onIonChange={(e) => { setWindow(e.detail.value as HistoryWindow); setOffsetMs(0); }} interface="popover">
              <IonSelectOption value="1h">1 Hour</IonSelectOption>
              <IonSelectOption value="24h">24 Hours</IonSelectOption>
              <IonSelectOption value="7d">7 Days</IonSelectOption>
              <IonSelectOption value="30d">30 Days</IonSelectOption>
            </IonSelect>
          </IonItem>

          <div className="flex items-center justify-between rounded-2xl app-surface shadow-soft border border-slate-100 px-4 py-2 gap-2">
            <IonButton fill="clear" size="small" onClick={() => setOffsetMs((prev) => prev + stepMs)}>
              ◀
            </IonButton>
            <span className="text-xs text-muted flex-1 text-center select-none">{rangeLabel}</span>
            <IonButton fill="clear" size="small" onClick={() => setOffsetMs((prev) => Math.max(0, prev - stepMs))} disabled={isAtPresent}>
              ▶
            </IonButton>
            {!isAtPresent && (
              <IonButton fill="outline" size="small" onClick={() => setOffsetMs(0)}>
                Now
              </IonButton>
            )}
          </div>

          <HistoryChart
            title={`Room Temperature${selectedZone ? ` - ${selectedZone.label}` : ''}`}
            points={zoneHistory?.temperature_current || []}
            color="#7D85FF"
            mode="line"
            smooth
            startMs={timelineBounds.startMs}
            endMs={timelineBounds.endMs}
          />
          <HistoryChart
            title={`Setpoint${selectedZone ? ` - ${selectedZone.label}` : ''}`}
            points={zoneHistory?.setpoint || []}
            color="#301E96"
            mode="step"
            startMs={timelineBounds.startMs}
            endMs={timelineBounds.endMs}
          />
          <HistoryChart
            title={`Heating Demand${selectedZone ? ` - ${selectedZone.label}` : ''}`}
            points={zoneHistory?.demand || []}
            color="#67FBFF"
            chartType="area"
            mode="step"
            binaryLabels={['Off', 'On']}
            startMs={timelineBounds.startMs}
            endMs={timelineBounds.endMs}
          />
          <HistoryChart
            title="Device Online"
            points={deviceHistory?.online || []}
            color="#301E96"
            mode="step"
            binaryLabels={['Offline', 'Online']}
            startMs={timelineBounds.startMs}
            endMs={timelineBounds.endMs}
          />
          <HistoryChart
            title="Device MQTT Connectivity"
            points={deviceHistory?.mqtt_connected || []}
            color="#67FBFF"
            mode="step"
            binaryLabels={['Offline', 'Online']}
            startMs={timelineBounds.startMs}
            endMs={timelineBounds.endMs}
          />
        </div>
      </IonContent>
    </IonPage>
  );
}
