import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonPage,
  IonLabel,
  IonInput,
  IonButton,
  IonCard,
} from '@ionic/react';
import { apiClient } from '../api/client';

export function LoginPage() {
  const [token, setToken] = useState('');
  const [baseUrl, setBaseUrl] = useState(
    () => localStorage.getItem('api_base_url') || 'http://192.168.10.53:8080'
  );
  const [message, setMessage] = useState('');
  const history = useHistory();

  useEffect(() => {
    const stored = localStorage.getItem('admin_api_token');
    if (stored) {
      history.push('/dashboard');
    }
  }, [history]);

  const handleSaveToken = () => {
    if (token.trim()) {
      apiClient.setAuthToken(token);
      apiClient.setBaseUrl(baseUrl);
      setMessage('Token saved');
      setTimeout(() => {
        history.push('/dashboard');
      }, 500);
    }
  };

  const handleClearToken = () => {
    setToken('');
    localStorage.removeItem('admin_api_token');
    setMessage('Token cleared');
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>HVAC Admin - Login</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <div style={{ padding: '16px' }}>
            <h2>API Configuration</h2>
            <IonLabel>API Base URL</IonLabel>
            <IonInput
              value={baseUrl}
              onIonChange={(e) => setBaseUrl(e.detail.value || '')}
              placeholder="http://192.168.10.53:8080"
            />

            <IonLabel style={{ marginTop: '16px', display: 'block' }}>
              Admin Bearer Token
            </IonLabel>
            <IonInput
              value={token}
              onIonChange={(e) => setToken(e.detail.value || '')}
              placeholder="Bearer token"
              type="password"
            />

            <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
              <IonButton onClick={handleSaveToken} expand="block">
                Save
              </IonButton>
              <IonButton onClick={handleClearToken} expand="block" color="medium">
                Clear
              </IonButton>
            </div>

            {message && <p style={{ color: 'green', marginTop: '8px' }}>{message}</p>}
          </div>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
