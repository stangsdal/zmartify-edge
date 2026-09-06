import { useEffect, useMemo, useState, useRef } from 'react';
import { IonContent, IonPage, useIonViewWillLeave } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { RoomCard } from '../components/RoomCard';
import { AdvancedThermostatSettings } from '../components/AdvancedThermostatSettings';
import { mobileApi, MobileSiteDevice, MobileZone } from '../api/mobile';
import { NilanControlPanel } from '../components/NilanControlPanel';
import { apiClient } from '../api/client';
import { useAccess } from '../auth/AccessContext';
import { HvacZoneMode, SETPOINT_MODE_BY_NAME } from '../utils/hvacMode';

interface RoomWithRef extends MobileZone {
  zone_ref: string;
}

const roomIdentity = (deviceId: string, zoneId: number) => `${deviceId}:${zoneId}`;

export function RoomsPage() {
  const { context, selectedSiteId, selectSite, can } = useAccess();
  const history = useHistory();
  const [rooms, setRooms] = useState<RoomWithRef[]>([]);
  const [siteDevices, setSiteDevices] = useState<MobileSiteDevice[]>([]);
  const [advancedRoom, setAdvancedRoom] = useState<RoomWithRef | null>(null);
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const socketPingTimersRef = useRef<Map<string, number>>(new Map());
  const socketReconnectTimersRef = useRef<Map<string, number>>(new Map());
  const setpointTimersRef = useRef<Map<string, number>>(new Map());
  const desiredSetpointsRef = useRef<Map<string, number>>(new Map());
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

  const handleSetpointChange = (room: RoomWithRef, target: number) => {
    const next = Math.max(5, Math.min(35, Math.round(target * 2) / 2));
    if (!room.zone_ref) return;
    desiredSetpointsRef.current.set(room.zone_ref, next);
    setRooms((prev) => prev.map((r) => (r.zone_ref === room.zone_ref ? { ...r, target_temperature_c: next } : r)));

    const previousTimer = setpointTimersRef.current.get(room.zone_ref);
    if (previousTimer !== undefined) {
      window.clearTimeout(previousTimer);
    }
    const timer = window.setTimeout(() => {
      const requestedTarget = desiredSetpointsRef.current.get(room.zone_ref);
      if (requestedTarget === undefined) return;
      void mobileApi.setZoneSetpoint(room.zone_ref, requestedTarget).catch((error) => {
        console.error('setpoint change failed', error);
      });
    }, 700);
    setpointTimersRef.current.set(room.zone_ref, timer);
  };

  const handleModeChange = async (room: RoomWithRef, mode: HvacZoneMode) => {
    if (!room.zone_ref) return;
    const target = room.target_temperature_c ?? 20;
    try {
      await mobileApi.setZoneSetpoint(room.zone_ref, target, SETPOINT_MODE_BY_NAME[mode]);
      setRooms((prev) => prev.map((r) => (r.zone_ref === room.zone_ref ? { ...r, setpoint_mode: SETPOINT_MODE_BY_NAME[mode] } : r)));
    } catch (error) {
      console.error('mode change failed', error);
    }
  };

  const handleRename = async (room: RoomWithRef) => {
    const zoneKey = room.zone_key || `zone-${room.zone_id}`;
    const nextName = window.prompt('Descriptive room name', room.name === zoneKey ? '' : room.name);
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

    socket.onopen = () => {
      const previousTimer = socketPingTimersRef.current.get(zoneRef);
      if (previousTimer !== undefined) window.clearInterval(previousTimer);
      const pingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      }, 15000);
      socketPingTimersRef.current.set(zoneRef, pingTimer);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'zone_update' && payload.zone) {
          const incomingZone = payload.zone as MobileZone;
          const desiredTarget = desiredSetpointsRef.current.get(zoneRef);
          const incomingTarget = incomingZone.target_temperature_c;
          const incomingRequestedTarget = incomingZone.setpoint_requested_target_c;
          const commandState = String(incomingZone.setpoint_command_state || '');
          const confirmsDesired = desiredTarget !== undefined && (
            (commandState === 'confirmed' && typeof incomingTarget === 'number' && Math.abs(incomingTarget - desiredTarget) < 0.01)
            || (incomingZone.setpoint_pending === true && typeof incomingRequestedTarget === 'number' && Math.abs(incomingRequestedTarget - desiredTarget) < 0.01)
          );
          const commandFailed = commandState.startsWith('failed');
          if (confirmsDesired || commandFailed) {
            desiredSetpointsRef.current.delete(zoneRef);
          }
          const nextZone = desiredTarget !== undefined && !confirmsDesired && !commandFailed
            ? { ...incomingZone, target_temperature_c: desiredTarget }
            : incomingZone;
          setRooms((prev) =>
            prev.map((room) =>
              room.zone_ref === zoneRef
                ? { ...room, ...nextZone }
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

    socket.onclose = () => {
      const pingTimer = socketPingTimersRef.current.get(zoneRef);
      if (pingTimer !== undefined) {
        window.clearInterval(pingTimer);
        socketPingTimersRef.current.delete(zoneRef);
      }
      if (socketsRef.current.get(zoneRef) !== socket) return;
      socketsRef.current.delete(zoneRef);
      if (socketReconnectTimersRef.current.has(zoneRef)) return;
      const reconnectTimer = window.setTimeout(() => {
        socketReconnectTimersRef.current.delete(zoneRef);
        if (!socketsRef.current.has(zoneRef)) subscribeToZoneUpdates(zoneRef);
      }, 2000);
      socketReconnectTimersRef.current.set(zoneRef, reconnectTimer);
    };

    socketsRef.current.set(zoneRef, socket);
  };

  useEffect(() => {
    if (!selectedSiteId) return;
    let cancelled = false;

    const loadRooms = async () => {
      const selectedSite = context?.sites.find((site) => site.id === selectedSiteId);
      if (!selectedSite) return;
      const [siteZones, siteDetail] = await Promise.all([
        mobileApi.getSiteZones(selectedSite.uuid),
        mobileApi.getSite(selectedSite.uuid),
      ]);
      const uniqueRooms = new Map<string, RoomWithRef>();
      for (const device of siteZones.devices || []) {
        for (const zone of device.zones || []) {
          const identity = roomIdentity(device.device_id, zone.zone_id);
          if (!uniqueRooms.has(identity)) {
            uniqueRooms.set(identity, { ...zone, zone_ref: identity });
          }
        }
      }
      const nextRooms = Array.from(uniqueRooms.values());

      if (cancelled) return;

      setSiteDevices(siteDetail.devices || []);
      setRooms((prev) => {
        if (nextRooms.length === 0 && prev.length > 0) {
          // Keep the last complete snapshot while the backend briefly returns no zones.
          emptyResponseStreakRef.current += 1;
          return prev;
        } else {
          emptyResponseStreakRef.current = 0;
        }
        if (!prev.length) return nextRooms;

        const nextRoomKeys = new Set(nextRooms.map((room) => room.zone_ref));
        const nextDeviceIds = new Set(nextRooms.map((room) => room.zone_ref.split(':')[0]));
        const temporarilyMissing = prev.filter((room) => (
          nextDeviceIds.has(room.zone_ref.split(':')[0]) && !nextRoomKeys.has(room.zone_ref)
        ));
        return [...nextRooms, ...temporarilyMissing];
      });
    };

    emptyResponseStreakRef.current = 0;
    setSiteDevices([]);
    loadRooms().catch(console.error);
    const refreshTimer = window.setInterval(() => {
      loadRooms().catch(console.error);
    }, 5000);

    return () => {
      cancelled = true;
      emptyResponseStreakRef.current = 0;
      window.clearInterval(refreshTimer);
    };
  }, [context, selectedSiteId]);

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
      setpointTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      setpointTimersRef.current.clear();
      desiredSetpointsRef.current.clear();
      socketsRef.current.forEach((socket) => socket?.close());
      socketsRef.current.clear();
      socketPingTimersRef.current.forEach((timer) => window.clearInterval(timer));
      socketPingTimersRef.current.clear();
      socketReconnectTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      socketReconnectTimersRef.current.clear();
    };
  }, []);

  const sortedRooms = useMemo(() => {
    return [...rooms].sort((a, b) => a.zone_id - b.zone_id);
  }, [rooms]);

  const avgTemp = useMemo(() => {
    const values = sortedRooms
      .map((room) => room.current_temperature_c)
      .filter((v): v is number => typeof v === 'number');
    if (!values.length) return null;
    return values.reduce((acc, value) => acc + value, 0) / values.length;
  }, [sortedRooms]);

  const activeRooms = useMemo(
    () => sortedRooms.filter((room) => room.demand === true).length,
    [sortedRooms]
  );

  const offlineRooms = useMemo(() => sortedRooms.filter((room) => room.online === false).length, [sortedRooms]);
  const canOperate = selectedSiteId != null && can(selectedSiteId, 'hvac', 'operate');
  const canConfigure = selectedSiteId != null && can(selectedSiteId, 'hvac', 'configure');
  const site = context?.sites.find((candidate) => candidate.id === selectedSiteId);
  const siteBase = site ? `/app/sites/${site.uuid || site.id}` : '/app/home';

  return (
    <IonPage>
      <AppHeader title="Control" subtitle="HVAC zone overview and quick actions" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Site"
            options={(context?.sites || [])
              .filter((site) => site.products.some((product) => product.type === 'hvac' && product.allowed))
              .map((site) => ({ site_id: String(site.id), site_name: site.name }))}
            value={selectedSiteId ? String(selectedSiteId) : ''}
            onChange={(siteId) => selectSite(Number(siteId))}
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

          <NilanControlPanel devices={siteDevices} canOperate={canOperate} />

          <div className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold">Zones</h2>
            <p className="text-sm text-muted mt-1">Tap a zone to inspect details, change setpoint and open trend history.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {sortedRooms.map((room) => (
              <RoomCard
                key={room.zone_ref}
                zone={room}
                onOpen={() => navigateWithBlur(`${siteBase}/hvac/zones/${encodeURIComponent(room.zone_ref)}`)}
                onHistory={() => navigateWithBlur(`${siteBase}/hvac/history?zoneRef=${encodeURIComponent(room.zone_ref)}`)}
                onRename={() => {
                  void handleRename(room);
                }}
                onAdvancedSettings={() => setAdvancedRoom(room)}
                onSetpointChange={(delta) => {
                  void handleSetpointChange(room, delta);
                }}
                onModeChange={(mode) => {
                  void handleModeChange(room, mode);
                }}
                canOperate={canOperate}
                canConfigure={canConfigure}
              />
            ))}
            {!sortedRooms.length ? <p className="text-sm text-muted">No rooms found for this property.</p> : null}
          </div>

          <AdvancedThermostatSettings
            zone={advancedRoom}
            zoneRef={advancedRoom?.zone_ref ?? null}
            isOpen={advancedRoom !== null}
            onDismiss={() => setAdvancedRoom(null)}
            onSaved={(updatedZone) => {
              setRooms((prev) => prev.map((room) => room.zone_ref === advancedRoom?.zone_ref ? { ...room, ...updatedZone } : room));
            }}
          />

        </div>
      </IonContent>
    </IonPage>
  );
}
