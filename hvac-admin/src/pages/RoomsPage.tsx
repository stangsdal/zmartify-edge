import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { RoomCard } from '../components/RoomCard';
import { mobileApi, MobileSiteSummary, MobileZone } from '../api/mobile';

interface RoomWithRef extends MobileZone {
  zone_ref: string;
}

export function RoomsPage() {
  const history = useHistory();
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [rooms, setRooms] = useState<RoomWithRef[]>([]);

  const parseRoomRef = (room: RoomWithRef): { deviceId: string | null; zoneId: number | null } => {
    const parts = room.zone_ref.split(':');
    const deviceId = parts.length >= 2 ? parts[0] : null;
    const zoneId = Number.isFinite(room.zone_id) ? room.zone_id : parts.length >= 2 ? Number.parseInt(parts[1], 10) : NaN;
    return {
      deviceId,
      zoneId: Number.isFinite(zoneId) ? zoneId : null,
    };
  };

  const handleRename = async (room: RoomWithRef) => {
    const nextName = window.prompt('New room name', room.name);
    if (!nextName) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === room.name) return;

    const parsed = parseRoomRef(room);
    if (!parsed.deviceId || parsed.zoneId == null) return;

    try {
      const renamed = await mobileApi.renameDeviceZone(parsed.deviceId, parsed.zoneId, trimmed);
      setRooms((prev) => prev.map((item) => (item.zone_ref === room.zone_ref ? { ...item, name: renamed.name } : item)));
    } catch (error) {
      window.alert(String(error));
    }
  };

  useEffect(() => {
    const loadSites = async () => {
      const res = await mobileApi.listSites();
      setSites(res.sites || []);
      if (res.sites?.length) setSelectedSite(res.sites[0].site_id);
    };
    loadSites().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedSite) return;
    const loadRooms = async () => {
      const site = await mobileApi.getSite(selectedSite);
      const devices = await Promise.all(site.devices.map((d) => mobileApi.getDevice(d.device_id)));
      const nextRooms: RoomWithRef[] = devices.flatMap((device) =>
        (device.zones || []).map((zone) => ({
          ...zone,
          zone_ref: zone.zone_uuid || `${device.device_id}:${zone.zone_id}`,
        }))
      );
      setRooms(nextRooms);
    };
    loadRooms().catch(console.error);
  }, [selectedSite]);

  const sortedRooms = useMemo(() => {
    return [...rooms].sort((a, b) => a.name.localeCompare(b.name));
  }, [rooms]);

  return (
    <IonPage>
      <AppHeader title="Rooms" subtitle="Room-centered comfort controls" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-8">
          <SiteSelector
            options={sites.map((s) => ({ site_id: s.site_id, site_name: s.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <div className="grid grid-cols-1 gap-3">
            {sortedRooms.map((room) => (
              <RoomCard
                key={room.zone_ref}
                zone={room}
                onOpen={() => history.push(`/app/rooms/${encodeURIComponent(room.zone_ref)}`)}
                onHistory={() => history.push(`/app/history?zoneRef=${encodeURIComponent(room.zone_ref)}`)}
                onRename={() => {
                  void handleRename(room);
                }}
              />
            ))}
            {!sortedRooms.length ? <p className="text-sm text-muted">No rooms found for this property.</p> : null}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
