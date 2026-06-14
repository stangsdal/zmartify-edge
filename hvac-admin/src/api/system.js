import { apiClient } from './client';
export const systemApi = {
    getStatus: () => apiClient.get('/health'),
    getRegistryStatus: () => apiClient.get('/registry/status'),
    getAclStatus: () => apiClient.get('/admin/acl/status'),
};
