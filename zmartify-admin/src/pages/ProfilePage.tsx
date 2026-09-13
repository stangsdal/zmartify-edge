import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonInput, IonItem, IonLabel, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { authApi } from '../api/auth';
import { apiClient } from '../api/client';
import { User } from '../types/api';
import { AppHeader } from '../components/AppHeader';

export function ProfilePage() {
  const history = useHistory();
  const [profile, setProfile] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

  const logout = async () => {
    await apiClient.clearAuthToken();
    try {
      await authApi.logout();
    } catch {
      // Local session is already cleared if the server is unavailable.
    }
    history.replace('/app/login');
    window.location.assign('/app/login');
  };

  useEffect(() => {
    (async () => {
      try {
        const currentProfile = await authApi.me();
        setProfile(currentProfile);
        setDisplayName(currentProfile.display_name || '');
        setEmail(currentProfile.email || '');
        setPhone(currentProfile.phone || '');
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const saveProfile = async () => {
    try {
      setProfileBusy(true);
      setError('');
      setProfileMessage('');
      const updated = await authApi.updateProfile({
        display_name: displayName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setProfile(updated);
      setDisplayName(updated.display_name || '');
      setEmail(updated.email || '');
      setPhone(updated.phone || '');
      setProfileMessage('Profile information updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProfileBusy(false);
    }
  };

  const changePassword = async () => {
    setError('');
    setPasswordMessage('');
    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    try {
      setPasswordBusy(true);
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated. Other signed-in sessions have been ended.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title="Profile" subtitle="Identity, roles and account activity" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          {error && <p className="text-rose-600 text-sm">{error}</p>}

          {profile ? (
            <>
              <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                <p className="text-xs uppercase tracking-wide text-muted">Display name</p>
                <p className="text-2xl font-bold mt-1">{profile.display_name || profile.username}</p>
                <p className="text-sm text-muted mt-2">Username: {profile.username}</p>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
                  <p className="text-xs uppercase tracking-wide text-muted">Roles</p>
                  <p className="text-base font-semibold mt-1">{profile.roles.join(', ') || 'None'}</p>
                </div>
                <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
                  <p className="text-xs uppercase tracking-wide text-muted">Last login</p>
                  <p className="text-base font-semibold mt-1">{profile.last_login_at || 'Never'}</p>
                </div>
              </section>
              <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                <h2 className="text-lg font-semibold">Personal information</h2>
                <div className="profile-contact-fields mt-3">
                  <IonItem>
                    <IonLabel position="stacked">Display name</IonLabel>
                    <IonInput autocomplete="name" value={displayName} onIonInput={(event) => setDisplayName(event.detail.value || '')} />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">Email</IonLabel>
                    <IonInput type="email" autocomplete="email" value={email} onIonInput={(event) => setEmail(event.detail.value || '')} />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">Phone</IonLabel>
                    <IonInput type="tel" autocomplete="tel" value={phone} onIonInput={(event) => setPhone(event.detail.value || '')} />
                  </IonItem>
                </div>
                {profileMessage ? <p className="text-sm text-emerald-700 mt-3" role="status">{profileMessage}</p> : null}
                <IonButton className="ion-margin-top" disabled={profileBusy || !displayName.trim()} onClick={() => { void saveProfile(); }}>
                  {profileBusy ? 'Saving...' : 'Save information'}
                </IonButton>
              </section>
              <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                <h2 className="text-lg font-semibold">Change password</h2>
                <div className="profile-password-fields mt-3">
                  <IonItem>
                    <IonLabel position="stacked">Current password</IonLabel>
                    <IonInput type="password" autocomplete="current-password" value={currentPassword} onIonInput={(event) => setCurrentPassword(event.detail.value || '')} />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">New password</IonLabel>
                    <IonInput type="password" autocomplete="new-password" value={newPassword} onIonInput={(event) => setNewPassword(event.detail.value || '')} />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">Repeat new password</IonLabel>
                    <IonInput type="password" autocomplete="new-password" value={confirmPassword} onIonInput={(event) => setConfirmPassword(event.detail.value || '')} />
                  </IonItem>
                </div>
                {passwordMessage ? <p className="text-sm text-emerald-700 mt-3" role="status">{passwordMessage}</p> : null}
                <IonButton
                  className="ion-margin-top"
                  disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword}
                  onClick={() => { void changePassword(); }}
                >
                  {passwordBusy ? 'Updating...' : 'Update password'}
                </IonButton>
              </section>
              <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                <p className="font-semibold">Session</p>
                <p className="text-sm text-muted mt-1">End your current session on this device.</p>
                <IonButton color="danger" fill="outline" className="ion-margin-top" onClick={() => void logout()}>
                  Log out
                </IonButton>
              </section>
            </>
          ) : (
            <p className="text-sm text-muted">Loading profile...</p>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
