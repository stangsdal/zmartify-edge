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
  IonSpinner,
} from '@ionic/react';
import { apiClient } from '../api/client';
import { authApi } from '../api/auth';

function formatLoginError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error || '');

  if (/422/.test(msg) && /username/.test(msg) && /password/.test(msg)) {
    return 'Please enter both username and password.';
  }

  if (/401|invalid credentials|unauthorized/i.test(msg)) {
    return 'Invalid username or password.';
  }

  if (/network error while calling|failed to fetch|network request failed/i.test(msg)) {
    return 'Unable to reach the server. Check API Base URL and your network connection.';
  }

  if (/403/.test(msg)) {
    return 'Access denied. Your account may not have permission to log in.';
  }

  return 'Login failed. Please try again.';
}

export function LoginPage() {
  const appBase = '/app';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [baseUrl, setBaseUrl] = useState(
    () => localStorage.getItem('api_base_url') || 'https://pilot.zmartify.dk'
  );
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'error'>('info');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const history = useHistory();

  const navigateToHome = () => {
    history.replace(`${appBase}/home`);
    window.setTimeout(() => {
      if (window.location.pathname === `${appBase}/login`) {
        window.location.assign(`${appBase}/home`);
      }
    }, 200);
  };

  useEffect(() => {
    let canceled = false;

    const stored = localStorage.getItem('admin_api_token');
    if (!stored) {
      return () => {
        canceled = true;
      };
    }

    const verifyToken = async () => {
      try {
        await authApi.me();
        if (!canceled) {
          history.replace(`${appBase}/home`);
        }
      } catch {
        // Stale token: keep user on login page and let them sign in again.
        apiClient.clearAuthToken();
      }
    };

    verifyToken();

    return () => {
      canceled = true;
    };
  }, [history]);

  const handleLogin = async () => {
    const user = username.trim();
    const pass = password.trim();

    if (!user && !pass) {
      setMessageTone('error');
      setMessage('Please enter username and password.');
      return;
    }

    if (!user) {
      setMessageTone('error');
      setMessage('Please enter username.');
      return;
    }

    if (!pass) {
      setMessageTone('error');
      setMessage('Please enter password.');
      return;
    }

    try {
      setIsLoggingIn(true);
      setMessageTone('info');
      setMessage('Spinning up...');
      apiClient.setBaseUrl(baseUrl);
      const data = await authApi.login(user, pass);
      apiClient.setAuthToken(data.access_token);
      navigateToHome();
    } catch (e) {
      setMessageTone('error');
      setMessage(formatLoginError(e));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleClearToken = () => {
    setUsername('');
    setPassword('');
    apiClient.clearAuthToken();
    setMessageTone('info');
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
              placeholder="https://pilot.zmartify.dk"
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
              <IonButton onClick={handleLogin} expand="block" disabled={isLoggingIn}>
                {isLoggingIn ? <IonSpinner name="crescent" /> : 'Login'}
              </IonButton>
              <IonButton onClick={handleClearToken} expand="block" color="medium" disabled={isLoggingIn}>
                Clear
              </IonButton>
            </div>

            {message && (
              <p style={{ color: messageTone === 'error' ? '#b00020' : 'green', marginTop: '8px' }}>
                {message}
              </p>
            )}
          </div>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
