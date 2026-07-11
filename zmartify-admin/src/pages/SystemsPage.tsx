import { useEffect, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { mobileApi, MobileSiteSummary } from '../api/mobile';
import { systemApi } from '../api/system';
import { parseApiError } from '../utils/apiError';

interface RegistryStatus {
  phase?: string;
  status?: string;
}

interface AclStatus {
  acl_file?: {
    exists?: boolean;
    size_bytes?: number;
    sha256?: string | null;
  };
  generation_logs?: Array<{
    id: number;
    success: boolean;
    message: string;
    generated_at: string;
  }>;
}

export function SystemsPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [registry, setRegistry] = useState<RegistryStatus | null>(null);
  const [acl, setAcl] = useState<AclStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [sitesData, healthData, registryData, aclData] = await Promise.all([
          mobileApi.listSites(),
          systemApi.getStatus(),
          systemApi.getRegistryStatus(),
          systemApi.getAclStatus(),
        ]);
        setSites(sitesData.sites || []);
        setHealth(healthData || null);
        setRegistry((registryData || null) as RegistryStatus | null);
        setAcl((aclData || null) as AclStatus | null);
        setError('');
      } catch (e) {
        setError(parseApiError(e));
      } finally {
        setLoading(false);
      }
    };

    load().catch(console.error);
  }, []);

  const totalDevices = sites.reduce((acc, site) => acc + (site.device_count || 0), 0);
  const aclFileExists = Boolean(acl?.acl_file?.exists);
  const aclSizeKb = acl?.acl_file?.size_bytes ? (acl.acl_file.size_bytes / 1024).toFixed(1) : '0.0';
  const latestAclLog = acl?.generation_logs?.[0] || null;

  return (
    <IonPage>
      <AppHeader title="Systems" subtitle="Site systems and runtime footprint" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          {loading ? <p className="text-sm text-muted">Loading systems overview...</p> : null}

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">API health</p>
              <p className="text-xl font-bold mt-1">{health?.ok ? 'Healthy' : 'Unknown'}</p>
            </article>
            <article className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Registry</p>
              <p className="text-base font-bold mt-1">{registry?.status || 'Unknown'}</p>
              <p className="text-xs text-muted mt-1">Phase {registry?.phase || 'n/a'}</p>
            </article>
            <article className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">ACL file</p>
              <p className="text-xl font-bold mt-1">{aclFileExists ? 'Present' : 'Missing'}</p>
              <p className="text-xs text-muted mt-1">{aclSizeKb} KB</p>
            </article>
            <article className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Fleet</p>
              <p className="text-xl font-bold mt-1">{totalDevices}</p>
              <p className="text-xs text-muted mt-1">{sites.length} sites</p>
            </article>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h3 className="text-lg font-semibold">ACL generation</h3>
            {latestAclLog ? (
              <div className="mt-2 text-sm text-muted">
                <p>Latest: {latestAclLog.success ? 'Success' : 'Failed'}</p>
                <p>Time: {latestAclLog.generated_at || 'n/a'}</p>
                <p>Message: {latestAclLog.message || 'n/a'}</p>
              </div>
            ) : (
              <p className="text-sm text-muted mt-2">No ACL generation logs available yet.</p>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sites.map((site) => (
              <article key={site.site_id} className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                <p className="text-xs uppercase tracking-wide text-muted">{site.domain_name}</p>
                <h3 className="text-lg font-semibold mt-1">{site.site_name}</h3>
                <p className="text-sm text-muted mt-1">Devices: {site.device_count}</p>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div className="rounded-lg p-2 bg-teal-50 text-teal-800">HVAC</div>
                  <div className="rounded-lg p-2 bg-cyan-50 text-cyan-800">Irrigation</div>
                </div>
              </article>
            ))}
            {!sites.length ? <p className="text-sm text-muted">No systems detected yet.</p> : null}
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
