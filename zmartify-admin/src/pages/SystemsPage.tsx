import { useEffect, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { mobileApi, MobileSiteSummary } from '../api/mobile';

export function SystemsPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    mobileApi
      .listSites()
      .then((data) => setSites(data.sites || []))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <IonPage>
      <AppHeader title="Systems" subtitle="Site systems and runtime footprint" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
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
