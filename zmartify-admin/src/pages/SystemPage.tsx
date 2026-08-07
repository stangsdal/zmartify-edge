import {
  IonButton,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonPage,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { CloudStatusCard } from '../components/CloudStatusCard';
import { AppHeader } from '../components/AppHeader';
import { apiClient } from '../api/client';

type EmailSettings = {
  configured: boolean;
  source: string;
  host: string | null;
  port: number;
  username: string | null;
  sender: string | null;
  password_configured: boolean;
  updated_at: string | null;
};

export function SystemPage() {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('465');
  const [username, setUsername] = useState('');
  const [sender, setSender] = useState('');
  const [password, setPassword] = useState('');
  const [testRecipient, setTestRecipient] = useState('');
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    apiClient.get('/api/v2/admin/system/email-settings').then((result: EmailSettings) => {
      setSettings(result);
      setHost(result.host || '');
      setPort(String(result.port || 465));
      setUsername(result.username || '');
      setSender(result.sender || '');
    }).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  const saveEmailSettings = async () => {
    try {
      const result = await apiClient.put('/api/v2/admin/system/email-settings', {
        host,
        port: Number(port),
        username,
        sender,
        ...(password ? { password } : {}),
      }) as EmailSettings;
      setSettings(result);
      setPassword('');
      setMessage('Email settings updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const testEmailSettings = async () => {
    try {
      setTesting(true);
      await apiClient.post('/api/v2/admin/system/email-settings/test', { recipient: testRecipient });
      setMessage(`Test email sent to ${testRecipient}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title="System" subtitle="Diagnostics, connectivity and runtime status" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold">Runtime diagnostics</h2>
            <p className="text-sm text-muted mt-1">Cloud reachability and edge connectivity checks for operations.</p>
          </section>
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <CloudStatusCard />
          </section>
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold">Invitation email</h2>
            <p className="text-sm text-muted mt-1">{settings?.password_configured ? 'SMTP password configured.' : 'SMTP password has not been configured.'}</p>
            <IonItem>
              <IonLabel position="stacked">SMTP host</IonLabel>
              <IonInput value={host} onIonChange={(event) => setHost(event.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Port</IonLabel>
              <IonInput value={port} type="number" onIonChange={(event) => setPort(event.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Username</IonLabel>
              <IonInput value={username} onIonChange={(event) => setUsername(event.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">From address</IonLabel>
              <IonInput value={sender} type="email" onIonChange={(event) => setSender(event.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">SMTP password</IonLabel>
              <IonInput value={password} type="password" placeholder={settings?.password_configured ? 'Leave blank to keep the current password' : ''} onIonChange={(event) => setPassword(event.detail.value || '')} />
            </IonItem>
            <IonButton className="ion-margin-top" onClick={() => void saveEmailSettings()} disabled={!host || !username || !sender || !port}>Save email settings</IonButton>
            <IonItem className="ion-margin-top">
              <IonLabel position="stacked">Test recipient</IonLabel>
              <IonInput value={testRecipient} type="email" onIonChange={(event) => setTestRecipient(event.detail.value || '')} />
            </IonItem>
            <IonButton fill="outline" className="ion-margin-top" onClick={() => void testEmailSettings()} disabled={!settings?.password_configured || !testRecipient || testing}>
              {testing ? 'Sending test email...' : 'Send test email'}
            </IonButton>
            {message ? <p className="text-sm text-muted mt-2">{message}</p> : null}
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
