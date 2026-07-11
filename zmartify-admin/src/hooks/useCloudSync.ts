import { useState, useEffect } from 'react';
import { cloudApiClient, SyncStatus } from '../api/cloudClient';

export function useCloudSync() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    connected: false,
    pendingChanges: 0,
  });
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const config = cloudApiClient.loadConfig();
    if (config) {
      setSyncStatus((prev) => ({ ...prev, connected: true }));
    }
  }, []);

  const syncNow = async (data: any) => {
    try {
      setSyncing(true);
      const result = await cloudApiClient.syncToCloud(data);
      setSyncStatus(result);
      setError('');
      return result;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setSyncing(false);
    }
  };

  return {
    syncStatus,
    syncing,
    error,
    syncNow,
    isCloudConfigured: cloudApiClient.isConfigured(),
  };
}
