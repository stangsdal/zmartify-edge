export declare class ApiClient {
    private baseUrl;
    constructor(baseUrl?: string);
    setBaseUrl(url: string): void;
    setAuthToken(token: string): void;
    private getHeaders;
    fetch(endpoint: string, options?: RequestInit): Promise<any>;
    get(endpoint: string): Promise<any>;
    post(endpoint: string, body?: any): Promise<any>;
    put(endpoint: string, body?: any): Promise<any>;
    delete(endpoint: string): Promise<any>;
}
export declare const apiClient: ApiClient;
