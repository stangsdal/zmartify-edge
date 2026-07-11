import { useEffect, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonPage,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonCard,
  IonCardContent,
  IonInput,
  IonLoading,
  IonAlert,
} from '@ionic/react';
import { siteApi } from '../api/sites';
import { domainApi } from '../api/domains';
import { Site, Domain } from '../types/api';

export function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [newSiteSlug, setNewSiteSlug] = useState('');
  const [newSiteName, setNewSiteName] = useState('');
  const [creating, setCreating] = useState(false);
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

  const handleCreateSite = async () => {
    if (!selectedDomainId || !newSiteSlug.trim() || !newSiteName.trim()) {
      setError('Domain, slug, and name are required');
      return;
    }
    try {
      setCreating(true);
      await siteApi.create(parseInt(selectedDomainId), newSiteSlug, newSiteName);
      setNewSiteSlug('');
      setNewSiteName('');
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
      <IonHeader>
        <IonToolbar>
          <IonTitle>Sites</IonTitle>
        </IonToolbar>
      </IonHeader>
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

        {error && (
          <IonCard>
            <IonCardContent style={{ color: 'red' }}>
              <strong>Error:</strong> {error}
            </IonCardContent>
          </IonCard>
        )}

        <IonButton
          expand="block"
          onClick={() => setShowForm(!showForm)}
          className="ion-margin-bottom"
        >
          {showForm ? 'Cancel' : 'New Site'}
        </IonButton>

        {showForm && (
          <IonCard className="ion-margin-bottom">
            <IonCardContent>
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
              <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                <IonButton expand="block" onClick={handleCreateSite}>
                  Create
                </IonButton>
              </div>
            </IonCardContent>
          </IonCard>
        )}

        {loading ? (
          <p>Loading sites...</p>
        ) : sites.length === 0 ? (
          <p>No sites yet. Create one to get started.</p>
        ) : (
          <IonList>
            {sites.map((site) => (
              <IonItem key={site.id}>
                <IonLabel>
                  <strong>{site.name}</strong>
                  <p>{site.slug}</p>
                  <p style={{ fontSize: '0.8em', color: '#666' }}>
                    Domain: {getDomainName(site.domain_id)}
                  </p>
                </IonLabel>
                <IonButton
                  slot="end"
                  color="danger"
                  size="small"
                  onClick={() => {
                    setDeleteTarget(site.id);
                    setShowDeleteAlert(true);
                  }}
                >
                  Delete
                </IonButton>
              </IonItem>
            ))}
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
}
