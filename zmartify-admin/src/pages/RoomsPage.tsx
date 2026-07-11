import { useEffect, useMemo, useState, useRef } from 'react';
import { IonContent, IonPage, useIonViewWillLeave } from '@ionic/react';
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
  const emptyResponseStreakRef = useRef(0);

  const blurActiveElement = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  };

  const navigateWithBlur = (to: string) => {
    blurActiveElement();
    history.push(to);
  };

  useIonViewWillLeave(() => {
    blurActiveElement();
  });

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
    let cancelled = false;

    const loadRooms = async () => {
      const siteZones = await mobileApi.getSiteZones(selectedSite);
      const nextRooms: RoomWithRef[] = (siteZones.devices || []).flatMap((device) =>
        (device.zones || []).map((zone) => ({
          ...zone,
          zone_ref: zone.zone_uuid || `${device.device_id}:${zone.zone_id}`,
        }))
      );

      if (cancelled) return;

      setRooms((prev) => {
        if (nextRooms.length === 0 && prev.length > 0) {
          // Ignore a single empty response to avoid flicker when backend data briefly lags.
          emptyResponseStreakRef.current += 1;
          if (emptyResponseStreakRef.current < 2) {
            return prev;
          }
        } else {
          emptyResponseStreakRef.current = 0;
        }
        return nextRooms;
      });
    };

    emptyResponseStreakRef.current = 0;
    loadRooms().catch(console.error);

    const intervalId = window.setInterval(() => {
      loadRooms().catch(console.error);
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      emptyResponseStreakRef.current = 0;
    };
  }, [selectedSite]);

  useEffect(() => {
    const activeRefs = new Set(rooms.map((room) => room.zone_ref));

    // Subscribe new room streams.
    for (const room of rooms) {
      if (!socketsRef.current.has(room.zone_ref)) {
        subscribeToZoneUpdates(room.zone_ref);
      }
    }

    // Unsubscribe removed room streams.
    for (const [zoneRef, socket] of socketsRef.current.entries()) {
      if (!activeRefs.has(zoneRef)) {
        socket?.close();
        socketsRef.current.delete(zoneRef);
      }
    }
  }, [rooms]);

  useEffect(() => {
    return () => {
      socketsRef.current.forEach((socket) => socket?.close());
      socketsRef.current.clear();
    };
  }, []);

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
                onOpen={() => navigateWithBlur(`/app/rooms/${encodeURIComponent(room.zone_ref)}`)}
                onHistory={() => navigateWithBlur(`/app/history?zoneRef=${encodeURIComponent(room.zone_ref)}`)}
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
