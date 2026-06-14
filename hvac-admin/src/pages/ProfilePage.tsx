import { useEffect, useState } from 'react';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonPage, IonCard, IonCardContent } from '@ionic/react';
import { authApi } from '../api/auth';
import { User } from '../types/api';

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
      <IonHeader><IonToolbar><IonTitle>Profile</IonTitle></IonToolbar></IonHeader>
      <IonContent className="ion-padding">
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {profile && (
          <IonCard>
            <IonCardContent>
              <p><strong>Username:</strong> {profile.username}</p>
              <p><strong>Display Name:</strong> {profile.display_name}</p>
              <p><strong>Roles:</strong> {profile.roles.join(', ')}</p>
              <p><strong>Last Login:</strong> {profile.last_login_at || 'Never'}</p>
            </IonCardContent>
          </IonCard>
        )}
      </IonContent>
    </IonPage>
  );
}
