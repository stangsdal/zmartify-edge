// Configure API base URL and token
const getApiBaseUrl = () => {
    const stored = localStorage.getItem('api_base_url');
    return stored || 'http://192.168.10.53:8080';
};
const getAuthToken = () => {
    return localStorage.getItem('admin_api_token');
};
export class ApiClient {
    constructor(baseUrl = getApiBaseUrl()) {
        Object.defineProperty(this, "baseUrl", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.baseUrl = baseUrl;
    }
    setBaseUrl(url) {
        this.baseUrl = url;
        localStorage.setItem('api_base_url', url);
    }
    setAuthToken(token) {
        localStorage.setItem('admin_api_token', token);
    }
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };
        const token = getAuthToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }
    async fetch(endpoint, options = {}) {
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
    get(endpoint) {
        return this.fetch(endpoint, { method: 'GET' });
    }
    post(endpoint, body) {
        return this.fetch(endpoint, {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }
    put(endpoint, body) {
        return this.fetch(endpoint, {
            method: 'PUT',
            body: JSON.stringify(body),
        });
    }
    delete(endpoint) {
        return this.fetch(endpoint, { method: 'DELETE' });
    }
}
export const apiClient = new ApiClient();
