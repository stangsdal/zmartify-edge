import { useEffect, useState } from 'react';
import { IonContent, IonPage, IonCard, IonCardContent, IonButton } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { PageSubNav, systemHubNav } from '../components/PageSubNav';
import { usersApi } from '../api/users';
import { AuditLogEntry } from '../types/api';

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setEntries(await usersApi.auditLog(200));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <IonPage>
      <AppHeader title="Audit log" subtitle="Administrative actions across the platform" />
      <IonContent className="ion-padding">
        <PageSubNav items={systemHubNav} />
        <IonButton onClick={load} size="small">Refresh</IonButton>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {entries.map((e) => (
          <IonCard key={e.id}>
            <IonCardContent>
              <strong>{e.action}</strong>
              <p>User: {e.username || 'system'}</p>
              <p>Resource: {e.resource_type || '-'} {e.resource_id || ''}</p>
              <p>At: {e.created_at}</p>
              {e.metadata && <p>Meta: {e.metadata}</p>}
            </IonCardContent>
          </IonCard>
        ))}
      </IonContent>
    </IonPage>
  );
}
