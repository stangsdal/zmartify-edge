import { useEffect, useState } from 'react';
import {
  IonAlert,
  IonContent,
  IonHeader,
  IonLoading,
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
  IonSelect,
  IonSelectOption,
} from '@ionic/react';
import { usersApi } from '../api/users';
import { User } from '../types/api';

export function UsersPage() {
  const roleOptions = ['administrator'];
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [roleEditUser, setRoleEditUser] = useState<User | null>(null);
  const [roleEditSelected, setRoleEditSelected] = useState<string[]>([]);
  const [siteAccessLoading, setSiteAccessLoading] = useState(false);

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
        roles,
      });
      setUsername('');
      setDisplayName('');
      setPassword('');
      setRoles([]);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const changeRoles = (user: User) => {
    setRoleEditUser(user);
    setRoleEditSelected(user.roles || []);
  };

  const saveRoles = async (selectedValues: Array<string | number>) => {
    if (!roleEditUser) {
      return;
    }
    try {
      setSiteAccessLoading(true);
      const parsed = selectedValues
        .map((value) => String(value).trim())
        .filter((value) => roleOptions.includes(value));
      await usersApi.setRoles(roleEditUser.id, parsed);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSiteAccessLoading(false);
      setRoleEditUser(null);
      setRoleEditSelected([]);
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
        <IonLoading isOpen={siteAccessLoading} message="Updating access..." />
        <IonAlert
          isOpen={roleEditUser !== null}
          header={roleEditUser ? `Roles: ${roleEditUser.username}` : 'Roles'}
          message="Toggle roles on/off for this user."
          inputs={roleOptions.map((role) => ({
            type: 'checkbox',
            label: role,
            value: role,
            checked: roleEditSelected.includes(role),
          }))}
          buttons={[
            {
              text: 'Cancel',
              role: 'cancel',
              handler: () => {
                setRoleEditUser(null);
                setRoleEditSelected([]);
              },
            },
            {
              text: 'Save',
              handler: (selected: Array<string | number>) => {
                void saveRoles(selected || []);
              },
            },
          ]}
          onDidDismiss={() => {
            setRoleEditUser(null);
            setRoleEditSelected([]);
          }}
        />
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
              <IonLabel position="stacked">Roles</IonLabel>
              <IonSelect
                value={roles}
                multiple={true}
                onIonChange={(e) => setRoles((e.detail.value as string[]) || [])}
                interface="popover"
              >
                {roleOptions.map((role) => (
                  <IonSelectOption key={role} value={role}>
                    {role}
                  </IonSelectOption>
                ))}
              </IonSelect>
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
