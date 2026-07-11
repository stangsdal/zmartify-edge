// Configure API base URL and token
const DEFAULT_API_BASE_URL = 'https://pilot.zmartify.dk';

const normalizeApiBaseUrl = (raw: string): string => {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  // Prevent mixed-content fetch errors when the app is loaded over HTTPS.
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && /^http:\/\//i.test(withScheme)) {
    return DEFAULT_API_BASE_URL;
  }

  // Migrate legacy LAN default that was previously shipped.
  if (/^http:\/\/192\.168\.10\.53:8080\/?$/i.test(withScheme)) {
    return DEFAULT_API_BASE_URL;
  }

  const withoutAppSuffix = withScheme.replace(/\/app\/?$/i, '');
  return withoutAppSuffix.replace(/\/+$/, '');
};

const getApiBaseUrl = (): string => {
  const stored = localStorage.getItem('api_base_url');
  return normalizeApiBaseUrl(stored || DEFAULT_API_BASE_URL);
};

const getAuthToken = (): string | null => {
  return localStorage.getItem('admin_api_token');
};

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = getApiBaseUrl()) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
  }

  setBaseUrl(url: string): void {
    this.baseUrl = normalizeApiBaseUrl(url);
    localStorage.setItem('api_base_url', this.baseUrl);
  }

  setAuthToken(token: string): void {
    localStorage.setItem('admin_api_token', token);
  }

  clearAuthToken(): void {
    localStorage.removeItem('admin_api_token');
  }

  getAuthToken(): string | null {
    return getAuthToken();
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async fetch(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...options.headers,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'network request failed';
      throw new Error(`Network error while calling ${url}: ${reason}`);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${response.status}: ${error}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  get(endpoint: string): Promise<any> {
    return this.fetch(endpoint, { method: 'GET' });
  }

  post(endpoint: string, body?: any): Promise<any> {
    return this.fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  put(endpoint: string, body?: any): Promise<any> {
    return this.fetch(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  delete(endpoint: string): Promise<any> {
    return this.fetch(endpoint, { method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
