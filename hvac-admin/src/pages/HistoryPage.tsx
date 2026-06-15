import { useEffect, useState } from 'react';
import { IonContent, IonItem, IonLabel, IonPage, IonSelect, IonSelectOption } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { HistoryChart } from '../components/HistoryChart';
import { mobileApi, MobileSiteSummary, MobileZone } from '../api/mobile';
import { historyApi, HistoryWindow } from '../api/history';
import { DeviceHistory, ZoneHistory } from '../types/api';

export function HistoryPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [siteId, setSiteId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<Array<{ device_id: string; display_name: string }>>([]);
  const [zones, setZones] = useState<Array<MobileZone & { device_id: string; label: string }>>([]);
  const [zoneRef, setZoneRef] = useState('');
  const [window, setWindow] = useState<HistoryWindow>('24h');
  const [deviceHistory, setDeviceHistory] = useState<DeviceHistory | null>(null);
  const [zoneHistory, setZoneHistory] = useState<ZoneHistory | null>(null);

  useEffect(() => {
    const loadSites = async () => {
      const res = await mobileApi.listSites();
      setSites(res.sites || []);
      if (res.sites?.length) setSiteId(res.sites[0].site_id);
    };
    loadSites().catch(console.error);
  }, []);

  useEffect(() => {
    if (!siteId) return;
    const loadDevices = async () => {
      const site = await mobileApi.getSite(siteId);
      setDevices(site.devices.map((d) => ({ device_id: d.device_id, display_name: d.display_name })));
      if (site.devices.length) setDeviceId(site.devices[0].device_id);
      else {
        setDeviceId('');
        setZones([]);
        setZoneRef('');
      }
    };
    loadDevices().catch(console.error);
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
        const preferred = nextZones.find((z) => z.zone_uuid) || nextZones[0];
        setZoneRef(preferred.zone_uuid || `${deviceId}:${preferred.zone_id}`);
      } else {
        setZoneRef('');
      }
    };
    loadZones().catch(console.error);
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    const loadHistory = async () => {
      const devHist = await historyApi.getDeviceHistory(deviceId, window);
      setDeviceHistory(devHist);
      if (!zoneRef) {
        setZoneHistory(null);
        return;
      }
      setZoneHistory(await historyApi.getZoneHistory(zoneRef, window));
    };
    loadHistory().catch(console.error);
  }, [deviceId, window, zoneRef]);

  const selectedZone = zones.find((zone) => (zone.zone_uuid || `${zone.device_id}:${zone.zone_id}`) === zoneRef) || null;

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
            <IonSelect value={window} onIonChange={(e) => setWindow(e.detail.value as HistoryWindow)} interface="popover">
              <IonSelectOption value="1h">1 Hour</IonSelectOption>
              <IonSelectOption value="24h">24 Hours</IonSelectOption>
              <IonSelectOption value="7d">7 Days</IonSelectOption>
              <IonSelectOption value="30d">30 Days</IonSelectOption>
            </IonSelect>
          </IonItem>

          <HistoryChart title="Device Online" points={deviceHistory?.online || []} color="#301E96" />
          <HistoryChart title="Device MQTT Connectivity" points={deviceHistory?.mqtt_connected || []} color="#67FBFF" />
          <HistoryChart title={`Room Temperature${selectedZone ? ` - ${selectedZone.label}` : ''}`} points={zoneHistory?.temperature_current || []} color="#7D85FF" />
          <HistoryChart title={`Setpoint${selectedZone ? ` - ${selectedZone.label}` : ''}`} points={zoneHistory?.setpoint || []} color="#301E96" />
          <HistoryChart title={`Heating Demand${selectedZone ? ` - ${selectedZone.label}` : ''}`} points={zoneHistory?.demand || []} color="#67FBFF" />
        </div>
      </IonContent>
    </IonPage>
  );
}
