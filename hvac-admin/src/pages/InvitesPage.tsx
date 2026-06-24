import { useEffect, useMemo, useState } from 'react';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import QRCode from 'qrcode';
import { invitesApi } from '../api/invites';
import { CreateInviteResponse, InviteListItem } from '../types/api';

interface GeneratedInviteRow {
  device_id?: string;
  invite_code: string;
  invite_url: string;
  expires_at: string;
  label_text: string;
}

export function InvitesPage() {
  const [deviceId, setDeviceId] = useState('');
  const [batchDeviceIds, setBatchDeviceIds] = useState('');
  const [label, setLabel] = useState('');
  const [expiresHours, setExpiresHours] = useState('336');
  const [result, setResult] = useState<CreateInviteResponse | null>(null);
  const [generatedRows, setGeneratedRows] = useState<GeneratedInviteRow[]>([]);
  const [historyRows, setHistoryRows] = useState<InviteListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [bulkCsvContent, setBulkCsvContent] = useState('');
  const [selectedTab, setSelectedTab] = useState<'create' | 'history'>('create');
  const [previewImage, setPreviewImage] = useState<string>('');
  const [previewCode, setPreviewCode] = useState<string>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(() => {
    const n = Number(expiresHours);
    return Number.isFinite(n) && n > 0;
  }, [expiresHours]);

  const createInvite = async () => {
    if (!canSubmit) {
      setError('Expiry must be a positive number of hours.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await invitesApi.createRegistrationInvite({
        device_id: deviceId.trim() || undefined,
        label: label.trim() || undefined,
        expires_hours: Math.trunc(Number(expiresHours)),
      });
      setResult(response);
      setGeneratedRows((prev) => [
        {
          device_id: response.device_id,
          invite_code: response.invite_code,
          invite_url: response.invite_url,
          expires_at: response.expires_at,
          label_text: response.label_text,
        },
        ...prev,
      ]);
      await loadHistory();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || 'Unknown error');
      setError(msg);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const rows = await invitesApi.listRegistrationInvites(500);
      setHistoryRows(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || 'Unknown error');
      setError(msg);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory().catch(() => {
      // handled inside loadHistory
    });
  }, []);

  const createBatchInvites = async () => {
    if (!canSubmit) {
      setError('Expiry must be a positive number of hours.');
      return;
    }

    const ids = batchDeviceIds
      .split(/\r?\n|,|;/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (!ids.length) {
      setError('Enter at least one device ID for batch creation.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const bulkResponse = await invitesApi.createRegistrationInvitesBulk({
        device_ids: ids,
        label_prefix: label.trim() || 'Pilot',
        expires_hours: Math.trunc(Number(expiresHours)),
      });
      const created: GeneratedInviteRow[] = bulkResponse.invites.map((response) => ({
        device_id: response.device_id,
        invite_code: response.invite_code,
        invite_url: response.invite_url,
        expires_at: response.expires_at,
        label_text: response.label_text,
      }));
      setGeneratedRows((prev) => [...created, ...prev]);
      setBulkCsvContent(bulkResponse.csv_content || '');
      setResult(created[0] ? {
        invite_token: '',
        invite_code: created[0].invite_code,
        invite_url: created[0].invite_url,
        label_text: created[0].label_text,
        expires_at: created[0].expires_at,
        device_id: created[0].device_id,
      } : null);
      await loadHistory();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || 'Unknown error');
      setError(`Batch creation failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadLabelText = () => {
    if (!result) {
      return;
    }
    const blob = new Blob([`${result.label_text}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = result.device_id || result.invite_code || 'invite';
    a.download = `qr-label-${suffix}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore clipboard failures in unsupported contexts.
    }
  };

  const previewQr = async (inviteUrl: string, inviteCode: string) => {
    try {
      const dataUrl = await QRCode.toDataURL(inviteUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 360,
      });
      setPreviewImage(dataUrl);
      setPreviewCode(inviteCode);
    } catch {
      setError('Unable to generate QR preview.');
    }
  };

  const downloadQrPng = async (inviteUrl: string, inviteCode: string) => {
    try {
      const dataUrl = await QRCode.toDataURL(inviteUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 720,
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `qr-${inviteCode || 'invite'}.png`;
      a.click();
    } catch {
      setError('Unable to download QR PNG.');
    }
  };

  const downloadGeneratedCsv = () => {
    if (bulkCsvContent) {
      const blob = new Blob([bulkCsvContent], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qr-codes-generated.csv';
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (!generatedRows.length) {
      setError('No generated invites available for CSV export yet.');
      return;
    }

    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      'device_id,invite_code,invite_url,expires_at,qr_payload',
      ...generatedRows.map((row) => {
        const device = row.device_id || '';
        const payload = row.invite_url;
        return [device, row.invite_code, row.invite_url, row.expires_at, payload].map((v) => esc(String(v))).join(',');
      }),
    ];
    const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qr-codes-generated.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = (status: string): string => {
    if (status === 'active') return '#146c2e';
    if (status === 'used') return '#1d4ed8';
    if (status === 'expired') return '#b45309';
    return '#475569';
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Registration Invites</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonSegment value={selectedTab} onIonChange={(e) => setSelectedTab((String(e.detail.value || 'create') as 'create' | 'history'))}>
          <IonSegmentButton value="create">
            <IonLabel>Create</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="history">
            <IonLabel>History</IonLabel>
          </IonSegmentButton>
        </IonSegment>

        {selectedTab === 'create' && (
        <IonCard>
          <IonCardContent>
            <h3>Create QR Invite</h3>
            <IonItem>
              <IonLabel position="stacked">Device ID (optional)</IonLabel>
              <IonInput
                value={deviceId}
                onIonInput={(e) => setDeviceId(String(e.detail.value || ''))}
                placeholder="hvac-gateway-aabbccddeeff"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Label (optional)</IonLabel>
              <IonInput
                value={label}
                onIonInput={(e) => setLabel(String(e.detail.value || ''))}
                placeholder="Pilot Kitchen Gateway"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Expires (hours)</IonLabel>
              <IonInput
                type="number"
                value={expiresHours}
                onIonInput={(e) => setExpiresHours(String(e.detail.value || ''))}
                placeholder="336"
              />
            </IonItem>
            <IonButton className="ion-margin-top" expand="block" onClick={createInvite} disabled={loading || !canSubmit}>
              {loading ? 'Creating...' : 'Create Invite'}
            </IonButton>
            <IonItem lines="none">
              <IonLabel position="stacked">Batch Device IDs (comma/newline separated)</IonLabel>
              <IonTextarea
                value={batchDeviceIds}
                onIonInput={(e) => setBatchDeviceIds(String(e.detail.value || ''))}
                autoGrow
                placeholder="hvac-gateway-aaa\nhvac-gateway-bbb"
              />
            </IonItem>
            <IonButton className="ion-margin-top" expand="block" color="tertiary" onClick={createBatchInvites} disabled={loading || !canSubmit}>
              {loading ? 'Creating Batch...' : 'Create Batch Invites'}
            </IonButton>
            <IonButton className="ion-margin-top" expand="block" fill="outline" onClick={downloadGeneratedCsv} disabled={!generatedRows.length}>
              Download CSV (All Generated QR Codes)
            </IonButton>
            {!!error && <p style={{ color: '#b00020', marginTop: '8px' }}>{error}</p>}
          </IonCardContent>
        </IonCard>
        )}

        {selectedTab === 'create' && result && (
          <IonCard>
            <IonCardContent>
              <h3>Invite Result</h3>
              <p><strong>Code:</strong> {result.invite_code}</p>
              <p><strong>Expires:</strong> {result.expires_at}</p>
              <p><strong>URL:</strong> {result.invite_url}</p>

              <IonButton size="small" onClick={() => copyText(result.invite_url)}>Copy URL</IonButton>
              <IonButton size="small" fill="outline" onClick={() => copyText(result.label_text)}>Copy Label Text</IonButton>
              <IonButton size="small" fill="clear" onClick={downloadLabelText}>Download .txt</IonButton>
              <IonButton size="small" fill="outline" onClick={() => previewQr(result.invite_url, result.invite_code)}>Preview QR</IonButton>
              <IonButton size="small" fill="outline" onClick={() => downloadQrPng(result.invite_url, result.invite_code)}>Download QR PNG</IonButton>

              <IonItem lines="none" className="ion-margin-top">
                <IonLabel position="stacked">Printable Label Text</IonLabel>
                <IonTextarea value={result.label_text} readonly autoGrow />
              </IonItem>
            </IonCardContent>
          </IonCard>
        )}

        {selectedTab === 'history' && (
          <IonCard>
            <IonCardContent>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Invite History</h3>
                <IonButton size="small" fill="outline" onClick={() => loadHistory()} disabled={historyLoading}>
                  Refresh
                </IonButton>
              </div>
              {historyLoading && <p style={{ marginTop: '10px' }}>Loading history...</p>}
              {!historyLoading && !historyRows.length && <p style={{ marginTop: '10px' }}>No invites found.</p>}
              <div style={{ marginTop: '12px', display: 'grid', gap: '10px' }}>
                {historyRows.map((row) => (
                  <div key={row.id} style={{ border: '1px solid #dbe2ea', borderRadius: '10px', padding: '10px' }}>
                    <p style={{ margin: '0 0 4px' }}><strong>{row.invite_code}</strong> <span style={{ color: statusColor(row.status) }}>({row.status})</span></p>
                    <p style={{ margin: '0 0 4px' }}>Device: {row.device_id || 'N/A'}</p>
                    <p style={{ margin: '0 0 4px' }}>Label: {row.label || 'N/A'}</p>
                    <p style={{ margin: '0 0 4px' }}>Created: {row.created_at}</p>
                    <p style={{ margin: '0 0 4px' }}>Expires: {row.expires_at}</p>
                    <p style={{ margin: 0 }}>Used At: {row.used_at || 'Not used'}</p>
                  </div>
                ))}
              </div>
            </IonCardContent>
          </IonCard>
        )}

        {previewImage && (
          <IonCard>
            <IonCardContent>
              <h3>QR Preview {previewCode ? `- ${previewCode}` : ''}</h3>
              <img src={previewImage} alt="Invite QR preview" style={{ width: '100%', maxWidth: '360px', display: 'block', margin: '0 auto' }} />
              <IonButton className="ion-margin-top" expand="block" fill="outline" onClick={() => setPreviewImage('')}>
                Close Preview
              </IonButton>
            </IonCardContent>
          </IonCard>
        )}
      </IonContent>
    </IonPage>
  );
}
