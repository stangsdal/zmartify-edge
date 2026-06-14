import { useEffect, useState } from 'react';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonPage, IonCard, IonCardContent, IonButton } from '@ionic/react';
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
      <IonHeader><IonToolbar><IonTitle>Audit Log</IonTitle></IonToolbar></IonHeader>
      <IonContent className="ion-padding">
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
