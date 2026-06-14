// Configure API base URL and token
const getApiBaseUrl = (): string => {
  const stored = localStorage.getItem('api_base_url');
  return stored || 'http://192.168.10.53:8080';
};

const getAuthToken = (): string | null => {
  return localStorage.getItem('admin_api_token');
};

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = getApiBaseUrl()) {
    this.baseUrl = baseUrl;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
    localStorage.setItem('api_base_url', url);
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
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

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
