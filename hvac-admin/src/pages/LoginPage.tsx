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
import { authApi } from '../api/auth';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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

  const handleLogin = async () => {
    try {
      apiClient.setBaseUrl(baseUrl);
      const data = await authApi.login(username, password);
      apiClient.setAuthToken(data.access_token);
      setMessage('Login successful');
      setTimeout(() => {
        history.push('/dashboard');
      }, 300);
    } catch (e) {
      setMessage(String(e));
    }
  };

  const handleClearToken = () => {
    setUsername('');
    setPassword('');
    apiClient.clearAuthToken();
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
              Username
            </IonLabel>
            <IonInput
              value={username}
              onIonChange={(e) => setUsername(e.detail.value || '')}
              placeholder="admin"
            />

            <IonLabel style={{ marginTop: '16px', display: 'block' }}>
              Password
            </IonLabel>
            <IonInput
              value={password}
              onIonChange={(e) => setPassword(e.detail.value || '')}
              placeholder="Your password"
              type="password"
            />

            <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
              <IonButton onClick={handleLogin} expand="block">
                Login
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
