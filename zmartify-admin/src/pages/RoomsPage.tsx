import { useEffect, useMemo, useState, useRef } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { RoomCard } from '../components/RoomCard';
import { mobileApi, MobileSiteSummary, MobileZone } from '../api/mobile';
import { apiClient } from '../api/client';

interface RoomWithRef extends MobileZone {
  zone_ref: string;
}

export function RoomsPage() {
  const history = useHistory();
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [rooms, setRooms] = useState<RoomWithRef[]>([]);
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());

  const handleSetpointChange = async (room: RoomWithRef, delta: number) => {
    const current = room.target_temperature_c ?? 20;
    const next = Math.round((current + delta) * 2) / 2; // keep 0.5 steps
    if (!room.zone_ref) return;
    try {
      await mobileApi.setZoneSetpoint(room.zone_ref, next);
      setRooms((prev) =>
        prev.map((r) => (r.zone_ref === room.zone_ref ? { ...r, target_temperature_c: next } : r))
      );
    } catch (error) {
      console.error('setpoint change failed', error);
    }
  };

  const handleRename = async (room: RoomWithRef) => {
    const nextName = window.prompt('New room name', room.name);
    if (!nextName) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === room.name) return;

    if (!room.zone_ref) return;

    try {
      const renamed = await mobileApi.renameZoneByRef(room.zone_ref, trimmed);
      setRooms((prev) => prev.map((item) => (item.zone_ref === room.zone_ref ? { ...item, name: renamed.name } : item)));
    } catch (error) {
      window.alert(String(error));
    }
  };

  const subscribeToZoneUpdates = (zoneRef: string) => {
    const token = apiClient.getAuthToken();
    if (!token) return;

    const rawBase = localStorage.getItem('api_base_url') || window.location.origin;
    const wsBase = rawBase.startsWith('https://')
      ? rawBase.replace('https://', 'wss://')
      : rawBase.replace('http://', 'ws://');

    const endpoint = `${wsBase}/mobile/ws/zones/${encodeURIComponent(zoneRef)}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(endpoint);

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'zone_update' && payload.zone) {
          setRooms((prev) =>
            prev.map((room) =>
              room.zone_ref === zoneRef
                ? { ...room, ...payload.zone }
                : room
            )
          );
        }
      } catch {
        // Ignore malformed messages
      }
    };

    socket.onerror = () => {
      socket?.close();
    };

    socketsRef.current.set(zoneRef, socket);
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

  useEffect(() => {
    // Subscribe to updates for each room
    rooms.forEach((room) => {
      if (!socketsRef.current.has(room.zone_ref)) {
        subscribeToZoneUpdates(room.zone_ref);
      }
    });

    // Cleanup sockets when component unmounts or rooms change
    return () => {
      socketsRef.current.forEach((socket) => socket?.close());
      socketsRef.current.clear();
    };
  }, [rooms]);

  const sortedRooms = useMemo(() => {
    return [...rooms].sort((a, b) => a.name.localeCompare(b.name));
  }, [rooms]);

  const avgTemp = useMemo(() => {
    const values = sortedRooms
      .map((room) => room.current_temperature_c)
      .filter((v): v is number => typeof v === 'number');
    if (!values.length) return null;
    return values.reduce((acc, value) => acc + value, 0) / values.length;
  }, [sortedRooms]);

  const activeRooms = useMemo(
    () => sortedRooms.filter((room) => room.demand === true || room.active === true).length,
    [sortedRooms]
  );

  const offlineRooms = useMemo(() => sortedRooms.filter((room) => room.online === false).length, [sortedRooms]);

  return (
    <IonPage>
      <AppHeader title="Control" subtitle="HVAC zone overview and quick actions" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Site"
            options={sites.map((s) => ({ site_id: s.site_id, site_name: s.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Average indoor</p>
              <p className="text-2xl font-bold mt-1">{avgTemp === null ? '--' : `${avgTemp.toFixed(1)}°C`}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Heating now</p>
              <p className="text-2xl font-bold mt-1">{activeRooms}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Offline zones</p>
              <p className="text-2xl font-bold mt-1">{offlineRooms}</p>
            </div>
          </section>

          <div className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold">Zones</h2>
            <p className="text-sm text-muted mt-1">Tap a zone to inspect details, change setpoint and open trend history.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {sortedRooms.map((room) => (
              <RoomCard
                key={room.zone_ref}
                zone={room}
                onOpen={() => history.push(`/app/rooms/${encodeURIComponent(room.zone_ref)}`)}
                onHistory={() => history.push(`/app/history?zoneRef=${encodeURIComponent(room.zone_ref)}`)}
                onRename={() => {
                  void handleRename(room);
                }}
                onSetpointChange={(delta) => {
                  void handleSetpointChange(room, delta);
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
