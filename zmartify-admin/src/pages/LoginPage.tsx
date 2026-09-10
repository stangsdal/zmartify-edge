import { CSSProperties, useEffect, useState } from 'react';
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
import { authApi, SiteInvitationValidateResponse } from '../api/auth';
import { useAccess } from '../auth/AccessContext';
import { InviteValidateResponse } from '../types/api';

const isNativeBuild = import.meta.env.MODE === 'native';
const brandAssetUrl = (fileName: string) => `${isNativeBuild ? '/' : import.meta.env.BASE_URL}brand/${fileName}`;

function formatLoginError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error || '');

  if (/422/.test(msg) && /username/.test(msg) && /password/.test(msg)) {
    return 'Please enter both username and password.';
  }

  if (/\b401\b|invalid credentials|invalid username or password|unauthorized/i.test(msg)) {
    return 'Invalid username or password.';
  }

  if (/secure storage|keychain|oserror/i.test(msg)) {
    return 'Unable to save the secure session. Please restart the app and try again.';
  }

  if (/network error while calling|failed to fetch|network request failed/i.test(msg)) {
    return isNativeBuild
      ? 'Unable to reach Zmartify. Check your network connection and try again.'
      : 'Unable to reach the server. Check API Base URL and your network connection.';
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
    () => localStorage.getItem('api_base_url') || import.meta.env.VITE_API_BASE_URL || window.location.origin
  );
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'error'>('info');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [inviteToken, setInviteToken] = useState('');
  const [inviteState, setInviteState] = useState<InviteValidateResponse | null>(null);
  const [siteInviteToken, setSiteInviteToken] = useState('');
  const [siteInviteState, setSiteInviteState] = useState<SiteInvitationValidateResponse | null>(null);
  const [isInviteLoading, setIsInviteLoading] = useState(false);
  const history = useHistory();
  const { isAuthenticated, refresh } = useAccess();
  const inviteOriginBaseUrl = isNativeBuild
    ? baseUrl
    : typeof window !== 'undefined' ? window.location.origin : 'https://app.zmartify.dk';

  const navigateToHome = () => {
    history.replace(`${appBase}/home`);
    window.setTimeout(() => {
      if (window.location.pathname === `${appBase}/login`) {
        window.location.assign(`${appBase}/home`);
      }
    }, 200);
  };

  useEffect(() => {
    if (isAuthenticated) {
      navigateToHome();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = (params.get('invite_token') || '').trim();
    const siteToken = (params.get('site_invitation_token') || '').trim();
    setInviteToken(token);
    setSiteInviteToken(siteToken);

    // QR invite links should always validate against the same host that served the link.
    if ((token || siteToken) && baseUrl !== inviteOriginBaseUrl) {
      setBaseUrl(inviteOriginBaseUrl);
      apiClient.setBaseUrl(inviteOriginBaseUrl);
    }

    if (!token && !siteToken) {
      setInviteState(null);
      setSiteInviteState(null);
      return;
    }

    let canceled = false;
    const validateInvite = async () => {
      try {
        setIsInviteLoading(true);
        const effectiveBaseUrl = token || siteToken ? inviteOriginBaseUrl : baseUrl;
        apiClient.setBaseUrl(effectiveBaseUrl);
        const result = token ? await authApi.validateInvite(token) : await authApi.validateSiteInvitation(siteToken);
        if (!canceled) {
          if (token) {
            setInviteState(result as InviteValidateResponse);
          } else {
            setSiteInviteState(result as SiteInvitationValidateResponse);
          }
        }
      } catch {
        if (!canceled) {
          if (token) {
            setInviteState({ valid: false, reason: 'failed to validate invite' });
          } else {
            setSiteInviteState({ valid: false, product_types: [], reason: 'failed to validate invite' });
          }
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

    const stored = apiClient.getAuthToken();
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
        await apiClient.clearAuthToken();
      }
    };

    verifyToken();

    return () => {
      canceled = true;
    };
  }, [history]);

  const handleLogin = async () => {
    const user = username.trim();
    const pass = password;

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
      await apiClient.setAuthToken(data.access_token);
      if (siteInviteToken) {
        await authApi.acceptSiteInvitation(siteInviteToken);
      }
      await refresh();
    } catch (e) {
      setMessageTone('error');
      setMessage(formatLoginError(e));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegister = async () => {
    const token = inviteToken.trim();
    const siteToken = siteInviteToken.trim();
    const user = username.trim();
    const pass = password;
    const name = displayName.trim();
    const mail = email.trim();

    if (!token && !siteToken) {
      setMessageTone('error');
      setMessage('Registration requires a valid invitation.');
      return;
    }
    if (token && !inviteState?.valid) {
      setMessageTone('error');
      setMessage('Invite token is invalid or expired.');
      return;
    }
    if (siteToken && !siteInviteState?.valid) {
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
      const data = siteToken
        ? await authApi.registerBySiteInvitation({ token: siteToken, username: user, display_name: name, password: pass })
        : await authApi.registerByInvite({
          invite_token: token,
          username: user,
          display_name: name,
          password: pass,
          email: mail || undefined,
        });
      await apiClient.setAuthToken(data.access_token);
      await refresh();
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
    void apiClient.clearAuthToken();
    setMessageTone('info');
    setMessage('Token cleared');
  };

  return (
    <IonPage className="login-page">
      <IonHeader className="login-header">
        <IonToolbar>
          <IonTitle>Zmartify HVAC</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent
        fullscreen
        className="login-content"
        style={{ '--login-pattern': `url("${brandAssetUrl('zmartify-pattern-light.png')}")` } as CSSProperties}
      >
        <main className="login-shell">
          <section className="login-brand" aria-label="Zmartify HVAC">
            <img src={brandAssetUrl('zmartify-lockup-transparent.png')} alt="Zmartify" />
            <p>HVAC control</p>
          </section>
          <IonCard className="login-card">
          <div className="login-card__content">
            <div className="login-card__heading">
              <p>Welcome back</p>
              <h1>Sign in</h1>
            </div>
            {!isNativeBuild && (
              <div className="login-api-config">
                <IonLabel>API Base URL</IonLabel>
                <IonInput
                  value={baseUrl}
                  onIonInput={(e) => setBaseUrl(e.detail.value || '')}
                  placeholder="https://api.zmartify.dk"
                />
              </div>
            )}

            {!!inviteToken && (
              <div className="login-notice">
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

            {!!siteInviteToken && (
              <div className="login-notice">
                <strong>Site invitation</strong>
                {isInviteLoading && <p style={{ margin: '6px 0 0' }}>Validating invitation...</p>}
                {!isInviteLoading && siteInviteState?.valid && (
                  <p style={{ margin: '6px 0 0', color: '#146c2e' }}>
                    Invitation to {siteInviteState.site_name} as {siteInviteState.role}. Sign in to accept it, or create an account below.
                  </p>
                )}
                {!isInviteLoading && siteInviteState && !siteInviteState.valid && (
                  <p style={{ margin: '6px 0 0', color: '#b00020' }}>
                    Invitation invalid: {siteInviteState.reason || 'unknown reason'}.
                  </p>
                )}
              </div>
            )}

            <IonLabel className="login-label">
              Username
            </IonLabel>
            <IonInput
              value={username}
              onIonInput={(e) => setUsername(e.detail.value || '')}
              placeholder="admin"
              autocomplete="username"
              autocapitalize="off"
            />

            {!!(inviteToken || siteInviteToken) && (
              <>
                <IonLabel className="login-label">
                  Display Name
                </IonLabel>
                <IonInput
                  value={displayName}
                  onIonInput={(e) => setDisplayName(e.detail.value || '')}
                  placeholder="Your full name"
                />

                {!!inviteToken && <IonLabel className="login-label">
                  Email (optional)
                </IonLabel>}
                {!!inviteToken && <IonInput
                  value={email}
                  onIonInput={(e) => setEmail(e.detail.value || '')}
                  placeholder="name@example.com"
                  type="email"
                />}
              </>
            )}

            <IonLabel className="login-label">
              Password
            </IonLabel>
            <IonInput
              value={password}
              onIonInput={(e) => setPassword(e.detail.value || '')}
              placeholder="Your password"
              type="password"
              autocomplete="current-password"
            />

            <div className="login-actions">
              <IonButton onClick={handleLogin} expand="block" disabled={isLoggingIn || isRegistering}>
                {isLoggingIn ? <IonSpinner name="crescent" /> : 'Login'}
              </IonButton>
              {!!(inviteToken || siteInviteToken) && (
                <IonButton
                  onClick={handleRegister}
                  expand="block"
                  color="success"
                  disabled={isRegistering || isLoggingIn || isInviteLoading || (inviteToken ? !inviteState?.valid : !siteInviteState?.valid)}
                >
                  {isRegistering ? <IonSpinner name="crescent" /> : 'Register'}
                </IonButton>
              )}
              <IonButton onClick={handleClearToken} expand="block" color="medium" disabled={isLoggingIn || isRegistering}>
                Clear
              </IonButton>
            </div>

            {message && (
              <p className={`login-message login-message--${messageTone}`}>
                {message}
              </p>
            )}
          </div>
          </IonCard>
        </main>
      </IonContent>
    </IonPage>
  );
}
