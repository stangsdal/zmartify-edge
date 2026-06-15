import { useEffect, useMemo, useRef, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ThermostatDial } from '../components/ThermostatDial';
import { apiClient } from '../api/client';
import { mobileApi, MobileZone } from '../api/mobile';

interface RouteParams {
  zoneRef: string;
}

export function RoomDetailPage() {
  const { zoneRef } = useParams<RouteParams>();
  const resolvedRef = decodeURIComponent(zoneRef);
  const [zone, setZone] = useState<MobileZone | null>(null);
  const [target, setTarget] = useState(21);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [streamState, setStreamState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const lastAppliedRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  const applyIncomingZoneState = (nextZone: MobileZone) => {
    setZone(nextZone);
    const nextTarget = nextZone.target_temperature_c ?? 21;
    if (!dirtyRef.current && !savingRef.current) {
      setTarget(nextTarget);
      lastAppliedRef.current = nextTarget;
    }
    setSaveError('');
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const sites = await mobileApi.listSites();
      for (const site of sites.sites || []) {
        const detail = await mobileApi.getSite(site.site_id);
        for (const device of detail.devices) {
          const dev = await mobileApi.getDevice(device.device_id);
          for (const z of dev.zones || []) {
            const zref = z.zone_uuid || `${device.device_id}:${z.zone_id}`;
            if (zref === resolvedRef) {
              if (cancelled) return;
              applyIncomingZoneState(z);
              return;
            }
          }
        }
      }
    };

    load().catch(console.error);
    const intervalId = window.setInterval(() => {
      load().catch(console.error);
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [resolvedRef]);

  useEffect(() => {
    const token = apiClient.getAuthToken();
    if (!token) return;

    const rawBase = localStorage.getItem('api_base_url') || window.location.origin;
    const wsBase = rawBase.startsWith('https://')
      ? rawBase.replace('https://', 'wss://')
      : rawBase.replace('http://', 'ws://');

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const connect = () => {
      const endpoint = `${wsBase}/mobile/ws/zones/${encodeURIComponent(resolvedRef)}?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(endpoint);
      setStreamState('connecting');

      socket.onopen = () => {
        setStreamState('connected');
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type !== 'zone_update' || !payload.zone) return;
          applyIncomingZoneState(payload.zone as MobileZone);
        } catch {
          // Ignore malformed websocket messages.
        }
      };

      socket.onclose = () => {
        if (stopped) return;
        setStreamState('reconnecting');
        reconnectTimer = window.setTimeout(connect, 2000);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [resolvedRef]);

  const statusText = useMemo(() => {
    if (!zone) return 'Loading room status...';
    if (!zone.online) return 'Offline';
    if (zone.fault) return `Fault: ${zone.fault}`;
    if (zone.demand) return 'Heating';
    return 'Comfortable';
  }, [zone]);

  useEffect(() => {
    if (!zone || !dirty) return;
    if (lastAppliedRef.current === target) {
      setDirty(false);
      return;
    }

    const timer = window.setTimeout(() => {
      const applyTarget = async () => {
        setSaving(true);
        setSaveError('');
        try {
          await mobileApi.setZoneSetpoint(resolvedRef, target);
          lastAppliedRef.current = target;
          setZone((prev) => (prev ? { ...prev, target_temperature_c: target } : prev));
          setDirty(false);
        } catch (e) {
          setSaveError(String(e));
        } finally {
          setSaving(false);
        }
      };

      void applyTarget();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [dirty, resolvedRef, target, zone]);

  const handleTargetChange = (nextTarget: number) => {
    setTarget(nextTarget);
    setDirty(true);
  };

  return (
    <IonPage>
      <AppHeader title={zone?.name || 'Room'} subtitle="Thermostat Control" />
      <IonContent className="ion-padding">
        <div className="space-y-5 pb-8">
          <section className="rounded-3xl app-surface shadow-soft p-5">
            <div className="mb-3 flex justify-end">
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  color: streamState === 'connected' ? '#067647' : '#b54708',
                  backgroundColor: streamState === 'connected' ? 'rgba(18,183,106,0.15)' : 'rgba(247,144,9,0.16)',
                }}
              >
                {streamState === 'connected' ? 'Live' : streamState === 'connecting' ? 'Connecting' : 'Reconnecting'}
              </span>
            </div>
            <ThermostatDial
              value={target}
              currentTemperature={zone?.current_temperature_c ?? null}
              roomName={zone?.name}
              statusLabel={statusText}
              heating={!!zone?.demand}
              onChange={handleTargetChange}
            />
            <p className="mt-3 text-center text-xs uppercase tracking-[0.22em] text-muted">
              {saving ? 'Applying automatically...' : dirty ? 'Will apply in a moment' : 'Setpoint saved'}
            </p>
            {saveError && <p className="text-center text-sm mt-2 text-rose-600">{saveError}</p>}
          </section>

          <section className="rounded-2xl app-surface shadow-soft p-4 space-y-2">
            <p className="text-sm text-muted">Status</p>
            <p className="text-base font-medium">{statusText}</p>
            <p className="text-sm text-muted">Last Update</p>
            <p className="text-base">{zone?.freshness_age_ms == null ? 'Unknown' : `${Math.floor(zone.freshness_age_ms / 1000)}s ago`}</p>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
