import { useEffect, useState } from 'react';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonPage, IonCard, IonCardContent, IonButton } from '@ionic/react';
import { usersApi } from '../api/users';
import { User } from '../types/api';

export function RolesPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setUsers(await usersApi.list());
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const changeRoles = async (user: User) => {
    const next = window.prompt('Enter roles (comma-separated)', user.roles.join(','));
    if (!next) return;
    try {
      const roles = next.split(',').map((r) => r.trim()).filter(Boolean);
      await usersApi.setRoles(user.id, roles);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>Roles</IonTitle></IonToolbar></IonHeader>
      <IonContent className="ion-padding">
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {users.map((u) => (
          <IonCard key={u.id}>
            <IonCardContent>
              <strong>{u.username}</strong>
              <p>Current roles: {u.roles.join(', ')}</p>
              <IonButton size="small" onClick={() => changeRoles(u)}>Change Role</IonButton>
            </IonCardContent>
          </IonCard>
        ))}
      </IonContent>
    </IonPage>
  );
}
