export interface CloudConfig {
  cloudBaseUrl: string;
  cloudToken: string;
  organizationId: string;
}

export interface SyncStatus {
  connected: boolean;
  lastSync?: string;
  pendingChanges: number;
}

class CloudApiClient {
  private config: CloudConfig | null = null;

  setConfig(config: CloudConfig) {
    this.config = config;
    localStorage.setItem('cloud_config', JSON.stringify(config));
  }

  loadConfig(): CloudConfig | null {
    const saved = localStorage.getItem('cloud_config');
    if (saved) {
      this.config = JSON.parse(saved);
    }
    return this.config;
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  async syncToCloud(data: any): Promise<SyncStatus> {
    if (!this.config) {
      throw new Error('Cloud not configured');
    }

    // Phase 9: Cloud sync abstraction layer
    // This provides a clean interface for future cloud integration
    try {
      // Placeholder for actual cloud API call
      console.log('[Cloud] Syncing data to cloud:', data);

      return {
        connected: true,
        lastSync: new Date().toISOString(),
        pendingChanges: 0,
      };
    } catch (error) {
      return {
        connected: false,
        pendingChanges: 1,
      };
    }
  }

  async fetchFromCloud(resource: string): Promise<any> {
    if (!this.config) {
      throw new Error('Cloud not configured');
    }

    // Placeholder cloud fetch
    return {
      resource,
      data: [],
      source: 'cloud',
    };
  }
}

export const cloudApiClient = new CloudApiClient();
