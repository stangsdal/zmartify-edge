import { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
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
import { InviteValidateResponse } from '../types/api';

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
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [baseUrl, setBaseUrl] = useState(
    () => localStorage.getItem('api_base_url') || 'https://pilot.zmartify.dk'
  );
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'error'>('info');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [inviteToken, setInviteToken] = useState('');
  const [inviteState, setInviteState] = useState<InviteValidateResponse | null>(null);
  const [isInviteLoading, setIsInviteLoading] = useState(false);
  const history = useHistory();
  const inviteOriginBaseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://pilot.zmartify.dk';

  const navigateToHome = () => {
    history.replace(`${appBase}/home`);
    window.setTimeout(() => {
      if (window.location.pathname === `${appBase}/login`) {
        window.location.assign(`${appBase}/home`);
      }
    }, 200);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = (params.get('invite_token') || '').trim();
    setInviteToken(token);

    // QR invite links should always validate against the same host that served the link.
    if (token && baseUrl !== inviteOriginBaseUrl) {
      setBaseUrl(inviteOriginBaseUrl);
      apiClient.setBaseUrl(inviteOriginBaseUrl);
    }

    if (!token) {
      setInviteState(null);
      return;
    }

    let canceled = false;
    const validateInvite = async () => {
      try {
        setIsInviteLoading(true);
        const effectiveBaseUrl = token ? inviteOriginBaseUrl : baseUrl;
        apiClient.setBaseUrl(effectiveBaseUrl);
        const result = await authApi.validateInvite(token);
        if (!canceled) {
          setInviteState(result);
        }
      } catch {
        if (!canceled) {
          setInviteState({ valid: false, reason: 'failed to validate invite' });
        }
      } finally {
        if (!canceled) {
          setIsInviteLoading(false);
        }
      }
    };

    validateInvite();
    return () => {
      canceled = true;
    };
  }, [location.search, baseUrl, inviteOriginBaseUrl]);

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

  const handleRegister = async () => {
    const token = inviteToken.trim();
    const user = username.trim();
    const pass = password.trim();
    const name = displayName.trim();
    const mail = email.trim();

    if (!token) {
      setMessageTone('error');
      setMessage('Registration requires a valid QR invite token.');
      return;
    }
    if (!inviteState?.valid) {
      setMessageTone('error');
      setMessage('Invite token is invalid or expired.');
      return;
    }
    if (!name || !user || !pass) {
      setMessageTone('error');
      setMessage('Please enter display name, username, and password.');
      return;
    }
    if (pass.length < 12) {
      setMessageTone('error');
      setMessage('Password must be at least 12 characters.');
      return;
    }

    try {
      setIsRegistering(true);
      setMessageTone('info');
      setMessage('Creating account...');
      apiClient.setBaseUrl(inviteOriginBaseUrl);
      const data = await authApi.registerByInvite({
        invite_token: token,
        username: user,
        display_name: name,
        password: pass,
        email: mail || undefined,
      });
      apiClient.setAuthToken(data.access_token);
      navigateToHome();
    } catch (e) {
      setMessageTone('error');
      const msg = e instanceof Error ? e.message : String(e || '');
      if (/invite token/i.test(msg)) {
        setMessage('Invite token is invalid, used, or expired.');
        return;
      }
      if (/username already exists/i.test(msg)) {
        setMessage('That username is already taken.');
        return;
      }
      setMessage('Registration failed. Please verify your invite and try again.');
    } finally {
      setIsRegistering(false);
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
            <IonTitle>Zmartify Admin - Login</IonTitle>
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

            {!!inviteToken && (
              <div style={{ marginTop: '16px', padding: '10px', borderRadius: '8px', background: '#f6f8ff' }}>
                <strong>QR Invite</strong>
                {isInviteLoading && <p style={{ margin: '6px 0 0' }}>Validating invite...</p>}
                {!isInviteLoading && inviteState?.valid && (
                  <p style={{ margin: '6px 0 0', color: '#146c2e' }}>
                    Invite valid{inviteState.device_id ? ` for device ${inviteState.device_id}` : ''}.
                  </p>
                )}
                {!isInviteLoading && inviteState && !inviteState.valid && (
                  <p style={{ margin: '6px 0 0', color: '#b00020' }}>
                    Invite invalid: {inviteState.reason || 'unknown reason'}.
                  </p>
                )}
              </div>
            )}

            <IonLabel style={{ marginTop: '16px', display: 'block' }}>
              Username
            </IonLabel>
            <IonInput
              value={username}
              onIonChange={(e) => setUsername(e.detail.value || '')}
              placeholder="admin"
            />

            {!!inviteToken && (
              <>
                <IonLabel style={{ marginTop: '16px', display: 'block' }}>
                  Display Name
                </IonLabel>
                <IonInput
                  value={displayName}
                  onIonChange={(e) => setDisplayName(e.detail.value || '')}
                  placeholder="Your full name"
                />

                <IonLabel style={{ marginTop: '16px', display: 'block' }}>
                  Email (optional)
                </IonLabel>
                <IonInput
                  value={email}
                  onIonChange={(e) => setEmail(e.detail.value || '')}
                  placeholder="name@example.com"
                  type="email"
                />
              </>
            )}

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
              <IonButton onClick={handleLogin} expand="block" disabled={isLoggingIn || isRegistering}>
                {isLoggingIn ? <IonSpinner name="crescent" /> : 'Login'}
              </IonButton>
              {!!inviteToken && (
                <IonButton
                  onClick={handleRegister}
                  expand="block"
                  color="success"
                  disabled={isRegistering || isLoggingIn || isInviteLoading || !inviteState?.valid}
                >
                  {isRegistering ? <IonSpinner name="crescent" /> : 'Register'}
                </IonButton>
              )}
              <IonButton onClick={handleClearToken} expand="block" color="medium" disabled={isLoggingIn || isRegistering}>
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
