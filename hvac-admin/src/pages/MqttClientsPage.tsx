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
  IonLoading,
  IonAlert,
} from '@ionic/react';
import { mqttClientApi } from '../api/mqttClients';
import { domainApi } from '../api/domains';
import { MqttClient, Domain, AclPreview } from '../types/api';

export function MqttClientsPage() {
  const [clients, setClients] = useState<MqttClient[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [creating, setCreating] = useState(false);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [showPasswordAlert, setShowPasswordAlert] = useState(false);
  const [passwordAlertMessage, setPasswordAlertMessage] = useState('');
  const [showAclAlert, setShowAclAlert] = useState(false);
  const [aclPreview, setAclPreview] = useState<AclPreview | null>(null);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const data = await mqttClientApi.list();
      setClients(data);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const fetchDomains = async () => {
    try {
      const data = await domainApi.list();
      setDomains(data);
    } catch (e) {
      console.error('Failed to fetch domains:', e);
    }
  };

  useEffect(() => {
    fetchClients();
    fetchDomains();
  }, []);

  const handleCreateHomeyClient = async () => {
    if (!selectedDomainId) {
      setError('Please select a domain');
      return;
    }
    try {
      setCreating(true);
      await mqttClientApi.createHomey(parseInt(selectedDomainId));
      setSelectedDomainId('');
      setShowForm(false);
      setError('');
      await fetchClients();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleRotatePassword = async (clientId: number) => {
    try {
      setCreating(true);
      const response = await mqttClientApi.rotatePassword(clientId);
      setPasswordAlertMessage(`New password: ${response.password}`);
      setShowPasswordAlert(true);
      setError('');
      await fetchClients();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handlePreviewAcl = async (clientId: string) => {
    try {
      setCreating(true);
      const preview = await mqttClientApi.getAclPreview(clientId);
      setAclPreview(preview);
      setShowAclAlert(true);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleRegenerateAcl = async () => {
    try {
      setCreating(true);
      await mqttClientApi.regenerateAcl();
      setError('ACL regenerated successfully');
      await fetchClients();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClient = async (clientId: number) => {
    try {
      setCreating(true);
      await mqttClientApi.delete(clientId);
      setError('');
      await fetchClients();
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
          <IonTitle>MQTT Clients</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonLoading isOpen={creating} message="Processing..." />
        <IonAlert
          isOpen={showDeleteAlert}
          onDidDismiss={() => setShowDeleteAlert(false)}
          header="Confirm Delete"
          message="Are you sure you want to delete this MQTT client?"
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Delete',
              role: 'destructive',
              handler: () => {
                if (deleteTarget !== null) {
                  handleDeleteClient(deleteTarget);
                }
              },
            },
          ]}
        />
        <IonAlert
          isOpen={showPasswordAlert}
          onDidDismiss={() => setShowPasswordAlert(false)}
          header="Password Rotated"
          message={passwordAlertMessage}
          buttons={['OK']}
        />
        {aclPreview && (
          <IonAlert
            isOpen={showAclAlert}
            onDidDismiss={() => setShowAclAlert(false)}
            header="ACL Preview"
            message={`Client: ${aclPreview.client_id}\n\nRules:\n${aclPreview.rules.join('\n')}`}
            buttons={['OK']}
          />
        )}

        {error && (
          <IonCard>
            <IonCardContent style={{ color: 'red' }}>
              <strong>Status:</strong> {error}
            </IonCardContent>
          </IonCard>
        )}

        <div className="ion-margin-bottom">
          <IonButton
            expand="block"
            onClick={() => setShowForm(!showForm)}
            className="ion-margin-bottom"
          >
            {showForm ? 'Cancel' : 'Create Homey Client'}
          </IonButton>
          <IonButton expand="block" onClick={handleRegenerateAcl} color="warning">
            Regenerate ACL
          </IonButton>
        </div>

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
                      {domain.name} ({domain.slug})
                    </option>
                  ))}
                </select>
              </IonItem>
              <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                <IonButton expand="block" onClick={handleCreateHomeyClient}>
                  Create
                </IonButton>
              </div>
            </IonCardContent>
          </IonCard>
        )}

        {loading ? (
          <p>Loading MQTT clients...</p>
        ) : clients.length === 0 ? (
          <p>No MQTT clients yet.</p>
        ) : (
          <IonList>
            {clients.map((client) => (
              <IonItem key={client.id}>
                <IonLabel>
                  <strong>{client.client_id}</strong>
                  <p>Type: {client.client_type}</p>
                  <p>Username: {client.username}</p>
                  <p>Status: {client.enabled ? 'Enabled' : 'Disabled'}</p>
                  {client.last_rotated && (
                    <p style={{ fontSize: '0.8em', color: '#666' }}>
                      Last rotated: {client.last_rotated}
                    </p>
                  )}
                </IonLabel>
                <div
                  slot="end"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  {client.client_type === 'homey' && (
                    <>
                      <IonButton
                        size="small"
                        fill="outline"
                        onClick={() => handleRotatePassword(client.id)}
                      >
                        Rotate
                      </IonButton>
                      <IonButton
                        size="small"
                        fill="outline"
                        onClick={() => handlePreviewAcl(client.client_id)}
                      >
                        ACL
                      </IonButton>
                    </>
                  )}
                  <IonButton
                    size="small"
                    color="danger"
                    fill="outline"
                    onClick={() => {
                      setDeleteTarget(client.id);
                      setShowDeleteAlert(true);
                    }}
                  >
                    Delete
                  </IonButton>
                </div>
              </IonItem>
            ))}
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
}
