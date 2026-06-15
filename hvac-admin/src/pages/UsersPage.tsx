import { useEffect, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonPage,
  IonCard,
  IonCardContent,
  IonButton,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
} from '@ionic/react';
import { usersApi } from '../api/users';
import { User } from '../types/api';

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState('viewer');

  const load = async () => {
    try {
      setUsers(await usersApi.list());
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    try {
      await usersApi.create({
        username,
        display_name: displayName,
        password,
        roles: roles.split(',').map((r) => r.trim()).filter(Boolean),
      });
      setUsername('');
      setDisplayName('');
      setPassword('');
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const changeRoles = async (user: User) => {
    const next = window.prompt('Enter roles (comma-separated)', user.roles.join(','));
    if (next === null) {
      return;
    }
    try {
      const parsed = next
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      await usersApi.setRoles(user.id, parsed);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const changeSiteAccess = async (user: User) => {
    try {
      const current = await usersApi.getSiteAccess(user.id);
      const hint = current.site_ids.length ? current.site_ids.join(',') : '';
      const next = window.prompt('Allowed site IDs (comma-separated numeric IDs). Leave blank for unrestricted.', hint);
      if (next === null) {
        return;
      }
      const parsed = next
        .split(',')
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map((raw) => Number(raw))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.trunc(value));
      await usersApi.setSiteAccess(user.id, parsed);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Users</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <IonCard>
          <IonCardContent>
            <h3>Create User</h3>
            <IonItem>
              <IonLabel position="stacked">Username</IonLabel>
              <IonInput value={username} onIonChange={(e) => setUsername(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Display Name</IonLabel>
              <IonInput value={displayName} onIonChange={(e) => setDisplayName(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Password (min 12)</IonLabel>
              <IonInput type="password" value={password} onIonChange={(e) => setPassword(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Roles (comma-separated)</IonLabel>
              <IonInput value={roles} onIonChange={(e) => setRoles(e.detail.value || '')} />
            </IonItem>
            <IonButton expand="block" className="ion-margin-top" onClick={create}>
              Create User
            </IonButton>
          </IonCardContent>
        </IonCard>

        <IonList>
          {users.map((u) => (
            <IonCard key={u.id}>
              <IonCardContent>
                <strong>{u.username}</strong> ({u.display_name})
                <p>Roles: {u.roles.join(', ')}</p>
                <p>Status: {u.enabled ? 'Enabled' : 'Disabled'}</p>
                <p>Last Login: {u.last_login_at || 'Never'}</p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <IonButton size="small" onClick={() => changeRoles(u)}>
                    Change Roles
                  </IonButton>
                  <IonButton size="small" onClick={() => changeSiteAccess(u)}>
                    Site Access
                  </IonButton>
                  {u.enabled ? (
                    <IonButton size="small" color="warning" onClick={async () => { await usersApi.disable(u.id); await load(); }}>
                      Disable
                    </IonButton>
                  ) : (
                    <IonButton size="small" color="success" onClick={async () => { await usersApi.enable(u.id); await load(); }}>
                      Enable
                    </IonButton>
                  )}
                  <IonButton size="small" onClick={async () => {
                    const p = window.prompt('New password (min 12 chars)');
                    if (p) { await usersApi.resetPassword(u.id, p); await load(); }
                  }}>
                    Reset Password
                  </IonButton>
                  <IonButton size="small" color="danger" onClick={async () => { await usersApi.delete(u.id); await load(); }}>
                    Delete
                  </IonButton>
                </div>
              </IonCardContent>
            </IonCard>
          ))}
        </IonList>
      </IonContent>
    </IonPage>
  );
}
