import { useEffect, useState } from 'react';
import {
  IonContent,
  IonPage,
  IonButton,
  IonLoading,
  IonAlert,
  IonItem,
  IonInput,
  IonLabel,
} from '@ionic/react';
import { siteApi } from '../api/sites';
import { domainApi } from '../api/domains';
import { Site, Domain } from '../types/api';
import { AppHeader } from '../components/AppHeader';

export function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [newSiteSlug, setNewSiteSlug] = useState('');
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteAddress, setNewSiteAddress] = useState('');
  const [siteDrafts, setSiteDrafts] = useState<Record<number, { name: string; address: string }>>({});
  const [creating, setCreating] = useState(false);
  const [savingSiteId, setSavingSiteId] = useState<number | null>(null);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const fetchDomains = async () => {
    try {
      const data = await domainApi.list();
      setDomains(data);
    } catch (e) {
      console.error('Failed to fetch domains:', e);
    }
  };

  const fetchSites = async () => {
    try {
      setLoading(true);
      const allSites: Site[] = [];

      for (const domain of domains) {
        const sitesData = await siteApi.listByDomain(domain.id);
        allSites.push(...sitesData);
      }

      setSites(allSites);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDomains();
  }, []);

  useEffect(() => {
    if (domains.length > 0) {
      fetchSites();
    }
  }, [domains]);

  useEffect(() => {
    setSiteDrafts((prev) => {
      const next: Record<number, { name: string; address: string }> = {};
      for (const site of sites) {
        next[site.id] = prev[site.id] || { name: site.name, address: site.address || '' };
      }
      return next;
    });
  }, [sites]);

  const handleCreateSite = async () => {
    if (!selectedDomainId || !newSiteSlug.trim() || !newSiteName.trim()) {
      setError('Domain, slug, and name are required');
      return;
    }
    try {
      setCreating(true);
      await siteApi.create(parseInt(selectedDomainId), newSiteSlug, newSiteName, newSiteAddress.trim());
      setNewSiteSlug('');
      setNewSiteName('');
      setNewSiteAddress('');
      setSelectedDomainId('');
      setShowForm(false);
      setError('');
      await fetchSites();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const updateSiteDraft = (siteId: number, patch: Partial<{ name: string; address: string }>) => {
    setSiteDrafts((prev) => ({
      ...prev,
      [siteId]: {
        name: prev[siteId]?.name || '',
        address: prev[siteId]?.address || '',
        ...patch,
      },
    }));
  };

  const handleUpdateSite = async (site: Site) => {
    const draft = siteDrafts[site.id] || { name: site.name, address: site.address || '' };
    const name = draft.name.trim();
    if (!name) {
      setError('Site name is required');
      return;
    }
    try {
      setSavingSiteId(site.id);
      await siteApi.update(site.id, { name, address: draft.address.trim() || null });
      setError('');
      await fetchSites();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingSiteId(null);
    }
  };

  const handleDeleteSite = async (id: number) => {
    try {
      setCreating(true);
      await siteApi.delete(id);
      setError('');
      await fetchSites();
      setShowDeleteAlert(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const getDomainName = (domainId: number): string => {
    const domain = domains.find((d) => d.id === domainId);
    return domain ? domain.name : `Domain ${domainId}`;
  };

  return (
    <IonPage>
      <AppHeader title="Sites" subtitle="Domain locations and ownership boundaries" />
      <IonContent className="ion-padding">
        <IonLoading isOpen={creating} message="Processing..." />
        <IonAlert
          isOpen={showDeleteAlert}
          onDidDismiss={() => setShowDeleteAlert(false)}
          header="Confirm Delete"
          message="Are you sure you want to delete this site?"
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Delete',
              role: 'destructive',
              handler: () => {
                if (deleteTarget !== null) {
                  handleDeleteSite(deleteTarget);
                }
              },
            },
          ]}
        />

        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Total sites</p>
              <p className="text-2xl font-bold mt-1">{sites.length}</p>
            </div>
            <IonButton onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'New site'}</IonButton>
          </section>

          {showForm ? (
            <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
              <h2 className="text-lg font-semibold mb-2">Create site</h2>
              <IonItem>
                <IonLabel position="stacked">Domain</IonLabel>
                <select
                  value={selectedDomainId}
                  onChange={(e) => setSelectedDomainId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                  }}
                >
                  <option value="">Select a domain...</option>
                  {domains.map((domain) => (
                    <option key={domain.id} value={domain.id}>
                      {domain.name}
                    </option>
                  ))}
                </select>
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Slug</IonLabel>
                <IonInput
                  value={newSiteSlug}
                  onIonChange={(e) => setNewSiteSlug(e.detail.value || '')}
                  placeholder="e.g., main-floor"
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Name</IonLabel>
                <IonInput
                  value={newSiteName}
                  onIonChange={(e) => setNewSiteName(e.detail.value || '')}
                  placeholder="e.g., Main Floor"
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Address</IonLabel>
                <IonInput
                  value={newSiteAddress}
                  onIonChange={(e) => setNewSiteAddress(e.detail.value || '')}
                  placeholder="e.g., 1 Main Street"
                />
              </IonItem>
              <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                <IonButton expand="block" onClick={handleCreateSite}>
                  Create
                </IonButton>
              </div>
            </section>
          ) : null}

          {loading ? <p className="text-sm text-muted">Loading sites...</p> : null}
          {!loading && sites.length === 0 ? <p className="text-sm text-muted">No sites yet. Create one to get started.</p> : null}
          {!loading && sites.length > 0 ? (
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sites.map((site) => (
                <article key={site.id} className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                  <p className="text-xs uppercase tracking-wide text-muted">{getDomainName(site.domain_id)}</p>
                  <p className="text-sm text-muted mt-1">{site.slug}</p>
                  <label className="block mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    Name
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal text-slate-900"
                      value={(siteDrafts[site.id] || { name: site.name, address: site.address || '' }).name}
                      onChange={(event) => updateSiteDraft(site.id, { name: event.target.value })}
                    />
                  </label>
                  <label className="block mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    Address
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal text-slate-900"
                      value={(siteDrafts[site.id] || { name: site.name, address: site.address || '' }).address}
                      onChange={(event) => updateSiteDraft(site.id, { address: event.target.value })}
                      placeholder="No address set"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <IonButton
                      size="small"
                      disabled={savingSiteId === site.id}
                      onClick={() => { void handleUpdateSite(site); }}
                    >
                      {savingSiteId === site.id ? 'Saving...' : 'Save'}
                    </IonButton>
                    <IonButton
                      color="danger"
                      size="small"
                      fill="outline"
                      onClick={() => {
                        setDeleteTarget(site.id);
                        setShowDeleteAlert(true);
                      }}
                    >
                      Delete
                    </IonButton>
                  </div>
                </article>
              ))}
            </section>
          ) : null}
        </div>
      </IonContent>
    </IonPage>
  );
}
