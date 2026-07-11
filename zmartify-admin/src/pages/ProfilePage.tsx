import { useEffect, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { authApi } from '../api/auth';
import { User } from '../types/api';
import { AppHeader } from '../components/AppHeader';

export function ProfilePage() {
  const [profile, setProfile] = useState<User | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setProfile(await authApi.me());
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

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
            </>
          ) : (
            <p className="text-sm text-muted">Loading profile...</p>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
