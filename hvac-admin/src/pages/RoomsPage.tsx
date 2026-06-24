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

const ROOMS_CACHE_KEY_PREFIX = 'hvac_rooms_cache_v1:';
const ROOMS_LOAD_METRICS_KEY = 'hvac_rooms_load_metrics_v1';

interface RoomsLoadMetric {
  at: string;
  site_id: string;
  source: 'cache' | 'network';
  duration_ms: number;
  room_count: number;
  success: boolean;
  error?: string;
}

const readRoomsCache = (siteId: string): RoomWithRef[] => {
  try {
    const raw = localStorage.getItem(`${ROOMS_CACHE_KEY_PREFIX}${siteId}`);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is RoomWithRef => {
      return Boolean(item && typeof item.zone_ref === 'string' && typeof item.name === 'string');
    });
  } catch {
    return [];
  }
};

const writeRoomsCache = (siteId: string, rooms: RoomWithRef[]): void => {
  try {
    localStorage.setItem(`${ROOMS_CACHE_KEY_PREFIX}${siteId}`, JSON.stringify(rooms));
  } catch {
    // Ignore quota/cache errors.
  }
};

const recordRoomsLoadMetric = (metric: RoomsLoadMetric): void => {
  try {
    const raw = localStorage.getItem(ROOMS_LOAD_METRICS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const list: RoomsLoadMetric[] = Array.isArray(parsed) ? parsed : [];
    list.push(metric);
    localStorage.setItem(ROOMS_LOAD_METRICS_KEY, JSON.stringify(list.slice(-120)));
  } catch {
    // Ignore telemetry storage errors.
  }
};

export function RoomsPage() {
  const history = useHistory();
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [rooms, setRooms] = useState<RoomWithRef[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [setpointError, setSetpointError] = useState('');
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const roomsLoadSeqRef = useRef(0);

  const handleSetpointChange = async (room: RoomWithRef, delta: number) => {
    const current = room.target_temperature_c ?? 20;
    const next = Math.round((current + delta) * 2) / 2; // keep 0.5 steps
    if (!room.zone_ref) return;
    try {
      await mobileApi.setZoneSetpoint(room.zone_ref, next);
      setRooms((prev) =>
        prev.map((r) => (r.zone_ref === room.zone_ref ? { ...r, target_temperature_c: next } : r))
      );
      setSetpointError('');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error || 'Unknown error');
      setSetpointError(`Setpoint update failed: ${msg}`);
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
    let canceled = false;
    const loadSites = async () => {
      const res = await mobileApi.listSites();
      if (canceled) return;
      setSites(res.sites || []);
      if (res.sites?.length) {
        setSelectedSite(res.sites[0].site_id);
      } else {
        setSelectedSite('');
        setRooms([]);
      }
    };
    loadSites().catch((error) => {
      if (canceled) return;
      const msg = error instanceof Error ? error.message : String(error || 'Unknown error');
      setLoadError(`Failed to load sites: ${msg}`);
      setSites([]);
      setRooms([]);
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSite) return;
    let canceled = false;
    roomsLoadSeqRef.current += 1;
    const loadSeq = roomsLoadSeqRef.current;
    const loadStartedAt = performance.now();

    const cachedRooms = readRoomsCache(selectedSite);
    if (cachedRooms.length > 0) {
      setRooms(cachedRooms);
      recordRoomsLoadMetric({
        at: new Date().toISOString(),
        site_id: selectedSite,
        source: 'cache',
        duration_ms: Math.round(performance.now() - loadStartedAt),
        room_count: cachedRooms.length,
        success: true,
      });
    }

    const loadRooms = async () => {
      const networkStartedAt = performance.now();
      setLoadingRooms(true);
      setLoadError('');
      const siteZones = await mobileApi.getSiteZones(selectedSite);
      const nextRooms: RoomWithRef[] = (siteZones.devices || []).flatMap((device) =>
        (device.zones || []).map((zone) => ({
          ...zone,
          zone_ref: zone.zone_uuid || `${device.device_id}:${zone.zone_id}`,
        }))
      );

      if (canceled || loadSeq !== roomsLoadSeqRef.current) return;
      setRooms(nextRooms);
      writeRoomsCache(selectedSite, nextRooms);
      recordRoomsLoadMetric({
        at: new Date().toISOString(),
        site_id: selectedSite,
        source: 'network',
        duration_ms: Math.round(performance.now() - networkStartedAt),
        room_count: nextRooms.length,
        success: true,
      });
      setLoadingRooms(false);
    };
    loadRooms().catch((error) => {
      if (canceled || loadSeq !== roomsLoadSeqRef.current) return;
      const msg = error instanceof Error ? error.message : String(error || 'Unknown error');
      recordRoomsLoadMetric({
        at: new Date().toISOString(),
        site_id: selectedSite,
        source: 'network',
        duration_ms: Math.round(performance.now() - loadStartedAt),
        room_count: 0,
        success: false,
        error: msg,
      });
      setLoadError(`Failed to load rooms: ${msg}`);
      setRooms([]);
      setLoadingRooms(false);
    });

    return () => {
      canceled = true;
    };
  }, [selectedSite]);

  useEffect(() => {
    const activeZoneRefs = new Set(rooms.map((room) => room.zone_ref));

    // Open missing subscriptions.
    activeZoneRefs.forEach((zoneRef) => {
      if (!socketsRef.current.has(zoneRef)) {
        subscribeToZoneUpdates(zoneRef);
      }
    });

    // Close subscriptions for rooms no longer visible.
    socketsRef.current.forEach((socket, zoneRef) => {
      if (!activeZoneRefs.has(zoneRef)) {
        socket?.close();
        socketsRef.current.delete(zoneRef);
      }
    });
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

          {setpointError ? (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {setpointError}
            </div>
          ) : null}

          {loadError ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {loadError}
            </div>
          ) : null}

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
                onSetpointChange={(delta) => {
                  void handleSetpointChange(room, delta);
                }}
              />
            ))}
            {loadingRooms ? <p className="text-sm text-muted">Loading rooms...</p> : null}
            {!sortedRooms.length ? <p className="text-sm text-muted">No rooms found for this property.</p> : null}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
