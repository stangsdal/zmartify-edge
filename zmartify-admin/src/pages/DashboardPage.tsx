import { useEffect, useState } from 'react';
import {
  IonContent,
  IonPage,
} from '@ionic/react';
import { systemApi } from '../api/system';
import { SystemStatus } from '../types/api';
import { AppHeader } from '../components/AppHeader';

export function DashboardPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(5000); // 5s
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStatus = async () => {
    try {
      const data = await systemApi.getStatus();
      setStatus(data);
      setLastRefresh(new Date());
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchStatus, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  return (
    <IonPage>
      <AppHeader title="Overview" subtitle="Edge health and platform capacity" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <div className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100 flex flex-wrap gap-2 items-center justify-between">
            <label className="text-sm text-muted">
              Refresh every:
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
                style={{ marginLeft: '8px', padding: '4px', borderRadius: '8px' }}
            >
              <option value={3000}>3s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1m</option>
            </select>
            </label>
            {lastRefresh ? <span className="text-xs text-muted">Last: {lastRefresh.toLocaleTimeString()}</span> : null}
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          {!status ? (
            <p className="text-sm text-muted">Loading overview...</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <section className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
                <p className="text-xs text-muted uppercase tracking-wide">Health</p>
                <p className="text-xl font-bold mt-1">{status.health}</p>
              </section>
              <section className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
                <p className="text-xs text-muted uppercase tracking-wide">Registry</p>
                <p className="text-xl font-bold mt-1">{status.registry_status}</p>
              </section>
              <section className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
                <p className="text-xs text-muted uppercase tracking-wide">ACL</p>
                <p className="text-xl font-bold mt-1">{status.acl_file_status}</p>
              </section>
              <section className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
                <p className="text-xs text-muted uppercase tracking-wide">Domains</p>
                <p className="text-xl font-bold mt-1">{status.domain_count}</p>
              </section>
              <section className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
                <p className="text-xs text-muted uppercase tracking-wide">Sites</p>
                <p className="text-xl font-bold mt-1">{status.site_count}</p>
              </section>
              <section className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
                <p className="text-xs text-muted uppercase tracking-wide">Devices</p>
                <p className="text-xl font-bold mt-1">{status.device_count}</p>
              </section>
              <section className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
                <p className="text-xs text-muted uppercase tracking-wide">MQTT clients</p>
                <p className="text-xl font-bold mt-1">{status.mqtt_client_count}</p>
              </section>
              <section className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
                <p className="text-xs text-muted uppercase tracking-wide">Last ACL generation</p>
                <p className="text-sm font-semibold mt-1">{status.last_acl_generation || 'n/a'}</p>
              </section>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
