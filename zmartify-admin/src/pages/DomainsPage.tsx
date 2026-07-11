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
import { domainApi } from '../api/domains';
import { Domain } from '../types/api';

export function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newDomainSlug, setNewDomainSlug] = useState('');
  const [newDomainName, setNewDomainName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const fetchDomains = async () => {
    try {
      setLoading(true);
      const data = await domainApi.list();
      setDomains(data);
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

  const handleCreateDomain = async () => {
    if (!newDomainSlug.trim() || !newDomainName.trim()) {
      setError('Slug and name are required');
      return;
    }
    try {
      setCreating(true);
      await domainApi.create(newDomainSlug, newDomainName);
      setNewDomainSlug('');
      setNewDomainName('');
      setShowForm(false);
      setError('');
      await fetchDomains();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteDomain = async (id: number) => {
    try {
      setCreating(true);
      await domainApi.delete(id);
      setError('');
      await fetchDomains();
      setShowDeleteAlert(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Domains</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonLoading isOpen={creating} message="Processing..." />
        <IonAlert
          isOpen={showDeleteAlert}
          onDidDismiss={() => setShowDeleteAlert(false)}
          header="Confirm Delete"
          message="Are you sure you want to delete this domain?"
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Delete',
              role: 'destructive',
              handler: () => {
                if (deleteTarget !== null) {
                  handleDeleteDomain(deleteTarget);
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
          {showForm ? 'Cancel' : 'New Domain'}
        </IonButton>

        {showForm && (
          <IonCard className="ion-margin-bottom">
            <IonCardContent>
              <IonItem>
                <IonLabel position="stacked">Slug</IonLabel>
                <IonInput
                  value={newDomainSlug}
                  onIonChange={(e) => setNewDomainSlug(e.detail.value || '')}
                  placeholder="e.g., main-office"
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Name</IonLabel>
                <IonInput
                  value={newDomainName}
                  onIonChange={(e) => setNewDomainName(e.detail.value || '')}
                  placeholder="e.g., Main Office Domain"
                />
              </IonItem>
              <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                <IonButton expand="block" onClick={handleCreateDomain}>
                  Create
                </IonButton>
              </div>
            </IonCardContent>
          </IonCard>
        )}

        {loading ? (
          <p>Loading domains...</p>
        ) : domains.length === 0 ? (
          <p>No domains yet. Create one to get started.</p>
        ) : (
          <IonList>
            {domains.map((domain) => (
              <IonItem key={domain.id}>
                <IonLabel>
                  <strong>{domain.name}</strong>
                  <p>{domain.slug}</p>
                </IonLabel>
                <IonButton
                  slot="end"
                  color="danger"
                  size="small"
                  onClick={() => {
                    setDeleteTarget(domain.id);
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
