import { useEffect, useState } from 'react';
import {
  IonAlert,
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonLoading,
  IonModal,
  IonPage,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  IonCard,
  IonCardContent,
} from '@ionic/react';
import { createOutline, keyOutline, refreshOutline, shieldCheckmarkOutline, trashOutline } from 'ionicons/icons';
import { usersApi } from '../api/users';
import { siteMembersApi, SiteMembership } from '../api/siteMembers';
import { useAccess } from '../auth/AccessContext';
import { AppHeader } from '../components/AppHeader';
import { User } from '../types/api';
import {
  filterUsers,
  paginateUsers,
  UserRoleFilter,
  UserSort,
  UserStatusFilter,
} from '../utils/userDirectory';

type UserSiteMembership = SiteMembership & { siteId: number; siteName: string };
type UsersView = 'directory' | 'create';

const pageSize = 25;

function formatDate(value?: string): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function UsersPage() {
  const { context } = useAccess();
  const roleOptions = ['administrator'];
  const [view, setView] = useState<UsersView>('directory');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('all');
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>('all');
  const [sort, setSort] = useState<UserSort>('username');
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [roleEditUser, setRoleEditUser] = useState<User | null>(null);
  const [roleEditSelected, setRoleEditSelected] = useState<string[]>([]);
  const [siteAccessLoading, setSiteAccessLoading] = useState(false);
  const [siteRoleEditUser, setSiteRoleEditUser] = useState<User | null>(null);
  const [siteMemberships, setSiteMemberships] = useState<UserSiteMembership[]>([]);
  const [profileEditUser, setProfileEditUser] = useState<User | null>(null);
  const [profileEditName, setProfileEditName] = useState('');
  const [profileEditEmail, setProfileEditEmail] = useState('');
  const [profileEditPhone, setProfileEditPhone] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setUsers(await usersApi.list());
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
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
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        password,
        roles,
      });
      setUsername('');
      setDisplayName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setRoles([]);
      await load();
      setView('directory');
    } catch (e) {
      setError(String(e));
    }
  };

  const changeRoles = (user: User) => {
    setRoleEditUser(user);
    setRoleEditSelected(user.roles || []);
  };

  const editProfile = (user: User) => {
    setProfileEditUser(user);
    setProfileEditName(user.display_name || '');
    setProfileEditEmail(user.email || '');
    setProfileEditPhone(user.phone || '');
  };

  const saveProfile = async () => {
    if (!profileEditUser || !profileEditName.trim()) return;
    try {
      setSiteAccessLoading(true);
      await usersApi.update(profileEditUser.id, {
        display_name: profileEditName.trim(),
        email: profileEditEmail.trim() || undefined,
        phone: profileEditPhone.trim() || undefined,
      });
      await load();
      setProfileEditUser(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSiteAccessLoading(false);
    }
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

  const changeSiteRoles = async (user: User) => {
    try {
      setSiteAccessLoading(true);
      const memberships = (await Promise.all(
        (context?.sites || []).map(async (site) => ({
          site,
          memberships: await siteMembersApi.list(site.id),
        })),
      )).flatMap(({ site, memberships }) => memberships
        .filter((membership) => membership.user_id === user.id)
        .map((membership) => ({ ...membership, siteId: site.id, siteName: site.name })));
      setSiteMemberships(memberships);
      setSiteRoleEditUser(user);
    } catch (e) {
      setError(String(e));
    } finally {
      setSiteAccessLoading(false);
    }
  };

  const updateSiteRole = async (membership: UserSiteMembership, role: string) => {
    try {
      setSiteAccessLoading(true);
      const updated = await siteMembersApi.update(membership.siteId, membership.id, { role });
      setSiteMemberships((current) => current.map((item) => item.id === updated.id
        ? { ...updated, siteId: membership.siteId, siteName: membership.siteName }
        : item));
    } catch (e) {
      setError(String(e));
    } finally {
      setSiteAccessLoading(false);
    }
  };

  const filtered = filterUsers(users, { query, status: statusFilter, role: roleFilter, sort });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = paginateUsers(filtered, currentPage, pageSize);
  const selectedUser = users.find((user) => user.id === selectedUserId) || null;
  const enabledCount = users.filter((user) => Boolean(user.enabled)).length;
  const administratorCount = users.filter((user) => user.roles?.includes('administrator')).length;
  const resetPage = () => setPage(1);

  const setEnabled = async (user: User, enabled: boolean) => {
    try {
      setSiteAccessLoading(true);
      if (enabled) await usersApi.enable(user.id);
      else await usersApi.disable(user.id);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSiteAccessLoading(false);
    }
  };

  const resetPassword = async (user: User) => {
    const nextPassword = window.prompt('New password (min 12 chars)');
    if (!nextPassword) return;
    try {
      setSiteAccessLoading(true);
      await usersApi.resetPassword(user.id, nextPassword);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSiteAccessLoading(false);
    }
  };

  const deleteUser = async () => {
    if (!deleteTarget) return;
    try {
      setSiteAccessLoading(true);
      await usersApi.delete(deleteTarget.id);
      if (selectedUserId === deleteTarget.id) setSelectedUserId(null);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSiteAccessLoading(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title="Users" subtitle="Accounts, access and site memberships" />
      <IonContent className="ion-padding">
        <IonLoading isOpen={siteAccessLoading} message="Updating access..." />
        <IonAlert
          isOpen={deleteTarget !== null}
          onDidDismiss={() => setDeleteTarget(null)}
          header="Delete user"
          message={`Delete ${deleteTarget?.display_name || deleteTarget?.username || 'this user'}? This cannot be undone.`}
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            { text: 'Delete', role: 'destructive', handler: () => { void deleteUser(); } },
          ]}
        />
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
        <IonModal isOpen={siteRoleEditUser !== null} onDidDismiss={() => setSiteRoleEditUser(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{siteRoleEditUser ? `Site roles: ${siteRoleEditUser.username}` : 'Site roles'}</IonTitle>
              <IonButton slot="end" fill="clear" onClick={() => setSiteRoleEditUser(null)}>Close</IonButton>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {siteMemberships.length === 0 ? (
              <p>This user has no site memberships.</p>
            ) : siteMemberships.map((membership) => (
              <IonItem key={membership.id}>
                <IonLabel position="stacked">{membership.siteName}</IonLabel>
                <IonSelect value={membership.role} interface="popover" onIonChange={(event) => void updateSiteRole(membership, String(event.detail.value))}>
                  <IonSelectOption value="owner">Owner</IonSelectOption>
                  <IonSelectOption value="user">User</IonSelectOption>
                  <IonSelectOption value="viewer">Viewer</IonSelectOption>
                </IonSelect>
              </IonItem>
            ))}
          </IonContent>
        </IonModal>
        <IonModal isOpen={profileEditUser !== null} onDidDismiss={() => setProfileEditUser(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{profileEditUser ? `Edit: ${profileEditUser.username}` : 'Edit user'}</IonTitle>
              <IonButton slot="end" fill="clear" onClick={() => setProfileEditUser(null)}>Close</IonButton>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <div className="profile-contact-fields">
              <IonItem><IonLabel position="stacked">Display name</IonLabel><IonInput autocomplete="name" value={profileEditName} onIonInput={(event) => setProfileEditName(event.detail.value || '')} /></IonItem>
              <IonItem><IonLabel position="stacked">Email</IonLabel><IonInput type="email" autocomplete="email" value={profileEditEmail} onIonInput={(event) => setProfileEditEmail(event.detail.value || '')} /></IonItem>
              <IonItem><IonLabel position="stacked">Phone</IonLabel><IonInput type="tel" autocomplete="tel" value={profileEditPhone} onIonInput={(event) => setProfileEditPhone(event.detail.value || '')} /></IonItem>
            </div>
            <IonButton className="ion-margin-top" disabled={!profileEditName.trim()} onClick={() => { void saveProfile(); }}>Save information</IonButton>
          </IonContent>
        </IonModal>
        <div className="users-workspace">
          <IonSegment value={view} onIonChange={(event) => setView(event.detail.value as UsersView)}>
            <IonSegmentButton value="directory"><IonLabel>Directory</IonLabel></IonSegmentButton>
            <IonSegmentButton value="create"><IonLabel>Add user</IonLabel></IonSegmentButton>
          </IonSegment>

          {error ? <p className="controller-message controller-message--error">{error}</p> : null}

          {view === 'directory' ? (
            <>
              <section className="controller-summary">
                <div><span>Users</span><strong>{users.length}</strong></div>
                <div><span>Enabled</span><strong>{enabledCount}</strong></div>
                <div><span>Disabled</span><strong>{users.length - enabledCount}</strong></div>
                <div><span>Administrators</span><strong>{administratorCount}</strong></div>
              </section>

              <section className="user-toolbar" aria-label="User filters">
                <IonSearchbar value={query} debounce={200} placeholder="Search name, username, email, phone or role" onIonInput={(event) => { setQuery(event.detail.value || ''); resetPage(); }} />
                <label>Status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as UserStatusFilter); resetPage(); }}><option value="all">All</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
                <label>Role<select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value as UserRoleFilter); resetPage(); }}><option value="all">All</option><option value="administrator">Administrator</option><option value="standard">Standard</option></select></label>
                <label>Sort<select value={sort} onChange={(event) => { setSort(event.target.value as UserSort); resetPage(); }}><option value="username">Username</option><option value="display_name">Display name</option><option value="last_login">Last login</option></select></label>
                <button type="button" className="controller-icon-button" onClick={() => { void load(); }} title="Refresh users"><IonIcon icon={refreshOutline} aria-hidden="true" /></button>
              </section>

              <div className={`user-directory-layout${selectedUser ? ' has-detail' : ''}`}>
                <section className="controller-list-panel">
                  {loading ? <div className="controller-loading"><IonSpinner name="crescent" /> Loading users...</div> : null}
                  {!loading && !visibleUsers.length ? <p className="controller-empty">No users match these filters.</p> : null}
                  {!loading && visibleUsers.length ? (
                    <div className="controller-table-wrap">
                      <table className="user-table">
                        <thead><tr><th>User</th><th>Status</th><th>Global role</th><th>Last login</th><th>Created</th></tr></thead>
                        <tbody>{visibleUsers.map((user) => (
                          <tr key={user.id} className={selectedUserId === user.id ? 'is-selected' : ''} onClick={() => setSelectedUserId(user.id)}>
                            <td><strong>{user.display_name || user.username}</strong><span>{user.username}{user.email ? ` · ${user.email}` : ''}</span></td>
                            <td><span className={`user-status ${user.enabled ? 'is-enabled' : 'is-disabled'}`}>{user.enabled ? 'Enabled' : 'Disabled'}</span></td>
                            <td>{user.roles?.length ? user.roles.join(', ') : 'Standard'}</td>
                            <td>{formatDate(user.last_login_at)}</td>
                            <td>{formatDate(user.created_at)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : null}
                  <footer className="controller-pagination">
                    <span>{filtered.length ? `${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, filtered.length)} of ${filtered.length}` : '0 users'}</span>
                    <div><IonButton fill="clear" size="small" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</IonButton><span>{currentPage} / {pageCount}</span><IonButton fill="clear" size="small" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</IonButton></div>
                  </footer>
                </section>

                {selectedUser ? (
                  <aside className="user-detail">
                    <div className="controller-detail__heading">
                      <div><p className="controller-eyebrow">@{selectedUser.username}</p><h2>{selectedUser.display_name || selectedUser.username}</h2></div>
                      <button type="button" className="controller-detail__close" onClick={() => setSelectedUserId(null)} aria-label="Close user details">×</button>
                    </div>
                    <dl className="controller-facts">
                      <div><dt>Status</dt><dd>{selectedUser.enabled ? 'Enabled' : 'Disabled'}</dd></div>
                      <div><dt>Email</dt><dd>{selectedUser.email || 'Not set'}</dd></div>
                      <div><dt>Phone</dt><dd>{selectedUser.phone || 'Not set'}</dd></div>
                      <div><dt>Global role</dt><dd>{selectedUser.roles?.length ? selectedUser.roles.join(', ') : 'Standard'}</dd></div>
                      <div><dt>Last login</dt><dd>{formatDate(selectedUser.last_login_at)}</dd></div>
                    </dl>
                    <div className="user-detail__actions">
                      <IonButton size="small" fill="outline" onClick={() => editProfile(selectedUser)}><IonIcon slot="start" icon={createOutline} />Edit details</IonButton>
                      <IonButton size="small" fill="outline" onClick={() => changeRoles(selectedUser)}><IonIcon slot="start" icon={shieldCheckmarkOutline} />Global role</IonButton>
                      <IonButton size="small" fill="outline" onClick={() => { void changeSiteRoles(selectedUser); }}>Site roles</IonButton>
                      <IonButton size="small" fill="outline" onClick={() => { void resetPassword(selectedUser); }}><IonIcon slot="start" icon={keyOutline} />Reset password</IonButton>
                      <IonButton size="small" color={selectedUser.enabled ? 'warning' : 'success'} onClick={() => { void setEnabled(selectedUser, !selectedUser.enabled); }}>{selectedUser.enabled ? 'Disable' : 'Enable'}</IonButton>
                      <IonButton size="small" fill="outline" color="danger" onClick={() => setDeleteTarget(selectedUser)}><IonIcon slot="start" icon={trashOutline} />Delete</IonButton>
                    </div>
                  </aside>
                ) : null}
              </div>
            </>
          ) : (
            <IonCard className="user-create-card">
              <IonCardContent>
                <h2>Create user</h2>
                <div className="user-create-fields">
                  <IonItem><IonLabel position="stacked">Username</IonLabel><IonInput value={username} onIonChange={(event) => setUsername(event.detail.value || '')} /></IonItem>
                  <IonItem><IonLabel position="stacked">Display name</IonLabel><IonInput value={displayName} onIonChange={(event) => setDisplayName(event.detail.value || '')} /></IonItem>
                  <IonItem><IonLabel position="stacked">Email</IonLabel><IonInput type="email" autocomplete="email" value={email} onIonChange={(event) => setEmail(event.detail.value || '')} /></IonItem>
                  <IonItem><IonLabel position="stacked">Phone</IonLabel><IonInput type="tel" autocomplete="tel" value={phone} onIonChange={(event) => setPhone(event.detail.value || '')} /></IonItem>
                  <IonItem><IonLabel position="stacked">Password (min 12)</IonLabel><IonInput type="password" value={password} onIonChange={(event) => setPassword(event.detail.value || '')} /></IonItem>
                  <IonItem><IonLabel position="stacked">Roles</IonLabel><IonSelect value={roles} multiple onIonChange={(event) => setRoles((event.detail.value as string[]) || [])} interface="popover">{roleOptions.map((role) => <IonSelectOption key={role} value={role}>{role}</IonSelectOption>)}</IonSelect></IonItem>
                </div>
                <IonButton className="ion-margin-top" onClick={() => { void create(); }} disabled={!username.trim() || !displayName.trim() || password.length < 12}>Create user</IonButton>
              </IonCardContent>
            </IonCard>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
